import { Router } from 'express'
import { prisma } from '../../db.js'
import { authenticate, requireStudent } from '../../middleware/auth.js'
import { scoreMCQ } from '../../services/mcq-score.js'
import { enrolledCourseIds, isEnrolled } from '../../services/v2-enrollment.js'
import {
  FINAL_KIND,
  DEFAULT_SECONDS_PER_QUESTION,
  advanceExpired,
  secondsLeft,
  normalizeChoice,
  socialPlatform,
  isWebUrl,
  certificateCode,
  examStage,
} from '../../services/v2-exam.js'

const router = Router()

const parse = (raw, fallback) => {
  try { return JSON.parse(raw) } catch { return fallback }
}

const secsFor = test => test.secondsPerQuestion || DEFAULT_SECONDS_PER_QUESTION

/** Everything the student page needs to render the current step — never more than one question. */
function examView(test, session, certificate, now = new Date()) {
  const questions = parse(test.questions, [])
  const stage = examStage(session && { ...session, certificateCode: certificate?.code ?? null })
  const current = stage === 'MCQ' ? questions[session.currentIndex] : null
  return {
    id: test.id,
    title: test.title,
    description: test.description,
    course: test.course ? { id: test.course.id, name: test.course.name } : null,
    questionsCount: questions.length,
    secondsPerQuestion: secsFor(test),
    practicalPrompt: test.practicalPrompt,
    stage,
    score: session?.score ?? null,
    practicalUrl: session?.practicalUrl ?? null,
    wantsToEarn: session?.wantsToEarn ?? null,
    wantsCertificate: session?.wantsCertificate ?? null,
    certificate: certificate ? { code: certificate.code, issuedAt: certificate.issuedAt } : null,
    question: current
      ? {
          index: session.currentIndex,
          q: current.q,
          options: current.options,
          secondsLeft: secondsLeft(session.questionStartedAt, secsFor(test), now),
        }
      : null,
  }
}

// ── Public: verify a certificate ─────────────────────────────

router.get('/certificates/:code', async (req, res) => {
  try {
    const cert = await prisma.certificate.findUnique({
      where: { code: String(req.params.code).toUpperCase() },
      include: {
        student: { select: { name: true } },
        course: { select: { name: true, cohort: { select: { name: true } } } },
      },
    })
    if (!cert || cert.status !== 'ISSUED') return res.status(404).json({ error: 'Certificate not found' })
    res.json({
      code: cert.code,
      issuedAt: cert.issuedAt,
      name: cert.student.name,
      course: cert.course.name,
      cohort: cert.course.cohort?.name ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Admin: who finished, their practical and what they chose ──

router.get('/admin/results', authenticate, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admins only' })
  try {
    const courseId = req.user.courseId || (typeof req.query.courseId === 'string' ? req.query.courseId : undefined)
    const sessions = await prisma.examSession.findMany({
      where: { test: { kind: FINAL_KIND, ...(courseId ? { courseId } : {}) } },
      orderBy: { startedAt: 'desc' },
      take: 500,
      include: {
        test: { select: { id: true, title: true, courseId: true, questions: true, course: { select: { name: true } } } },
        student: { select: { id: true, name: true, email: true, studentName: true, imageUrl: true } },
      },
    })
    const certs = await prisma.certificate.findMany({
      where: { studentId: { in: sessions.map(s => s.studentId) } },
      select: { studentId: true, courseId: true, code: true, postUrl: true, platform: true, issuedAt: true },
    })
    const certOf = new Map(certs.map(c => [`${c.studentId}:${c.courseId}`, c]))

    res.json(sessions.map(s => {
      const certificate = certOf.get(`${s.studentId}:${s.test.courseId}`) ?? null
      return {
        id: s.id,
        student: s.student,
        test: { id: s.test.id, title: s.test.title, course: s.test.course?.name ?? null },
        stage: examStage({ ...s, certificateCode: certificate?.code ?? null }),
        score: s.score,
        questionsCount: parse(s.test.questions, []).length,
        practicalUrl: s.practicalUrl,
        practicalNote: s.practicalNote,
        wantsToEarn: s.wantsToEarn,
        joinedGroupAt: s.joinedGroupAt,
        wantsCertificate: s.wantsCertificate,
        certificate,
        startedAt: s.startedAt,
      }
    }))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Student ──────────────────────────────────────────────────

router.use(authenticate, requireStudent)

async function loadTest(req, res) {
  const test = await prisma.aITest.findUnique({
    where: { id: req.params.id },
    include: { course: { select: { id: true, name: true } } },
  })
  if (!test || test.kind !== FINAL_KIND) { res.status(404).json({ error: 'Test not found' }); return null }
  if (!(await isEnrolled(req.user, test.courseId))) { res.status(403).json({ error: 'Not your course' }); return null }
  if (test.status !== 'PUBLISHED') { res.status(403).json({ error: 'Test is not published' }); return null }
  return test
}

const isOpen = (test, now) => !(test.opensAt && test.opensAt > now) && !(test.closesAt && test.closesAt < now)

/** Score the MCQ part once; the attempt row feeds the leaderboard like a Knowledge Check. */
async function finishMcq(test, session, now) {
  const answers = parse(session.answers, {})
  const score = scoreMCQ(parse(test.correctAnswers, []), answers) ?? 0
  const total = parse(test.questions, []).length
  const changed = await prisma.examSession.updateMany({
    where: { id: session.id, mcqDoneAt: null },
    data: { score, mcqDoneAt: now, currentIndex: total },
  })
  if (changed.count) {
    await prisma.aITestAttempt.create({
      data: { testId: test.id, studentId: session.studentId, answers: JSON.stringify(answers), score, submittedAt: now },
    }).catch(err => { if (err.code !== 'P2002') throw err })
    await prisma.user.update({ where: { id: session.studentId }, data: { points: { increment: score } } })
  }
}

/** Current session with any timed-out questions skipped (and scored if that ends the MCQ part). */
async function loadSession(test, studentId, now) {
  const session = await prisma.examSession.findUnique({ where: { testId_studentId: { testId: test.id, studentId } } })
  if (!session || session.mcqDoneAt) return session

  const total = parse(test.questions, []).length
  const next = advanceExpired(session, total, secsFor(test), now)
  if (next.currentIndex !== session.currentIndex) {
    await prisma.examSession.updateMany({ where: { id: session.id, currentIndex: session.currentIndex }, data: next })
  }
  if (next.currentIndex >= total) await finishMcq(test, { ...session, ...next }, now)
  return prisma.examSession.findUnique({ where: { id: session.id } })
}

const certificateFor = (studentId, courseId) =>
  prisma.certificate.findUnique({ where: { studentId_courseId: { studentId, courseId } } })

async function respond(res, test, studentId, now = new Date(), status = 200) {
  const [session, cert] = await Promise.all([loadSession(test, studentId, now), certificateFor(studentId, test.courseId)])
  res.status(status).json(examView(test, session, cert, now))
}

router.get('/', async (req, res) => {
  try {
    if (!req.user.courseId) return res.status(403).json({ error: 'You are not enrolled in a course' })
    const now = new Date()
    const courseIds = await enrolledCourseIds(req.user)
    const tests = await prisma.aITest.findMany({
      where: { kind: FINAL_KIND, status: 'PUBLISHED', courseId: { in: courseIds } },
      orderBy: { createdAt: 'asc' },
      include: { course: { select: { id: true, name: true } } },
    })
    const views = await Promise.all(tests.map(async t => {
      const [session, cert] = await Promise.all([loadSession(t, req.user.id, now), certificateFor(req.user.id, t.courseId)])
      // the list never shows question text
      return { ...examView(t, session, cert, now), question: null, opensAt: t.opensAt, closesAt: t.closesAt, open: isOpen(t, now) }
    }))
    res.json(views)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const test = await loadTest(req, res)
    if (!test) return
    await respond(res, test, req.user.id)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// starts the clock on question 1 (idempotent — a refresh never restarts it)
router.post('/:id/start', async (req, res) => {
  try {
    const test = await loadTest(req, res)
    if (!test) return
    const now = new Date()
    if (!isOpen(test, now)) return res.status(403).json({ error: 'This test is not open right now' })
    if (parse(test.questions, []).length === 0) return res.status(400).json({ error: 'This test has no questions yet' })
    await prisma.examSession.upsert({
      where: { testId_studentId: { testId: test.id, studentId: req.user.id } },
      create: { testId: test.id, studentId: req.user.id, startedAt: now, questionStartedAt: now },
      update: {},
    })
    await respond(res, test, req.user.id, now)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// answer the question on screen; choice null = the timer ran out
router.post('/:id/answer', async (req, res) => {
  try {
    const test = await loadTest(req, res)
    if (!test) return
    const now = new Date()
    const session = await loadSession(test, req.user.id, now)
    if (!session) return res.status(400).json({ error: 'Start the test first' })
    if (session.mcqDoneAt) return respond(res, test, req.user.id, now)

    const questions = parse(test.questions, [])
    const index = Number(req.body.index)
    // that question already timed out — just show where they are now
    if (index !== session.currentIndex) return respond(res, test, req.user.id, now)

    const choice = normalizeChoice(req.body.choice, questions[index].options.length)
    if (!choice.ok) return res.status(400).json({ error: 'Invalid answer' })

    const answers = parse(session.answers, {})
    if (choice.value) answers[String(index)] = choice.value
    const next = { currentIndex: index + 1, questionStartedAt: now, answers: JSON.stringify(answers) }
    // guarded so a double-click can't skip a question
    const changed = await prisma.examSession.updateMany({ where: { id: session.id, currentIndex: index }, data: next })
    if (changed.count && next.currentIndex >= questions.length) await finishMcq(test, { ...session, ...next }, now)

    await respond(res, test, req.user.id, now)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:id/practical', async (req, res) => {
  try {
    const test = await loadTest(req, res)
    if (!test) return
    const session = await loadSession(test, req.user.id, new Date())
    if (!session?.mcqDoneAt) return res.status(409).json({ error: 'Finish the multiple-choice part first' })
    if (session.practicalAt) return res.status(409).json({ error: 'You already submitted your practical' })

    const url = typeof req.body.url === 'string' ? req.body.url.trim() : ''
    if (!isWebUrl(url)) return res.status(400).json({ error: 'Paste a link to your work (starting with https://)' })
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) || null : null

    await prisma.examSession.update({
      where: { id: session.id },
      data: { practicalUrl: url.slice(0, 500), practicalNote: note, practicalAt: new Date() },
    })
    await respond(res, test, req.user.id)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// the questions after the test: { step: 'earn', value } | { step: 'joined' } | { step: 'certificate', value }
router.post('/:id/choice', async (req, res) => {
  try {
    const test = await loadTest(req, res)
    if (!test) return
    const session = await loadSession(test, req.user.id, new Date())
    const cert = session && await certificateFor(req.user.id, test.courseId)
    const stage = examStage(session && { ...session, certificateCode: cert?.code ?? null })
    const { step, value } = req.body

    let data
    if (step === 'earn' && stage === 'ASK_EARN' && typeof value === 'boolean') data = { wantsToEarn: value }
    else if (step === 'joined' && stage === 'JOIN_GROUP') data = { joinedGroupAt: new Date() }
    else if (step === 'certificate' && stage === 'ASK_CERTIFICATE' && typeof value === 'boolean') data = { wantsCertificate: value }
    else return res.status(409).json({ error: 'That step is not available right now' })

    await prisma.examSession.update({ where: { id: session.id }, data })
    await respond(res, test, req.user.id)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// certificate is issued once the student shares a public post about what they learnt
router.post('/:id/certificate', async (req, res) => {
  try {
    const test = await loadTest(req, res)
    if (!test) return
    const session = await loadSession(test, req.user.id, new Date())
    const existing = session && await certificateFor(req.user.id, test.courseId)
    if (examStage(session && { ...session, certificateCode: existing?.code ?? null }) !== 'CERTIFICATE') {
      return res.status(409).json({ error: 'The certificate step is not available right now' })
    }

    const postUrl = typeof req.body.postUrl === 'string' ? req.body.postUrl.trim() : ''
    const platform = socialPlatform(postUrl)
    if (!platform) return res.status(400).json({ error: 'Paste the link to your post on X, Instagram or TikTok' })

    for (let tries = 0; ; tries++) {
      try {
        await prisma.certificate.create({
          data: { code: certificateCode(), studentId: req.user.id, courseId: test.courseId, postUrl: postUrl.slice(0, 500), platform },
        })
        break
      } catch (err) {
        // code collision → retry; already issued for this course (double submit) → fine
        if (err.code !== 'P2002' || tries >= 3) throw err
        if (await certificateFor(req.user.id, test.courseId)) break
      }
    }
    await respond(res, test, req.user.id, new Date(), 201)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
