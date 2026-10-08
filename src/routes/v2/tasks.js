import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../../db.js'
import { uploadBuffer, deleteFile } from '../../services/cloudinary.js'
import { authenticate, requireStudent } from '../../middleware/auth.js'
import { INVITE_TASK, INVITE_POINTS, inviteTaskState } from '../../services/v2-onboarding.js'

const router = Router()

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Proof must be a screenshot (image)'))
    cb(null, true)
  },
})

const proofField = (req, res, next) => {
  proofUpload.single('image')(req, res, (err) => {
    if (!err) return next()
    return res.status(400).json({ error: err.message })
  })
}

const PROOF_SELECT = { id: true, status: true, imageUrl: true, note: true, points: true, reviewNote: true, createdAt: true, reviewedAt: true }

router.use(authenticate, requireStudent)

async function inviteStatus(studentId) {
  const proofs = await prisma.taskProof.findMany({
    where: { studentId, task: INVITE_TASK },
    orderBy: { createdAt: 'desc' },
    select: PROOF_SELECT,
  })
  return { task: INVITE_TASK, points: INVITE_POINTS, state: inviteTaskState(proofs), latest: proofs[0] ?? null }
}

// ── Invite friends to the 7-day boot camp: status ───────────────

router.get('/invite', async (req, res) => {
  try {
    res.json(await inviteStatus(req.user.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Submit a screenshot as proof (reviewed by an admin) ─────────

router.post('/invite/proof', proofField, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a screenshot as proof' })
  if (!process.env.CLOUDINARY_CLOUD_NAME) return res.status(503).json({ error: 'Image upload is not configured on this server' })

  let uploaded
  try {
    const current = await inviteStatus(req.user.id)
    if (current.state === 'APPROVED') return res.status(409).json({ error: 'You already earned these points' })
    if (current.state === 'PENDING') return res.status(409).json({ error: 'Your proof is already waiting for review' })

    uploaded = await uploadBuffer(req.file.buffer, { folder: 'web3nova/v2/task-proofs', resource_type: 'image' })
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 300) || null : null
    await prisma.taskProof.create({
      data: {
        studentId: req.user.id,
        task: INVITE_TASK,
        imageUrl: uploaded.secure_url,
        imagePublicId: uploaded.public_id,
        note,
      },
    })
    res.status(201).json(await inviteStatus(req.user.id))
  } catch (err) {
    if (uploaded) await deleteFile(uploaded.public_id).catch(() => {})
    res.status(err.status || 500).json({ error: err.message })
  }
})

export default router
