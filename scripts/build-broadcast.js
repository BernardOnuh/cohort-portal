// scripts/build-broadcast.js — build the encrypted roster behind the frontend's /broadcast page.
//
//   node scripts/build-broadcast.js
//
// Joins every student in the DB with their phone from scripts/data/intake-report.csv, checks each
// one's default password (first name, lowercased) against the live hash, splits the list between
// the senders, and writes it AES-256-GCM encrypted to web3-nova-academy/public/broadcast.enc.json.
// Both repos are public: only the ciphertext is committed. The page asks for a password; the AES key
// is derived from it with PBKDF2, so the file is unreadable without it. The password lives in
// scripts/data/broadcast-password.txt (gitignored) and is reused on re-runs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { parse } from 'csv-parse/sync'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'

dotenv.config()
const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, 'data')
const OUT = join(__dirname, '..', '..', 'web3-nova-academy', 'public', 'broadcast.enc.json')
const PASS_FILE = join(DATA, 'broadcast-passwords.json')
const ITERATIONS = 250_000
const SENDERS = ['Bernard', 'Jenola', 'Ayobami', 'Julius']
const PORTAL = 'https://acad.web3nova.org'

const adapter = new PrismaLibSql({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const prisma = new PrismaClient({ adapter })

/** Nigerian numbers → 234XXXXXXXXXX for wa.me; null when it can't be a real number */
function waPhone(raw) {
  const first = String(raw || '').split(/[;,/]/)[0]
  let d = first.replace(/\D/g, '')
  if (d.startsWith('234')) d = d.slice(3)
  if (d.startsWith('0')) d = d.slice(1)
  return d.length === 10 ? `234${d}` : null
}

const defaultPassword = name => (name.split(/\s+/)[0] || 'student').toLowerCase().replace(/[^a-z0-9]/g, '')

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

try {
  const report = parse(readFileSync(join(DATA, 'intake-report.csv'), 'utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true })
  const phoneBy = new Map()
  for (const r of report) {
    if (r.studentName) phoneBy.set(`h:${r.studentName}`, r.phone)
    if (r.email) phoneBy.set(`e:${r.email.toLowerCase()}`, r.phone)
  }

  const users = await prisma.user.findMany({
    where: { role: 'STUDENT', NOT: { name: 'Test Student' } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, studentName: true, email: true, password: true, studentCourse: { select: { name: true } } },
  })

  console.log(`Checking ${users.length} passwords against the live hashes…`)
  const students = await mapLimit(users, 8, async u => {
    const candidate = defaultPassword(u.name)
    const ok = await bcrypt.compare(candidate, u.password)
    const rawPhone = phoneBy.get(`h:${u.studentName}`) ?? phoneBy.get(`e:${u.email.toLowerCase()}`) ?? null
    return {
      id: u.id,
      name: u.name.replace(/\s+/g, ' ').trim(),
      course: u.studentCourse?.name ?? null,
      studentName: u.studentName,
      password: ok ? candidate : null, // null: they set their own password at registration
      phone: waPhone(rawPhone),
      rawPhone,
    }
  })

  // even split, in name order
  const size = Math.ceil(students.length / SENDERS.length)
  students.forEach((s, i) => { s.sender = SENDERS[Math.floor(i / size)] })

  // one password per team member; each one unlocks only that member's share of the list
  const passwords = existsSync(PASS_FILE) ? JSON.parse(readFileSync(PASS_FILE, 'utf8')) : {}
  for (const sender of SENDERS) {
    passwords[sender] ??= `${sender.toLowerCase()}-${randomBytes(4).toString('hex')}`
  }
  writeFileSync(PASS_FILE, JSON.stringify(passwords, null, 2) + '\n')

  const generatedAt = new Date().toISOString()
  const groups = SENDERS.map(sender => {
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = pbkdf2Sync(passwords[sender], salt, ITERATIONS, 32, 'sha256')
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const plain = JSON.stringify({ generatedAt, portal: PORTAL, sender, students: students.filter(x => x.sender === sender) })
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]) // WebCrypto wants tag appended
    return { salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') }
  })
  writeFileSync(OUT, JSON.stringify({ v: 3, iterations: ITERATIONS, groups }))

  const by = s => students.filter(x => x.sender === s)
  console.log(`\nWrote ${OUT}`)
  console.log(`  no usable phone: ${students.filter(s => !s.phone).length}`)
  console.log(`  own password (not the default): ${students.filter(s => !s.password).length}`)
  console.log(`\nPage: ${PORTAL}/broadcast  (passwords saved in scripts/data/broadcast-passwords.json)`)
  for (const s of SENDERS) console.log(`  ${s.padEnd(8)} ${String(by(s).length).padStart(3)} students   password: ${passwords[s]}`)
} catch (err) {
  console.error('Error:', err.message)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
