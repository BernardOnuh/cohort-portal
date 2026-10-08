import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'

dotenv.config()

const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
const prisma = new PrismaClient({ adapter })

const COURSES = [
  {
    name: 'Web Development',
    description: 'HTML, CSS, JavaScript and modern frameworks — build and ship real web apps.',
    level: 'Beginner', durationWeeks: 8,
    questions: [
      { q: 'Which language defines the structure of a web page?', options: ['HTML', 'CSS', 'JavaScript', 'Python'], answer: 'A' },
      { q: 'CSS is mainly used for:', options: ['Structure', 'Styling', 'Databases', 'Servers'], answer: 'B' },
      { q: 'A responsive page:', options: ['Loads faster', 'Works offline', 'Adapts to any screen size', 'Uses less data'], answer: 'C' },
      { q: 'Which is a JavaScript frontend framework?', options: ['Laravel', 'Django', 'React', 'Flutter'], answer: 'C' },
      { q: 'The frontend is what the user:', options: ['Sees and interacts with', 'Stores data in', 'Secures the server', 'Writes SQL for'], answer: 'A' },
    ],
  },
  {
    name: 'UI/UX',
    description: 'Design thinking, wireframes, Figma and user research — craft interfaces people love.',
    level: 'Beginner', durationWeeks: 6,
    questions: [
      { q: 'UX is about how a product:', options: ['Looks', 'Feels and is easy to use', 'Is marketed', 'Is priced'], answer: 'B' },
      { q: 'Which tool is common for UI design?', options: ['Git', 'Figma', 'PostgreSQL', 'Nginx'], answer: 'B' },
      { q: 'High color contrast mainly improves:', options: ['Readability', 'Download speed', 'SEO', 'Battery life'], answer: 'A' },
      { q: 'A wireframe is best described as:', options: ['A final polished design', 'A low-fidelity layout sketch', 'An animation sequence', 'A marketing survey'], answer: 'B' },
      { q: 'The F-pattern in design refers to how users:', options: ['Scan a page', 'Type text', 'Click buttons', 'Pay for apps'], answer: 'A' },
    ],
  },
  {
    name: 'Mobile App Development',
    description: 'Flutter, React Native and native patterns — ship real apps to stores.',
    level: 'Intermediate', durationWeeks: 8,
    questions: [
      { q: 'Which is a cross-platform mobile framework?', options: ['PHP', 'Flutter', 'SQL', 'NGINX'], answer: 'B' },
      { q: 'Swift is the primary language for:', options: ['Android', 'iOS', 'Web servers', 'Windows'], answer: 'B' },
      { q: 'An API lets apps:', options: ['Talk to each other and servers', 'Render fonts', 'Take screenshots', 'Mine crypto'], answer: 'A' },
      { q: 'React Native apps are written mostly in:', options: ['Swift', 'Kotlin', 'JavaScript', 'Assembly'], answer: 'C' },
      { q: 'Apps distributed via app stores are usually:', options: ['Web pages', 'Downloaded and installed', 'Email attachments', 'Browser extensions'], answer: 'B' },
    ],
  },
  {
    name: 'AI Automation',
    description: 'Automate workflows and business tasks with AI tools like n8n, Zapier and GPT.',
    level: 'Beginner', durationWeeks: 6,
    questions: [
      { q: 'Automation means:', options: ['Designing', 'Making tasks run automatically', 'Explaining tasks', 'Deleting tasks'], answer: 'B' },
      { q: 'Which is commonly used for AI automation?', options: ['n8n / Zapier-style tools', 'Spreadsheets', 'Printers', 'Font editors'], answer: 'A' },
      { q: 'A "workflow" in automation is:', options: ['A sequence of steps triggered under conditions', 'A design file', 'A database table', 'A marketing report'], answer: 'A' },
      { q: 'AI models like GPT are best at:', options: ['Understanding and generating language', 'Compiling kernels', 'Routing network traffic', 'Rendering 3D scenes'], answer: 'A' },
      { q: 'An example of AI automation is:', options: ['Auto-replying to emails with AI', 'Printing documents', 'Charging a phone', 'Locking a door'], answer: 'A' },
    ],
  },
  {
    name: 'AI Prompting',
    description: 'Master prompts, context and creative constraints to get the best out of any AI.',
    level: 'Beginner', durationWeeks: 4,
    questions: [
      { q: 'A "prompt" is:', options: ['Your instruction to an AI', "An AI's output", 'A programming error', 'A password'], answer: 'A' },
      { q: 'Clear, specific prompts tend to produce:', options: ['Vague answers', 'Better answers', 'Errors', 'Longer loading times'], answer: 'B' },
      { q: 'Which is a good prompting technique?', options: ['Giving context and constraints', 'Shouting at the AI', 'Repeating one word', 'Deleting history'], answer: 'A' },
      { q: 'Temperature in an AI chat controls:', options: ['Creativity / randomness', 'File size', 'Screen brightness', 'Connection speed'], answer: 'A' },
      { q: 'Prompts work best when they include:', options: ['Role, format and audience details', 'Emojis only', 'A single letter', 'No context'], answer: 'A' },
    ],
  },
  {
    name: 'Blockchain Development',
    description: 'Solidity, smart contracts, wallets and dApps — build on-chain applications.',
    level: 'Intermediate', durationWeeks: 8,
    questions: [
      { q: 'A blockchain is best described as:', options: ['A distributed ledger', 'A chat app', 'A photo storage service', 'A web framework'], answer: 'A' },
      { q: 'In Ethereum, "gas" is:', options: ['A transaction fee unit', 'A fluid', 'A token type', 'A block size limit'], answer: 'A' },
      { q: 'Smart contracts on Ethereum are usually written in:', options: ['Python', 'Solidity', 'Ruby', 'C#'], answer: 'B' },
      { q: '"Immutable" on-chain data means it:', options: ['Cannot be changed easily', 'Is very fast', 'Is free to store', 'Runs offline'], answer: 'A' },
      { q: 'A crypto wallet holds:', options: ['Private keys / accounts', 'Physical cash', 'Server logs', 'Email addresses'], answer: 'A' },
    ],
  },
]

const PARTICIPANTS = [
  { name: 'Alex Rivers',  course: 'Web Development',            score: 92 },
  { name: 'Chioma Eze',   course: 'AI Automation',             score: 88 },
  { name: 'Tunde Bakare', course: 'Blockchain Development',    score: 84 },
  { name: 'Amina Yusuf',  course: 'UI/UX',                     score: 79 },
  { name: 'Daniel Mensah',course: 'Mobile App Development',    score: 73 },
  { name: 'Sofia Marquez',course: 'AI Prompting',              score: 66 },
  { name: 'Josh Adams',   course: 'Web Development',           score: 58 },
  { name: 'Ngozi Okeke',  course: 'Blockchain Development',    score: 47 },
]

async function main() {
  const cohort = await prisma.cohort.findFirst({ orderBy: { startDate: 'desc' } })
  if (!cohort) throw new Error('No cohort — create an intake first (GET /v2/courses shows the active one)')
  console.log('intake:', cohort.name)

  let created = 0, skipped = 0
  for (const c of COURSES) {
    let course = await prisma.course.findUnique({
      where: { name_cohortId: { name: c.name, cohortId: cohort.id } },
    })
    if (!course) {
      course = await prisma.course.create({
        data: {
          name: c.name, description: c.description, level: c.level,
          durationWeeks: c.durationWeeks, cohortId: cohort.id,
        },
      })
      created++
    } else skipped++

    const testTitle = `Knowledge Check — ${c.name}`
    const questions = c.questions.map(({ q, options }) => ({ q, options }))
    const correctAnswers = c.questions.map(q => q.answer)

    const exists = await prisma.aITest.findFirst({ where: { title: testTitle, courseId: course.id } })
    if (!exists) {
      await prisma.aITest.create({
        data: {
          title: testTitle,
          description: 'A quick diagnostic to see where you are before the class starts.',
          questions: JSON.stringify(questions),
          correctAnswers: JSON.stringify(correctAnswers),
          maxScore: 100,
          status: 'PUBLISHED',
          cohortId: cohort.id,
          courseId: course.id,
        },
      })
    }
  }
  console.log(`courses: ${created} created, ${skipped} existing · knowledge checks created/updated per course`)

  const day = 60 * 60 * 24 * 1000
  let members = 0
  for (const p of PARTICIPANTS) {
    const email = `${p.name.toLowerCase().replace(/\s+/g, '.')}@students.web3nova.app`
    const course = await prisma.course.findUnique({
      where: { name_cohortId: { name: p.course, cohortId: cohort.id } },
    })
    if (!course) continue

    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: p.name,
          email,
          password: await bcrypt.hash(p.name.split(' ')[0].toLowerCase(), 10),
          role: 'STUDENT',
          studentName: email.split('@')[0],
          expectation: 'I joined the intake to learn and compete on the leaderboard.',
          cohortId: cohort.id,
          courseId: course.id,
          points: 0,
        },
      })
    }

    const test = await prisma.aITest.findFirst({
      where: { courseId: course.id, status: 'PUBLISHED' },
    })
    if (!test) continue

    // simulate scoring so the public leaderboard is alive for the demo
    const attempt = await prisma.aITestAttempt.findUnique({
      where: { testId_studentId: { testId: test.id, studentId: user.id } },
    })
    if (!attempt) {
      await prisma.aITestAttempt.create({
        data: {
          testId: test.id,
          studentId: user.id,
          answers: '{}',
          score: p.score,
          submittedAt: new Date(Date.now() - (members * 2 * day)),
        },
      })
      await prisma.user.update({ where: { id: user.id }, data: { points: p.score } })
      members++
    }
  }
  console.log(`participants scored: ${members}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e.message); process.exit(1) })