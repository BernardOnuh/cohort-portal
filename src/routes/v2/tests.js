import { Router } from 'express'
import { prisma } from '../../db.js'
import { authenticate, requireStudent } from '../../middleware/auth.js'
import { scoreMCQ } from '../../services/mcq-score.js'
import { enrolledCourseIds, isEnrolled } from '../../services/v2-enrollment.js'
import { firstTestGate } from '../../services/v2-onboarding.js'

const router = Router()

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// normalize admin-provided questions into { questions, correctAnswers }
function normalizeQuestions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'questions array required' }
  if (raw.length > 50) return { error: 'max 50 questions per test' }

  const questions = []
  const correctAnswers = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    const q = typeof item.q === 'string' ? item.q.trim() : ''
    if (!q) return { error: `question ${i + 1} is missing text` }
    if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 10) {
      return { error: `question ${i + 1} needs 2-10 options` }
    }

    let answerIndex
    if (/^[A-Z]$/i.test(String(item.answer ?? ''))) {
      answerIndex = String(item.answer).toUpperCase().charCodeAt(0) - 65
    } else {
      answerIndex = Number(item.answer)
    }
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= item.options.length) {
      return { error: `question ${i + 1} has an invalid answer` }
    }

    const options = item.options.map(o => String(o).trim()).filter(Boolean)
    if (options.length < 2) return { error: `question ${i + 1} has empty options` }

    questions.push({ q, options })
    correctAnswers.push(LETTERS[answerIndex])
  }
  return { questions, correctAnswers, error: null }
}

// ── Admin ────────────────────────────────────────────────────

router.post('/admin/tests', authenticate, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admins only' })
  const { courseId, title, description, status } = req.body
  if (!courseId || !title) return res.status(400).json({ error: 'courseId and title required' })

  try {
    const course = await prisma.course.findUnique({ where: { id: courseId } })
    if (!course) return res.status(400).json({ error: 'courseId not found' })
    if (req.user.courseId && req.user.courseId !== courseId) {
      return res.status(403).json({ error: 'Not your course' })
    }

    const parsed = normalizeQuestions(req.body.questions)
    if (parsed.error) return res.status(400).json({ error: parsed.error })

    const maxScore = Number.parseInt(req.body.maxScore, 10) || 100

    const test = await prisma.aITest.create({
      data: {
        title: String(title).trim(),
        description: description || null,
        questions: JSON.stringify(parsed.questions),
        correctAnswers: JSON.stringify(parsed.correctAnswers),
        maxScore,
        status: status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED',
        cohortId: course.cohortId,
        courseId,
        opensAt: req.body.opensAt ? new Date(req.body.opensAt) : null,
        closesAt: req.body.closesAt ? new Date(req.body.closesAt) : null,
      },
    })
    res.status(201).json(test)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/admin/tests', authenticate, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admins only' })
  try {
    const where = req.user.courseId ? { courseId: req.user.courseId } : {}
    const tests = await prisma.aITest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { attempts: true } }, course: { select: { id: true, name: true } } },
    })
    res.json(tests)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Student ──────────────────────────────────────────────────

router.use(authenticate, requireStudent)

router.get('/', async (req, res) => {
  try {
    if (!req.user.cohortId || !req.user.courseId) {
      return res.status(403).json({ error: 'You are not enrolled in a course' })
    }
    const now = new Date()
    const courseIds = await enrolledCourseIds(req.user)
    const tests = await prisma.aITest.findMany({
      where: {
        cohortId: req.user.cohortId,
        courseId: { in: courseIds },
        status: 'PUBLISHED',
        AND: [
          { OR: [{ opensAt: null }, { opensAt: { lte: now } }] },
          { OR: [{ closesAt: null }, { closesAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, title: true, description: true, maxScore: true, opensAt: true, closesAt: true,
        courseId: true, course: { select: { name: true } },
        _count: { select: { attempts: true } },
      },
    })

    const [attempts, me] = await Promise.all([
      prisma.aITestAttempt.findMany({ where: { studentId: req.user.id } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { onboardedAt: true } }),
    ])
    const attemptMap = new Map(attempts.map(a => [a.testId, a]))
    const gate = firstTestGate({ onboardedAt: me?.onboardedAt, attempts: attempts.length }, now)

    res.json(tests.map(t => ({
      ...t,
      questionsCount: null, // counts handled on the take endpoint for anti-cheat
      taken: attemptMap.has(t.id),
      score: attemptMap.get(t.id)?.score ?? null,
      lockedUntil: gate.ok ? null : gate.unlocksAt,
      lockReason: gate.ok ? null : gate.reason,
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const test = await prisma.aITest.findUnique({ where: { id: req.params.id } })
    if (!test) return res.status(404).json({ error: 'Test not found' })
    if (!(await isEnrolled(req.user, test.courseId))) return res.status(403).json({ error: 'Not your course' })
    if (test.status !== 'PUBLISHED') return res.status(403).json({ error: 'Test is not published' })

    const now = new Date()
    if (test.opensAt && test.opensAt > now) return res.status(403).json({ error: 'Test has not opened yet' })
    if (test.closesAt && test.closesAt < now) return res.status(403).json({ error: 'Test has closed' })

    const [attemptCount, me] = await Promise.all([
      prisma.aITestAttempt.count({ where: { studentId: req.user.id } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { onboardedAt: true } }),
    ])
    const gate = firstTestGate({ onboardedAt: me?.onboardedAt, attempts: attemptCount }, now)
    if (!gate.ok) return res.status(403).json({ error: gate.reason, unlocksAt: gate.unlocksAt })

    const attempt = await prisma.aITestAttempt.findUnique({
      where: { testId_studentId: { testId: test.id, studentId: req.user.id } },
    })

    let questions = []
    try { questions = JSON.parse(test.questions) } catch { /* ignore */ }

    res.json({
      id: test.id,
      title: test.title,
      description: test.description,
      maxScore: test.maxScore,
      questions,
      taken: !!attempt,
      score: attempt?.score ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:id/submit', async (req, res) => {
  try {
    const test = await prisma.aITest.findUnique({ where: { id: req.params.id } })
    if (!test) return res.status(404).json({ error: 'Test not found' })
    if (!(await isEnrolled(req.user, test.courseId))) return res.status(403).json({ error: 'Not your course' })
    if (test.status !== 'PUBLISHED') return res.status(403).json({ error: 'Test is not published' })

    const now = new Date()
    if (test.opensAt && test.opensAt > now) return res.status(403).json({ error: 'Test has not opened yet' })
    if (test.closesAt && test.closesAt < now) return res.status(403).json({ error: 'Test has closed' })

    const [attemptCount, me] = await Promise.all([
      prisma.aITestAttempt.count({ where: { studentId: req.user.id } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { onboardedAt: true } }),
    ])
    const gate = firstTestGate({ onboardedAt: me?.onboardedAt, attempts: attemptCount }, now)
    if (!gate.ok) return res.status(403).json({ error: gate.reason, unlocksAt: gate.unlocksAt })

    const existing = await prisma.aITestAttempt.findUnique({
      where: { testId_studentId: { testId: test.id, studentId: req.user.id } },
    })
    if (existing) return res.status(409).json({ error: 'You already took this test — one attempt only' })

    if (!req.body.answers || typeof req.body.answers !== 'object') {
      return res.status(400).json({ error: 'answers required' })
    }

    let correctAnswers = []
    try { correctAnswers = JSON.parse(test.correctAnswers) } catch { /* ignore */ }

    const score = scoreMCQ(correctAnswers, req.body.answers)
    if (score === null) return res.status(400).json({ error: 'Malformed test — contact support' })

    const [attempt, user] = await Promise.all([
      prisma.aITestAttempt.create({
        data: {
          testId: test.id,
          studentId: req.user.id,
          answers: JSON.stringify(req.body.answers),
          score,
          submittedAt: now,
        },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { points: { increment: score } },
      }),
    ])

    res.status(201).json({ score, total: correctAnswers.length, attempt: attempt.id, points: user.points })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router