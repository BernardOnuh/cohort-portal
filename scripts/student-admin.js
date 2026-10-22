// scripts/student-admin.js — look up students by name, and give one a clean slate.
//
//   node scripts/student-admin.js find "Betty Atolagbe" "Olatunde Victor"     read-only lookup
//   node scripts/student-admin.js reset <userId>                              dry run: shows what would be wiped
//   node scripts/student-admin.js reset <userId> --confirm                    wipes it
//   node scripts/student-admin.js create-test <studentName> [courseName]      dummy student with a random password
//                                     … [--all-courses]                       also enrolls it in every other course of the intake
//   node scripts/student-admin.js delete-test <userId>                        removes a dummy student entirely
//
// A reset keeps the account, login, course enrollment and payment. It removes every
// point source (test attempts, invite proofs, profile bonus), v1 submissions/results/attendance,
// the profile photo (also deleted from Cloudinary) and anthem choice, and sends the student back
// through the welcome story.
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import dotenv from 'dotenv'
import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import { placeholderEmail, selectIntakeCohort } from '../src/services/v2-identity.js'

dotenv.config()
const { deleteFile } = await import('../src/services/cloudinary.js') // after dotenv: it reads Cloudinary keys on load
const adapter = new PrismaLibSql({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const prisma = new PrismaClient({ adapter })

const [cmd, ...args] = process.argv.slice(2)

async function counts(studentId) {
  const where = { studentId }
  const [testAttempts, taskProofs, submissions, assessmentResults, attendances, certificates] = await Promise.all([
    prisma.aITestAttempt.count({ where }),
    prisma.taskProof.count({ where }),
    prisma.submission.count({ where }),
    prisma.assessmentResult.count({ where }),
    prisma.attendance.count({ where }),
    prisma.certificate.count({ where }),
  ])
  return { testAttempts, taskProofs, submissions, assessmentResults, attendances, certificates }
}

async function find(names) {
  for (const query of names) {
    const words = query.trim().split(/\s+/).filter(w => w.length > 2)
    // match anyone whose name or login contains any of the words, then rank by how many matched
    const users = await prisma.user.findMany({
      where: { OR: words.flatMap(w => [{ name: { contains: w } }, { studentName: { contains: w.toLowerCase() } }]) },
      select: {
        id: true, name: true, studentName: true, email: true, role: true, points: true,
        profileBonus: true, onboardedAt: true, createdAt: true, studentCourse: { select: { name: true } },
      },
    })
    const score = u => words.filter(w => `${u.name} ${u.studentName ?? ''}`.toLowerCase().includes(w.toLowerCase())).length
    const ranked = users.map(u => ({ ...u, match: score(u) })).sort((a, b) => b.match - a.match).slice(0, 8)

    console.log(`\n=== "${query}" — ${ranked.length ? `${ranked.length} match(es)` : 'no matches'}`)
    for (const u of ranked) {
      console.log({
        id: u.id,
        name: u.name,
        loginStudentName: u.studentName,
        email: u.email,
        role: u.role,
        course: u.studentCourse?.name ?? null,
        points: u.points,
        profileBonus: u.profileBonus,
        onboarded: !!u.onboardedAt,
        joined: u.createdAt.toISOString().slice(0, 10),
        matchedWords: `${u.match}/${words.length}`,
        ...(await counts(u.id)),
      })
    }
  }
}

async function reset(userId, confirm) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, studentName: true, role: true, points: true, imageUrl: true, imagePublicId: true, gender: true },
  })
  if (!user) throw new Error(`No user with id ${userId}`)
  if (user.role !== 'STUDENT') throw new Error(`${user.name} is ${user.role}, not a STUDENT — refusing`)

  console.log(`\n${confirm ? 'Resetting' : 'DRY RUN — would reset'} ${user.name} (${user.studentName}), currently ${user.points} pts`)
  console.log('Records to delete:', await counts(user.id))
  console.log('Profile to clear:', { photo: user.imageUrl ?? 'none', anthemGender: user.gender ?? 'none' })
  if (!confirm) return console.log('\nNothing changed. Re-run with --confirm to apply.')

  const where = { studentId: user.id }
  await prisma.$transaction([
    prisma.aITestAttempt.deleteMany({ where }),
    prisma.taskProof.deleteMany({ where }),
    prisma.submission.deleteMany({ where }),
    prisma.assessmentResult.deleteMany({ where }),
    prisma.attendance.deleteMany({ where }),
    prisma.certificate.deleteMany({ where }),
    prisma.examSession.deleteMany({ where }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        points: 0, profileBonus: null, profileCompletedAt: null, onboardedAt: null,
        imageUrl: null, imagePublicId: null, gender: null,
      },
    }),
  ])
  if (user.imagePublicId) {
    try {
      await deleteFile(user.imagePublicId)
    } catch (err) {
      console.warn(`Photo unlinked, but Cloudinary delete failed (${err.message}) — remove ${user.imagePublicId} by hand`)
    }
  }
  console.log('Done. After:', await counts(user.id), '— points now 0, off the leaderboard.')
}

async function createTest(studentName, courseQuery, allCourses = false) {
  const cohort = selectIntakeCohort(await prisma.cohort.findMany())
  if (!cohort) throw new Error('No open intake cohort')
  const courses = await prisma.course.findMany({ where: { cohortId: cohort.id }, orderBy: { name: 'asc' } })
  const course = courseQuery
    ? courses.find(c => c.name.toLowerCase().includes(courseQuery.toLowerCase()))
    : courses[0]
  if (!course) throw new Error(`No course matching "${courseQuery}" in ${cohort.name}: ${courses.map(c => c.name).join(', ')}`)

  const password = randomBytes(6).toString('base64url')
  const user = await prisma.user.create({
    data: {
      name: 'Test Student',
      email: placeholderEmail(studentName),
      password: await bcrypt.hash(password, 10),
      role: 'STUDENT',
      studentName,
      cohortId: cohort.id,
      courseId: course.id,
    },
  })
  if (allCourses) {
    const others = courses.filter(c => c.id !== course.id)
    await prisma.enrollment.createMany({ data: others.map(c => ({ studentId: user.id, courseId: c.id })) })
  }
  console.log({ id: user.id, studentName, password, cohort: cohort.name, course: course.name, ...(allCourses && { alsoEnrolled: courses.length - 1 }) })
  console.log(`Remove later with: node scripts/student-admin.js delete-test ${user.id}`)
}

async function deleteTest(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, studentName: true } })
  if (!user) throw new Error(`No user with id ${userId}`)
  if (user.name !== 'Test Student') throw new Error(`${user.name} is not a test account — refusing`)
  await reset(userId, true) // clears dependent rows and the photo first
  await prisma.payment.deleteMany({ where: { studentId: userId } })
  await prisma.user.delete({ where: { id: userId } })
  console.log(`Deleted test account ${user.studentName}`)
}

try {
  if (cmd === 'find' && args.length) await find(args)
  else if (cmd === 'create-test' && args[0]) {
    const all = args.includes('--all-courses')
    const [name, course] = args.filter(a => a !== '--all-courses')
    await createTest(name, course, all)
  }
  else if (cmd === 'delete-test' && args[0]) await deleteTest(args[0])
  else if (cmd === 'reset' && args[0]) await reset(args[0], args.includes('--confirm'))
  else console.log('usage:\n  node scripts/student-admin.js find "<name>" ["<name>" ...]\n  node scripts/student-admin.js reset <userId> [--confirm]')
} catch (err) {
  console.error('Error:', err.message)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
