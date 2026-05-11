import { Router } from 'express'
import { prisma } from '../db.js'
import { authenticate, requireStudent } from '../middleware/auth.js'
import { initTransaction, verifyTransaction } from '../services/monnify.js'

const router = Router()

// ── Fee constants ─────────────────────────────────────────────

const FULL_FEE     = 70_000
const INSTALMENT_1 = 35_000

function getDeadlines() {
  const year = new Date().getFullYear()
  return {
    instalment1Due: new Date(`${year}-06-07T23:59:59.000Z`),
    instalment2Due: new Date(`${year}-07-07T23:59:59.000Z`),
  }
}

function getAllowedPayment(paymentRecord) {
  const { instalment1Due, instalment2Due } = getDeadlines()
  const now = new Date()

  if (!paymentRecord) {
    return { canPayFull: true, canPayInstalment1: now <= instalment1Due, canPayInstalment2: false }
  }

  const { status } = paymentRecord
  if (status === 'COMPLETED') {
    return { canPayFull: false, canPayInstalment1: false, canPayInstalment2: false }
  }
  if (status === 'INSTALMENT_1_PAID') {
    return { canPayFull: false, canPayInstalment1: false, canPayInstalment2: now <= instalment2Due }
  }

  // PENDING — still on first payment
  return { canPayFull: true, canPayInstalment1: now <= instalment1Due, canPayInstalment2: false }
}

// ── Routes ────────────────────────────────────────────────────

router.use(authenticate, requireStudent)

/**
 * GET /payments/status
 * Returns the student's payment record and what they can still pay.
 */
router.get('/status', async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { studentId: req.user.id } })
    const allowed = getAllowedPayment(payment)
    const { instalment1Due, instalment2Due } = getDeadlines()

    res.json({
      payment: payment || null,
      totalFee: FULL_FEE,
      deadlines: { instalment1: instalment1Due, instalment2: instalment2Due },
      allowed,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/**
 * POST /payments/initiate
 * Body: { paymentType: 'full' | 'instalment1' | 'instalment2' }
 * Returns a Monnify checkout URL.
 */
router.post('/initiate', async (req, res) => {
  const { paymentType } = req.body
  if (!['full', 'instalment1', 'instalment2'].includes(paymentType)) {
    return res.status(400).json({ error: "paymentType must be 'full', 'instalment1', or 'instalment2'" })
  }

  try {
    const existing = await prisma.payment.findUnique({ where: { studentId: req.user.id } })
    const allowed  = getAllowedPayment(existing)

    if (paymentType === 'full'        && !allowed.canPayFull)        return res.status(403).json({ error: 'Full payment not allowed at this stage' })
    if (paymentType === 'instalment1' && !allowed.canPayInstalment1) return res.status(403).json({ error: 'First instalment window has closed or already paid' })
    if (paymentType === 'instalment2' && !allowed.canPayInstalment2) return res.status(403).json({ error: 'Second instalment not yet due or window has closed' })

    const amount = paymentType === 'full' ? FULL_FEE : INSTALMENT_1
    const ref    = `AP-${req.user.id.slice(0, 8).toUpperCase()}-${paymentType.toUpperCase()}-${Date.now()}`

    const descriptions = {
      full:        'Academic portal full tuition fee (₦70,000)',
      instalment1: 'Academic portal tuition — 1st instalment (₦35,000)',
      instalment2: 'Academic portal tuition — 2nd instalment (₦35,000)',
    }

    const txn = await initTransaction({
      amount,
      email:       req.user.email,
      name:        req.user.name,
      ref,
      description: descriptions[paymentType],
    })

    // Save or update the pending ref so polling can check it
    if (!existing) {
      await prisma.payment.create({
        data: {
          studentId:   req.user.id,
          cohortId:    req.user.cohortId,
          courseId:    req.user.courseId,
          status:      'PENDING',
          amountPaid:  0,
          pendingRef:  ref,
          pendingType: paymentType,
        },
      })
    } else {
      await prisma.payment.update({
        where: { studentId: req.user.id },
        data:  { pendingRef: ref, pendingType: paymentType },
      })
    }

    res.json({
      checkoutUrl:          txn.checkoutUrl,
      transactionReference: txn.transactionReference,
      ref,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/**
 * GET /payments/poll
 * The frontend calls this every few seconds after the Monnify redirect.
 * It checks the pending transaction with Monnify and updates the DB if paid.
 *
 * Response shape:
 *   { status, amountPaid, done, monnifyStatus? }
 *
 *   done: true  → stop polling (payment confirmed or failed/cancelled)
 *   done: false → keep polling
 */
router.get('/poll', async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { studentId: req.user.id } })

    if (!payment) return res.status(404).json({ error: 'No payment record found' })

    // Already settled — no need to call Monnify
    if (payment.status === 'COMPLETED' || payment.status === 'INSTALMENT_1_PAID') {
      return res.json({ status: payment.status, amountPaid: payment.amountPaid, done: true })
    }

    if (!payment.pendingRef) {
      return res.json({ status: payment.status, amountPaid: payment.amountPaid, done: false })
    }

    // Ask Monnify for the current state of the pending transaction
    let txn
    try {
      txn = await verifyTransaction(payment.pendingRef)
    } catch {
      // Transaction not found on Monnify yet — keep polling
      return res.json({ status: payment.status, amountPaid: payment.amountPaid, done: false })
    }

    if (txn.paymentStatus !== 'PAID') {
      const done = ['FAILED', 'CANCELLED', 'EXPIRED'].includes(txn.paymentStatus)
      return res.json({
        status:        payment.status,
        monnifyStatus: txn.paymentStatus,
        amountPaid:    payment.amountPaid,
        done,
      })
    }

    // Payment confirmed — update the record
    const newAmountPaid = payment.amountPaid + txn.amountPaid

    let newStatus
    if (payment.pendingType === 'full')          newStatus = 'COMPLETED'
    else if (payment.pendingType === 'instalment1') newStatus = 'INSTALMENT_1_PAID'
    else if (payment.pendingType === 'instalment2') newStatus = 'COMPLETED'

    await prisma.payment.update({
      where: { studentId: req.user.id },
      data: {
        status:      newStatus,
        amountPaid:  newAmountPaid,
        pendingRef:  null,
        pendingType: null,
        lastPaidAt:  new Date(),
        monnifyRef:  payment.pendingRef,
      },
    })

    res.json({ status: newStatus, amountPaid: newAmountPaid, done: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router