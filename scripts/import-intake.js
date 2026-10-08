import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'

dotenv.config()
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, 'data')

const adapter = new PrismaLibSql({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const prisma = new PrismaClient({ adapter })

const SLUG = s => String(s).trim().toLowerCase().replace(/[^a-z0-9.@]/g, '.')
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function parseTsv(file) {
  return readFileSync(join(DATA, file), 'utf8')
    .split('\n')
    .map(line => line.split('\t'))
    .filter(row => row.length > 1 && row[1].trim())
    .map(row => row.map(c => c.trim()))
}

function parseDate(ts) {
  const [md, hm] = ts.split(' ')
  if (!md || !hm) return new Date()
  const [m, d, y] = md.split('/').map(Number)
  const [h, mi, s] = hm.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s || 0)
}

function courseFor(skill) {
  const s = String(skill || '').toLowerCase()
  if (/web/.test(s)) return 'Web Development'
  if (/ui\s?\/?\s?ux|uiux/.test(s)) return 'UI/UX'
  if (/automation|automate/.test(s)) return 'AI Automation'
  if (/prompt/.test(s)) return 'AI Prompting'
  if (/blockchain|smart contract/.test(s)) return 'Blockchain Development'
  return null
}

function handleFor(name) {
  const tokens = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens.length === 1) return tokens[0]
  return `${tokens[0]}.${tokens[tokens.length - 1]}`
}

async function main() {
  const sheet1 = parseTsv('sheet1.tsv')
  const sheet2 = parseTsv('sheet2.tsv')

  // normalized rows: { at, name, email, phone, skill, extra, meta }
  const s1 = sheet1.map(r => ({ at: parseDate(r[0]), name: r[1], email: SLUG(r[2]), phone: r[3], skill: r[5], extra: `Level: ${r[4]} · Expectation: ${r[6]} · Hours: ${r[7]} · Location: ${r[8]}` }))
  const s2 = sheet2.map(r => ({ at: parseDate(r[0]), name: r[1], email: SLUG(r[2]), phone: r[3], skill: r[6], extra: `Age: ${r[4]} · Hours: ${r[5]}` }))

  // join: sheet1 wins per email, else earliest submission within sheet
  const byEmail1 = new Map()
  for (const row of s1) if (!byEmail1.has(row.email)) byEmail1.set(row.email, row)
  const byEmail2 = new Map()
  for (const row of s2) {
    const existing = byEmail2.get(row.email)
    if (!existing || row.at < existing.at) byEmail2.set(row.email, row)
  }

  const merged = new Map(byEmail1)
  for (const [email, row] of byEmail2) if (!merged.has(email)) merged.set(email, row)

  console.log(`rows: sheet1=${s1.length} sheet2=${s2.length} unique emails=${merged.size}`)

  if (process.argv.includes('--reset')) {
    const target = [...merged.values()].map(r => r.email).concat(
      [...merged.values()].filter(r => !EMAIL_RE.test(r.email)).map(r => `${handleFor(r.name) || 'student'}@rebuild.web3nova.app`)
    )
    const doomed = await prisma.user.findMany({ where: { email: { in: [...new Set(target)] } }, select: { id: true } })
    const ids = doomed.map(u => u.id)
    if (ids.length) {
      await prisma.aITestAttempt.deleteMany({ where: { studentId: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
      console.log(`--reset: removed ${ids.length} previous imports`)
    }
  }

  const cohort = await prisma.cohort.findFirst({ orderBy: { startDate: 'desc' } })
  if (!cohort) throw new Error('No intake cohort found')
  const courses = new Map()
  for (const name of ['Web Development', 'UI/UX', 'Mobile App Development', 'AI Automation', 'AI Prompting', 'Blockchain Development']) {
    const c = await prisma.course.findFirst({ where: { name, cohortId: cohort.id } })
    if (c) courses.set(name, c)
    else if (name !== 'Mobile App Development') console.warn(`!! course missing: ${name}`)
  }
  const usedHandles = new Set((await prisma.user.findMany({ select: { studentName: true } })).map(u => u.studentName))
  const usedEmails = new Set((await prisma.user.findMany({ select: { email: true } })).map(u => u.email))

  const created = [], skipped = [], ignored = []
  for (const row of [...merged.values()].sort((a, b) => a.at - b.at)) {
    const course = courseFor(row.skill)
    if (!course) { ignored.push({ ...row, reason: `unmapped skill: ${row.skill}` }); continue }
    const courseRec = courses.get(course)
    if (!courseRec) { ignored.push({ ...row, reason: `course missing: ${course}` }); continue }
    if (usedEmails.has(row.email)) { skipped.push({ ...row, reason: 'email already exists' }); continue }

    const base = handleFor(row.name) || 'student'
    let handle = base, n = 2
    while (usedHandles.has(handle)) handle = `${base}-${n++}`
    usedHandles.add(handle)

    let email = EMAIL_RE.test(row.email) ? row.email : `${handle}@rebuild.web3nova.app`
    if (usedEmails.has(email)) email = `${handle}.${Date.now()}@rebuild.web3nova.app`
    usedEmails.add(email)

    const password = (row.name.split(/\s+/)[0] || 'student').toLowerCase().replace(/[^a-z0-9]/g, '')

    created.push({ ...(await prisma.user.create({
      data: {
        name: row.name,
        email,
        password: await bcrypt.hash(password, 10),
        role: 'STUDENT',
        studentName: handle,
        expectation: row.extra,
        points: 0,
        imageUrl: null,
        cohortId: cohort.id,
        courseId: courseRec.id,
        createdAt: row.at,
      },
    })), courseName: course, _password: password, phone: row.phone })
  }

  // ops reports
  const creds = created.map(u => ({ studentName: u.studentName, email: u.email, password: u._password, name: u.name }))
  writeFileSync(join(DATA, 'intake-credentials.csv'),
    ['studentName,email,password,name'].join(',') + '\n' +
    creds.map(c => `"${c.studentName}","${c.email}","${c.password}","${c.name.replace(/"/g, '""')}"`).join('\n') + '\n')
  writeFileSync(join(DATA, 'intake-report.csv'),
    ['name,email,phone,studentName,course,createdAt,notes'].join(',') + '\n' +
    created.map(u => [`"${u.name.replace(/"/g, '""')}"`, u.email, u.phone || '', u.studentName, u.courseName, u.createdAt.toISOString(), u.expectation.replace(/"/g, '""')].join(',')).join('\n') + '\n')

  console.log(`imported=${created.length} skipped(dup)=${skipped.length} ignored=${ignored.length}`)
  if (ignored.length) { console.log('ignored:'); ignored.forEach(i => console.log(`  - ${i.name} (${i.email}) — ${i.reason}`)) }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e.message); process.exit(1) })