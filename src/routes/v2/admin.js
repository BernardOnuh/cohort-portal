import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../../db.js'
import { uploadBuffer, deleteFile } from '../../services/cloudinary.js'
import { authenticate, requireAdmin } from '../../middleware/auth.js'
import { normalizeCategory, materialTypeFromMime, selectIntakeCohort } from '../../services/v2-identity.js'
import { INVITE_POINTS } from '../../services/v2-onboarding.js'

const router = Router()

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('image must be an image file'))
    cb(null, true)
  },
})

const materialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
})

// multer errors become 400s
const uploadField = (upload, field) => (req, res, next) => {
  upload.single(field)(req, res, (err) => {
    if (!err) return next()
    return res.status(400).json({ error: err.message })
  })
}

router.use(authenticate, requireAdmin)

const isSuperAdmin = (req) => !req.user.courseId
const courseScope  = (req) => (req.user.courseId ? { courseId: req.user.courseId } : {})

async function resolveCourse(req, res) {
  const course = await prisma.course.findUnique({ where: { id: req.params.id } })
  if (!course) { res.status(404).json({ error: 'Course not found' }); return null }
  if (!isSuperAdmin(req) && req.user.courseId !== course.id) {
    res.status(403).json({ error: 'Not your course' })
    return null
  }
  return course
}

async function uploadImage(buffer) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    const err = new Error('Image upload is not configured on this server')
    err.status = 503
    throw err
  }
  return uploadBuffer(buffer, { folder: 'web3nova/v2/courses', resource_type: 'image' })
}

// ── Courses ──────────────────────────────────────────────────

router.get('/courses', async (req, res) => {
  try {
    const courses = await prisma.course.findMany({
      where: courseScope(req),
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { students: true, materials: true, teachings: true, aiTests: true } },
        cohort: { select: { id: true, name: true } },
      },
    })
    res.json(courses)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/courses', uploadField(imageUpload, 'image'), async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'name required' })

  const durationWeeks = req.body.durationWeeks === undefined || req.body.durationWeeks === ''
    ? null : Number.parseInt(req.body.durationWeeks, 10)
  if (durationWeeks !== null && (!Number.isInteger(durationWeeks) || durationWeeks < 1)) {
    return res.status(400).json({ error: 'durationWeeks must be a positive integer' })
  }

  let uploaded
  try {
    let cohortId = req.body.cohortId
    if (!cohortId) {
      const cohort = selectIntakeCohort(await prisma.cohort.findMany())
      if (!cohort) return res.status(400).json({ error: 'No intake cohort yet — create a cohort first' })
      cohortId = cohort.id
    }
    const cohort = await prisma.cohort.findUnique({ where: { id: cohortId } })
    if (!cohort) return res.status(400).json({ error: 'cohortId not found' })

    if (req.file) uploaded = await uploadImage(req.file.buffer)

    const course = await prisma.course.create({
      data: {
        name,
        cohortId,
        description: req.body.description || null,
        level: req.body.level || null,
        durationWeeks,
        imageUrl: uploaded?.secure_url || null,
        imagePublicId: uploaded?.public_id || null,
      },
    })
    res.status(201).json(course)
  } catch (err) {
    if (uploaded) await deleteFile(uploaded.public_id).catch(() => {})
    if (err.code === 'P2002') return res.status(409).json({ error: 'A course with that name already exists in this intake' })
    res.status(err.status || 500).json({ error: err.message })
  }
})

router.patch('/courses/:id', uploadField(imageUpload, 'image'), async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  try {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } })
    if (!course) return res.status(404).json({ error: 'Course not found' })

    const data = {}
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim()
      if (!name) return res.status(400).json({ error: 'name cannot be empty' })
      data.name = name
    }
    if (req.body.description !== undefined) data.description = req.body.description || null
    if (req.body.level !== undefined) data.level = req.body.level || null
    if (req.body.durationWeeks !== undefined && req.body.durationWeeks !== '') {
      const weeks = Number.parseInt(req.body.durationWeeks, 10)
      if (!Number.isInteger(weeks) || weeks < 1) return res.status(400).json({ error: 'durationWeeks must be a positive integer' })
      data.durationWeeks = weeks
    }

    if (req.file) {
      const uploaded = await uploadImage(req.file.buffer)
      data.imageUrl = uploaded.secure_url
      data.imagePublicId = uploaded.public_id
      if (course.imagePublicId) await deleteFile(course.imagePublicId).catch(() => {})
    }

    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' })

    const updated = await prisma.course.update({ where: { id: course.id }, data })
    res.json(updated)
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A course with that name already exists in this intake' })
    res.status(err.status || 500).json({ error: err.message })
  }
})

router.delete('/courses/:id', async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  try {
    const course = await prisma.course.findUnique({ where: { id: req.params.id } })
    if (!course) return res.status(404).json({ error: 'Course not found' })

    const materials = await prisma.material.findMany({ where: { courseId: course.id }, select: { publicId: true } })
    await prisma.course.delete({ where: { id: course.id } })
    await Promise.all(materials.map(m => deleteFile(m.publicId).catch(() => {})))

    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(err.code === 'P2001' ? 404 : 500).json({ error: err.code === 'P2001' ? 'Course not found' : err.message })
  }
})

// ── Materials & recordings ───────────────────────────────────

router.get('/courses/:id/materials', async (req, res) => {
  try {
    const course = await resolveCourse(req, res)
    if (!course) return
    const materials = await prisma.material.findMany({
      where: { courseId: course.id },
      orderBy: { uploadedAt: 'desc' },
    })
    res.json(materials)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/courses/:id/materials', uploadField(materialUpload, 'file'), async (req, res) => {
  try {
    const course = await resolveCourse(req, res)
    if (!course) return

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
    if (!title) return res.status(400).json({ error: 'title required' })
    if (!req.file) return res.status(400).json({ error: 'file required' })

    const category = normalizeCategory(req.body.category)
    if (!category.ok) return res.status(400).json({ error: category.error })

    if (req.body.curriculumId) {
      const week = await prisma.curriculum.findUnique({ where: { id: req.body.curriculumId } })
      if (!week || week.courseId !== course.id) return res.status(400).json({ error: 'curriculumId not found in this course' })
    }

    const type = materialTypeFromMime(req.file.mimetype)
    const folder = category.value === 'RECORDING' ? 'web3nova/v2/recordings' : 'web3nova/v2/materials'
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder,
      resource_type: type === 'video' ? 'video' : 'auto',
    })

    const material = await prisma.material.create({
      data: {
        title,
        description: req.body.description || null,
        category: category.value,
        type,
        cloudinaryUrl: uploaded.secure_url,
        publicId: uploaded.public_id,
        cohortId: course.cohortId,
        courseId: course.id,
        curriculumId: req.body.curriculumId || null,
      },
    })
    res.status(201).json(material)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

router.delete('/materials/:id', async (req, res) => {
  try {
    const material = await prisma.material.findUnique({ where: { id: req.params.id } })
    if (!material) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== material.courseId) {
      return res.status(403).json({ error: 'Not your course' })
    }
    await deleteFile(material.publicId).catch(() => {})
    await prisma.material.delete({ where: { id: material.id } })
    res.json({ message: 'Deleted' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Bonus-task proofs (invite friends) ───────────────────────

router.get('/proofs', async (req, res) => {
  try {
    const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : undefined
    const proofs = await prisma.taskProof.findMany({
      where: {
        ...(status ? { status } : {}),
        // course admins only see their own students
        ...(isSuperAdmin(req) ? {} : { student: { courseId: req.user.courseId } }),
      },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 200,
      include: {
        student: {
          select: { id: true, name: true, studentName: true, imageUrl: true, points: true, studentCourse: { select: { name: true } } },
        },
        reviewedBy: { select: { name: true } },
      },
    })
    const pending = await prisma.taskProof.count({
      where: { status: 'PENDING', ...(isSuperAdmin(req) ? {} : { student: { courseId: req.user.courseId } }) },
    })
    res.json({ pending, proofs })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/proofs/:id', async (req, res) => {
  const action = req.body.action
  if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: "action must be 'approve' or 'reject'" })
  const reviewNote = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 300) || null : null
  try {
    const proof = await prisma.taskProof.findUnique({ where: { id: req.params.id }, include: { student: { select: { courseId: true } } } })
    if (!proof) return res.status(404).json({ error: 'Proof not found' })
    if (!isSuperAdmin(req) && proof.student.courseId !== req.user.courseId) return res.status(403).json({ error: 'Not your course' })

    if (action === 'approve') {
      const already = await prisma.taskProof.count({ where: { studentId: proof.studentId, task: proof.task, status: 'APPROVED' } })
      if (already) return res.status(409).json({ error: 'This student already got points for this task' })
    }

    // guarded update so two admins can't both approve the same proof
    const changed = await prisma.taskProof.updateMany({
      where: { id: proof.id, status: 'PENDING' },
      data: {
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        points: action === 'approve' ? INVITE_POINTS : 0,
        reviewNote,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    })
    if (!changed.count) return res.status(409).json({ error: 'This proof was already reviewed' })
    if (action === 'approve') {
      await prisma.user.update({ where: { id: proof.studentId }, data: { points: { increment: INVITE_POINTS } } })
    }
    res.json(await prisma.taskProof.findUnique({ where: { id: proof.id } }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router
