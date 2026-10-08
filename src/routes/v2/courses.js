import { Router } from 'express'
import { prisma } from '../../db.js'
import { authenticate } from '../../middleware/auth.js'
import { selectIntakeCohort } from '../../services/v2-identity.js'
import { isEnrolled } from '../../services/v2-enrollment.js'

const router = Router()

const LIBRARY_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  type: true,
  cloudinaryUrl: true,
  curriculumId: true,
  uploadedAt: true,
}

const canViewLibrary = async (user, courseId) => {
  if (!user) return false
  if (user.role === 'ADMIN') return !user.courseId || user.courseId === courseId
  return user.role === 'STUDENT' && isEnrolled(user, courseId)
}

// ── Course catalogue (public — used by the register page) ────

router.get('/', async (req, res) => {
  try {
    let cohortId = req.query.cohortId
    if (!cohortId) {
      const cohorts = await prisma.cohort.findMany()
      const cohort = selectIntakeCohort(cohorts)
      if (!cohort) return res.json({ cohort: null, courses: [] })
      cohortId = cohort.id
    }

    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: { id: true, name: true, startDate: true, endDate: true },
    })
    if (!cohort) return res.status(404).json({ error: 'Intake not found' })

    const courses = await prisma.course.findMany({
      where: { cohortId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { students: true, materials: true, teachings: true, aiTests: true } } },
    })

    res.json({ cohort, courses })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Course detail ────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { students: true, materials: true, teachings: true, aiTests: true } },
        cohort: { select: { id: true, name: true, startDate: true, endDate: true } },
        curriculum: {
          orderBy: { week: 'asc' },
          select: { id: true, week: true, title: true, description: true },
        },
      },
    })
    if (!course) return res.status(404).json({ error: 'Course not found' })
    res.json(course)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Course library: recordings + materials ───────────────────

router.get('/:id/library', authenticate, async (req, res) => {
  try {
    if (!(await canViewLibrary(req.user, req.params.id))) {
      return res.status(403).json({ error: 'You are not enrolled in this course' })
    }

    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, description: true, imageUrl: true, level: true, durationWeeks: true },
    })
    if (!course) return res.status(404).json({ error: 'Course not found' })

    const rows = await prisma.material.findMany({
      where: { courseId: req.params.id },
      orderBy: { uploadedAt: 'desc' },
      select: LIBRARY_SELECT,
    })

    res.json({
      course,
      recordings: rows.filter(r => r.category === 'RECORDING'),
      materials: rows.filter(r => r.category !== 'RECORDING'),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
