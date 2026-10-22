// Creates each course's FINAL test from scripts/final-exams.json and puts the class slides in the course Library.
//
//   node scripts/setup-final-exams.js --slides <dir>            # dry run: shows what would change
//   node scripts/setup-final-exams.js --slides <dir> --apply    # writes to TURSO_DATABASE_URL + uploads to Cloudinary
//
// <dir> holds <file>.pdf and <file>.pptx for every "slides.file" in final-exams.json.
// PDFs are served by the website (web3-nova-academy/public/slides/web3nova-<file>.pdf) because this
// Cloudinary account blocks PDF delivery; only the .pptx is uploaded.
// Safe to re-run: existing tests (matched by course + title) and slides (matched by title) are skipped.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import dotenv from 'dotenv'

dotenv.config()
const __dirname = dirname(fileURLToPath(import.meta.url))
const { uploadBuffer } = await import('../src/services/cloudinary.js')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const slidesDir = args.includes('--slides') ? resolve(args[args.indexOf('--slides') + 1]) : null

const adapter = new PrismaLibSql({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const prisma = new PrismaClient({ adapter })

const LETTERS = 'ABCDEFGHIJ'
const exams = JSON.parse(readFileSync(join(__dirname, 'final-exams.json'), 'utf8'))

const SLIDE_FORMATS = [
  { ext: 'pdf', label: 'PDF — read on your phone', type: 'pdf', staticPath: file => `/slides/web3nova-${file}.pdf` },
  { ext: 'pptx', label: 'PowerPoint — download', type: 'slides' },
]

function check(exam) {
  for (const [i, q] of exam.questions.entries()) {
    const idx = LETTERS.indexOf(q.answer)
    if (idx < 0 || idx >= q.options.length) throw new Error(`${exam.title}: question ${i + 1} has an invalid answer`)
  }
}

console.log(`${APPLY ? 'APPLYING to' : 'DRY RUN against'} ${String(process.env.TURSO_DATABASE_URL).replace(/\?.*/, '')}\n`)

for (const exam of exams) {
  check(exam)
  const course = await prisma.course.findFirst({ where: { name: exam.course }, orderBy: { createdAt: 'desc' } })
  if (!course) { console.log(`✗ ${exam.course}: course not found — skipped`); continue }

  // ── final test ──
  const existing = await prisma.aITest.findFirst({ where: { courseId: course.id, title: exam.title } })
  if (existing) {
    console.log(`= ${exam.course}: "${exam.title}" already exists`)
  } else {
    console.log(`+ ${exam.course}: "${exam.title}" (${exam.questions.length} questions, 30s each + practical)`)
    if (APPLY) {
      await prisma.aITest.create({
        data: {
          title: exam.title,
          description: exam.description,
          kind: 'FINAL',
          secondsPerQuestion: 30,
          practicalPrompt: exam.practicalPrompt,
          questions: JSON.stringify(exam.questions.map(({ q, options }) => ({ q, options }))),
          correctAnswers: JSON.stringify(exam.questions.map(q => q.answer)),
          maxScore: 100,
          status: 'PUBLISHED',
          cohortId: course.cohortId,
          courseId: course.id,
        },
      })
    }
  }

  // ── slides in the Library ──
  if (!slidesDir) continue
  for (const fmt of SLIDE_FORMATS) {
    const title = `${exam.slides.title} (${fmt.ext.toUpperCase()})`
    const file = join(slidesDir, `${exam.slides.file}.${fmt.ext}`)
    if (await prisma.material.findFirst({ where: { courseId: course.id, title } })) {
      console.log(`  = slides: "${title}" already in the library`)
      continue
    }
    console.log(`  + slides: "${title}"`)
    if (fmt.staticPath) {
      const path = fmt.staticPath(exam.slides.file)
      if (APPLY) {
        await prisma.material.create({
          data: {
            title, description: fmt.label, category: 'MATERIAL', type: fmt.type,
            cloudinaryUrl: path, publicId: `static${path}`, cohortId: course.cohortId, courseId: course.id,
          },
        })
      }
      continue
    }
    if (!existsSync(file)) { console.log(`  ✗ slides: ${file} not found`); continue }
    if (!APPLY) continue
    const uploaded = await uploadBuffer(readFileSync(file), {
      folder: 'web3nova/v2/materials',
      // raw keeps the .pptx/.pdf as a downloadable file instead of an image transform
      resource_type: 'raw',
      public_id: `${exam.slides.file}-${Date.now()}.${fmt.ext}`,
    })
    await prisma.material.create({
      data: {
        title,
        description: fmt.label,
        category: 'MATERIAL',
        type: fmt.type,
        cloudinaryUrl: uploaded.secure_url,
        publicId: uploaded.public_id,
        cohortId: course.cohortId,
        courseId: course.id,
      },
    })
  }
}

if (!APPLY) console.log('\nNothing written. Re-run with --apply to make these changes.')
await prisma.$disconnect()
