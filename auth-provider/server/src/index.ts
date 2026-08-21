import 'dotenv/config'
import express from 'express'
import path from 'path'
import cookieParser from 'cookie-parser'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

import authRoutes from './routes/auth.js'
import oauthRoutes from './routes/oauth.js'
import healthRoutes from './routes/health.js'
import mfaRoutes from './routes/mfa.js'
import metricsRoutes from './routes/metrics.js'
import { connect as connectEventPublisher, startPolling, disconnect as disconnectEventPublisher } from './utils/eventPublisher.js'
import prisma from './utils/prisma.js'
import { hashToken } from './utils/crypto.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { httpMetricsMiddleware, activeSsoSessions, activeAccessTokens } from './utils/metrics.js'

const app = express()
const PORT = process.env.PORT || 3000
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SHUTDOWN_TIMEOUT_MS = 10000

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(httpMetricsMiddleware)

app.use('/', metricsRoutes)
app.use('/', healthRoutes)
app.use('/', authRoutes)
app.use('/', oauthRoutes)
app.use('/', mfaRoutes)

app.get('/', async (req, res) => {
  const sessionToken = req.cookies.sso_session
  
  if (sessionToken) {
    const sessionTokenHash = hashToken(sessionToken)
    const session = await prisma.ssoSession.findFirst({
      where: { sessionTokenHash, status: 'active' }
    })
    
    if (session && session.expiresAt > new Date()) {
      return res.redirect('/profile')
    }
  }
  
  res.redirect('/login')
})

// Error handling middleware (must be after all routes)
app.use(notFoundHandler)
app.use(errorHandler)

let metricsInterval: NodeJS.Timeout | null = null

const server = app.listen(PORT, async () => {
  console.log(`Auth Server running on http://localhost:${PORT}`)
  
  await connectEventPublisher()
  startPolling()

  metricsInterval = setInterval(async () => {
    try {
      const sessions = await prisma.ssoSession.count({ where: { status: 'active' } })
      activeSsoSessions.set(sessions)
      const tokens = await prisma.accessToken.count({ where: { status: 'active' } })
      activeAccessTokens.set(tokens)
    } catch {}
  }, 15000)
})

const shutdown = async (signal: string) => {
  console.log(`Auth Server received ${signal}, shutting down gracefully...`)

  const forceExitTimer = setTimeout(() => {
    console.error('Shutdown timeout reached, forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExitTimer.unref()

  server.close(async () => {
    if (metricsInterval) {
      clearInterval(metricsInterval)
      metricsInterval = null
    }
    await disconnectEventPublisher()
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
