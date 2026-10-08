import { Router } from 'express'
import { prisma } from '../../db.js'
import { selectIntakeCohort } from '../../services/v2-identity.js'
import { firstEarnedAt } from '../../services/v2-onboarding.js'

const router = Router()

// Public — no auth. The leaderboard is meant to be shown to anyone.
router.get('/', async (req, res) => {
  try {
    let cohortId = req.query.cohortId
    if (!cohortId) {
      const cohort = selectIntakeCohort(await prisma.cohort.findMany())
      if (!cohort) return res.json({ cohort: null, total: 0, entries: [] })
      cohortId = cohort.id
    }

    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: { id: true, name: true },
    })
    if (!cohort) return res.status(404).json({ error: 'Intake not found' })

    const top = Math.min(Math.max(Number.parseInt(req.query.top, 10) || 50, 1), 200)
    const courseId = req.query.courseId || null

    const students = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        cohortId,
        points: { gt: 0 },
        ...(courseId ? { courseId } : {}),
      },
      // no `take` here: ties are broken in JS below, so cutting first would pick the wrong students
      orderBy: [{ points: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        imageUrl: true,
        courseId: true,
        points: true,
        profileCompletedAt: true,
        studentCourse: { select: { name: true } },
      },
    })

    // tie-break: higher points first, then whoever earned points first (first test or profile bonus)
    const ids = students.map(s => s.id)
    const groups = ids.length
      ? await prisma.aITestAttempt.groupBy({
          by: ['studentId'],
          where: { studentId: { in: ids } },
          _min: { submittedAt: true },
          _count: { _all: true },
        })
      : []

    const meta = new Map(groups.map(g => [g.studentId, { first: g._min.submittedAt, count: g._count._all }]))

    const entries = students
      .map(s => ({
        id: s.id,
        name: s.name,
        imageUrl: s.imageUrl,
        courseId: s.courseId,
        courseName: s.studentCourse?.name ?? null,
        points: s.points,
        testsTaken: meta.get(s.id)?.count ?? 0,
        earnedAt: firstEarnedAt(meta.get(s.id)?.first, s.profileCompletedAt),
      }))
      .sort((a, b) => b.points - a.points || (a.earnedAt === b.earnedAt ? 0 : a.earnedAt - b.earnedAt))
      .map((e, i) => ({ rank: i + 1, ...e, earnedAt: undefined }))

    res.json({ cohort, total: entries.length, entries: entries.slice(0, top) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router