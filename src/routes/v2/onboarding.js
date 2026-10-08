import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../../db.js'
import { uploadBuffer, deleteFile } from '../../services/cloudinary.js'
import { authenticate, requireStudent } from '../../middleware/auth.js'
import { validateExpectation, publicUser } from '../../services/v2-identity.js'
import {
  EARLY_BIRD_SLOTS,
  profileBonusFor,
  firstTestUnlocksAt,
  normalizeGender,
} from '../../services/v2-onboarding.js'

const router = Router()

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('image must be an image file'))
    cb(null, true)
  },
})

const uploadAvatarField = (req, res, next) => {
  imageUpload.single('image')(req, res, (err) => {
    if (!err) return next()
    return res.status(400).json({ error: err.message })
  })
}

const uploadsEnabled = () => !!process.env.CLOUDINARY_CLOUD_NAME

const COURSE_SELECT = { id: true, name: true, description: true, imageUrl: true, level: true }

router.use(authenticate, requireStudent)

async function loadStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      studentCourse: { select: COURSE_SELECT },
      cohort: { select: { id: true, name: true } },
      enrollments: { include: { course: { select: COURSE_SELECT } }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!user) return null

  const [available, completed] = await Promise.all([
    user.cohortId
      ? prisma.course.findMany({ where: { cohortId: user.cohortId }, orderBy: { createdAt: 'asc' }, select: COURSE_SELECT })
      : [],
    user.cohortId
      ? prisma.user.count({ where: { cohortId: user.cohortId, role: 'STUDENT', profileCompletedAt: { not: null } } })
      : 0,
  ])

  return {
    user: { ...publicUser(user), gender: user.gender },
    cohort: user.cohort,
    course: user.studentCourse,
    extraCourses: user.enrollments.map(e => e.course),
    availableCourses: available.filter(c => c.id !== user.courseId),
    onboardedAt: user.onboardedAt,
    profileCompletedAt: user.profileCompletedAt,
    profileBonus: user.profileBonus,
    earlyBirdSlotsLeft: Math.max(0, EARLY_BIRD_SLOTS - completed),
    firstTestUnlocksAt: firstTestUnlocksAt(user.onboardedAt),
    uploadsEnabled: uploadsEnabled(),
  }
}

// ── Status ───────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const status = await loadStatus(req.user.id)
    if (!status) return res.status(404).json({ error: 'Not found' })
    res.json(status)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Extra courses: replace the set of additional courses ─────

router.put('/courses', async (req, res) => {
  const ids = Array.isArray(req.body.courseIds) ? [...new Set(req.body.courseIds.map(String))] : null
  if (!ids) return res.status(400).json({ error: 'courseIds array required' })
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } })
    if (!user?.cohortId) return res.status(400).json({ error: 'You are not part of an intake' })

    const wanted = ids.filter(id => id !== user.courseId)
    if (wanted.length) {
      const valid = await prisma.course.count({ where: { id: { in: wanted }, cohortId: user.cohortId } })
      if (valid !== wanted.length) return res.status(400).json({ error: 'Some courses are not part of your intake' })
    }

    await prisma.enrollment.deleteMany({ where: { studentId: user.id, courseId: { notIn: wanted } } })
    for (const courseId of wanted) {
      await prisma.enrollment.upsert({
        where: { studentId_courseId: { studentId: user.id, courseId } },
        update: {},
        create: { studentId: user.id, courseId },
      })
    }
    res.json(await loadStatus(user.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Profile step: photo + expectation, awards the one-time bonus ─

router.post('/profile', uploadAvatarField, async (req, res) => {
  let uploaded
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } })
    if (!user) return res.status(404).json({ error: 'Not found' })

    const data = {}
    if (req.body.fullName !== undefined) {
      const name = String(req.body.fullName).trim()
      if (!name) return res.status(400).json({ error: 'fullName cannot be empty' })
      data.name = name
    }
    if (req.body.expectation !== undefined && req.body.expectation !== '') {
      const check = validateExpectation(req.body.expectation)
      if (!check.ok) return res.status(400).json({ error: check.error })
      data.expectation = check.value
    }
    if (!data.expectation && !user.expectation) {
      return res.status(400).json({ error: 'Tell us what you hope to get from the course' })
    }
    if (req.body.gender !== undefined && req.body.gender !== '') {
      const gender = normalizeGender(req.body.gender)
      if (!gender) return res.status(400).json({ error: 'gender must be MALE or FEMALE' })
      data.gender = gender
    }
    if (!data.gender && !user.gender) return res.status(400).json({ error: 'Tell us if you are a boy or a girl' })

    if (req.file) {
      if (!uploadsEnabled()) return res.status(503).json({ error: 'Image upload is not configured on this server' })
      uploaded = await uploadBuffer(req.file.buffer, { folder: 'web3nova/v2/avatars', resource_type: 'image' })
      data.imageUrl = uploaded.secure_url
      data.imagePublicId = uploaded.public_id
    } else if (!user.imageUrl && uploadsEnabled()) {
      return res.status(400).json({ error: 'Add a profile photo' })
    }

    // claim the bonus exactly once (guarded update), then rank by completion time
    const now = new Date()
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, profileCompletedAt: null },
      data: { ...data, profileCompletedAt: now },
    })

    let bonus = user.profileBonus
    let rank = null
    if (claimed.count === 1) {
      const ahead = await prisma.user.count({
        where: {
          cohortId: user.cohortId,
          role: 'STUDENT',
          id: { not: user.id },
          OR: [
            { profileCompletedAt: { lt: now } },
            { profileCompletedAt: now, id: { lt: user.id } },
          ],
        },
      })
      rank = ahead + 1
      bonus = profileBonusFor(ahead)
      await prisma.user.update({ where: { id: user.id }, data: { profileBonus: bonus, points: { increment: bonus } } })
    } else if (Object.keys(data).length) {
      await prisma.user.update({ where: { id: user.id }, data })
    }

    if (uploaded && user.imagePublicId) await deleteFile(user.imagePublicId).catch(() => {})

    const status = await loadStatus(user.id)
    res.json({ ...status, awarded: claimed.count === 1 ? bonus : 0, rank })
  } catch (err) {
    if (uploaded) await deleteFile(uploaded.public_id).catch(() => {})
    res.status(err.status || 500).json({ error: err.message })
  }
})

// ── Finish the welcome story: starts the 24h first-test countdown ─

router.post('/complete', async (req, res) => {
  try {
    await prisma.user.updateMany({
      where: { id: req.user.id, onboardedAt: null },
      data: { onboardedAt: new Date() },
    })
    res.json(await loadStatus(req.user.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
