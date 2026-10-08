import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { prisma } from '../../db.js'
import { uploadBuffer, deleteFile } from '../../services/cloudinary.js'
import { authenticate } from '../../middleware/auth.js'
import { firstTestUnlocksAt } from '../../services/v2-onboarding.js'
import {
  normalizeStudentName,
  validatePassword,
  validateExpectation,
  placeholderEmail,
  selectIntakeCohort,
  publicUser,
} from '../../services/v2-identity.js'

const router = Router()

const IMAGE_LIMIT = 5 * 1024 * 1024

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_LIMIT, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('image must be an image file'))
    cb(null, true)
  },
})

// multer errors (bad mimetype, oversized file) become 400s, not 500s
const uploadAvatarField = (req, res, next) => {
  imageUpload.single('image')(req, res, (err) => {
    if (!err) return next()
    return res.status(400).json({ error: err.message })
  })
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many registration attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      studentName: user.studentName,
      role: user.role,
      cohortId: user.cohortId,
      courseId: user.courseId,
      ver: 2,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
}

function uploadAvatar(buffer) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    const err = new Error('Image upload is not configured on this server')
    err.status = 503
    throw err
  }
  return uploadBuffer(buffer, { folder: 'web3nova/v2/avatars', resource_type: 'image' })
}

// ── Register ─────────────────────────────────────────────────

router.post('/register', registerLimiter, uploadAvatarField, async (req, res) => {
  const nameCheck = normalizeStudentName(req.body.studentName)
  if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error })
  const studentName = nameCheck.value

  const passCheck = validatePassword(req.body.password)
  if (!passCheck.ok) return res.status(400).json({ error: passCheck.error })

  const expCheck = validateExpectation(req.body.expectation)
  if (!expCheck.ok) return res.status(400).json({ error: expCheck.error })

  const { courseId, cohortId } = req.body
  if (!courseId) return res.status(400).json({ error: 'courseId required' })
  if (!req.file) return res.status(400).json({ error: 'image required' })

  let uploaded
  try {
    // resolve intake cohort (explicit or auto)
    let cohort = null
    if (cohortId) {
      cohort = await prisma.cohort.findUnique({ where: { id: cohortId } })
      if (!cohort) return res.status(400).json({ error: 'cohortId not found' })
    } else {
      const cohorts = await prisma.cohort.findMany()
      cohort = selectIntakeCohort(cohorts)
      if (!cohort) return res.status(400).json({ error: 'No open intake. Contact support to register.' })
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } })
    if (!course) return res.status(400).json({ error: 'courseId not found' })
    if (course.cohortId !== cohort.id) return res.status(400).json({ error: 'That course is not part of this intake' })

    // uniqueness
    const [nameTaken, emailGiven] = await Promise.all([
      prisma.user.findUnique({ where: { studentName } }),
      req.body.email
        ? prisma.user.findUnique({ where: { email: String(req.body.email).toLowerCase() } })
        : Promise.resolve(null),
    ])
    if (nameTaken) return res.status(409).json({ error: 'That studentName is already taken' })
    if (emailGiven) return res.status(409).json({ error: 'That email is already registered' })

    const email = req.body.email ? String(req.body.email).toLowerCase() : placeholderEmail(studentName)
    const password = await bcrypt.hash(passCheck.value, 10)

    uploaded = await uploadAvatar(req.file.buffer)

    const user = await prisma.user.create({
      data: {
        name: (req.body.fullName || studentName).trim(),
        email,
        password,
        role: 'STUDENT',
        studentName,
        imageUrl: uploaded.secure_url,
        imagePublicId: uploaded.public_id,
        expectation: expCheck.value,
        cohortId: cohort.id,
        courseId: course.id,
      },
    })

    return res.status(201).json({ token: signToken(user), user: publicUser(user) })
  } catch (err) {
    if (uploaded) await deleteFile(uploaded.public_id).catch(() => {})
    if (err.code === 'P2002') return res.status(409).json({ error: 'That studentName or email is already registered' })
    return res.status(err.status || 500).json({ error: err.message })
  }
})

// ── Login ────────────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
  const nameCheck = normalizeStudentName(req.body.studentName)
  if (!nameCheck.ok) return res.status(400).json({ error: 'studentName and password required' })
  if (!req.body.password) return res.status(400).json({ error: 'studentName and password required' })

  try {
    const user = await prisma.user.findUnique({ where: { studentName: nameCheck.value } })
    if (!user) return res.status(401).json({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(req.body.password, user.password)
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
    if (user.role !== 'STUDENT') return res.status(403).json({ error: 'Use the admin login for this account' })

    res.json({ token: signToken(user), user: publicUser(user) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Profile ──────────────────────────────────────────────────

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        studentCourse: { select: { id: true, name: true, description: true, imageUrl: true, level: true, durationWeeks: true } },
        cohort: { select: { id: true, name: true } },
        enrollments: { include: { course: { select: { id: true, name: true } } } },
      },
    })
    if (!user) return res.status(404).json({ error: 'Not found' })
    const { password, ...rest } = user
    res.json({
      ...publicUser(rest),
      cohort: rest.cohort,
      course: rest.studentCourse,
      extraCourses: rest.enrollments.map(e => e.course),
      onboardedAt: rest.onboardedAt,
      profileBonus: rest.profileBonus,
      firstTestUnlocksAt: firstTestUnlocksAt(rest.onboardedAt),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/me', authenticate, uploadAvatarField, async (req, res) => {
  try {
    const data = {}

    if (req.body.expectation !== undefined) {
      const expCheck = validateExpectation(req.body.expectation)
      if (!expCheck.ok) return res.status(400).json({ error: expCheck.error })
      data.expectation = expCheck.value
    }

    if (req.body.password !== undefined) {
      const passCheck = validatePassword(req.body.password)
      if (!passCheck.ok) return res.status(400).json({ error: passCheck.error })
      data.password = await bcrypt.hash(passCheck.value, 10)
    }

    if (req.body.fullName !== undefined) {
      const value = String(req.body.fullName).trim()
      if (!value) return res.status(400).json({ error: 'fullName cannot be empty' })
      data.name = value
    }

    const current = await prisma.user.findUnique({ where: { id: req.user.id } })
    if (!current) return res.status(404).json({ error: 'Not found' })

    if (req.file) {
      const uploaded = await uploadAvatar(req.file.buffer)
      data.imageUrl = uploaded.secure_url
      data.imagePublicId = uploaded.public_id
      if (current.imagePublicId) await deleteFile(current.imagePublicId).catch(() => {})
    }

    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' })

    const user = await prisma.user.update({ where: { id: req.user.id }, data })
    res.json({ user: publicUser(user) })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

export default router
