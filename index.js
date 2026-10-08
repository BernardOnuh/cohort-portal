import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import authRouter from './src/routes/auth.js'
import adminRouter from './src/routes/admin.js'
import studentRouter from './src/routes/student.js'
import paymentsRouter, { buildWebhookHandler } from './src/routes/payments.js'
import v2AuthRouter from './src/routes/v2/auth.js'
import v2CoursesRouter from './src/routes/v2/courses.js'
import v2AdminRouter from './src/routes/v2/admin.js'
import v2TestsRouter from './src/routes/v2/tests.js'
import v2LeaderboardRouter from './src/routes/v2/leaderboard.js'
import v2OnboardingRouter from './src/routes/v2/onboarding.js'
import v2TasksRouter from './src/routes/v2/tasks.js'
import { requestLogger, errorLogger } from './src/middleware/logger.js'
import { swaggerSpec, v2SwaggerSpec } from './src/swagger.js'

const app = express()
const PORT = process.env.PORT || 3012
app.set('trust proxy', 1)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',')
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(express.json())
app.use(requestLogger)

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

app.use('/auth', authRouter)
app.use('/admin', adminRouter)
app.use('/student', studentRouter)
app.use('/payments', paymentsRouter)
app.use('/', buildWebhookHandler())

// ── V2 (new intake) ──────────────────────────────────────────
app.use('/v2/docs', swaggerUi.serve, swaggerUi.setup(v2SwaggerSpec))
app.use('/v2/auth', v2AuthRouter)
app.use('/v2/courses', v2CoursesRouter)
app.use('/v2/admin', v2AdminRouter)
app.use('/v2/tests', v2TestsRouter)
app.use('/v2/leaderboard', v2LeaderboardRouter)
app.use('/v2/onboarding', v2OnboardingRouter)
app.use('/v2/tasks', v2TasksRouter)

app.get('/health', (_, res) => res.json({ status: 'ok' }))

app.use(errorLogger)
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
