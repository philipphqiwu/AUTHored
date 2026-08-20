import 'dotenv/config'
import express from 'express'
import path from 'path'
import cookieParser from 'cookie-parser'
import expressLayouts from 'express-ejs-layouts'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

import routes from './routes/index.js'
import healthRoutes from './routes/health.js'
import metricsRoutes, { httpMetricsMiddleware } from './routes/metrics.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import prisma from './utils/prisma.js'

const app = express()
const PORT = process.env.PORT || 3002
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.set('layout', 'layout')

app.use(expressLayouts)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(httpMetricsMiddleware)

app.use('/', metricsRoutes)
app.use('/', healthRoutes)
app.use('/', routes)

// Error handling middleware (must be after all routes)
app.use(notFoundHandler)
app.use(errorHandler)

const server = app.listen(PORT, () => {
  console.log(`App A running on http://localhost:${PORT}`)
})

const shutdown = (signal: string) => {
  console.log(`App A received ${signal}, shutting down gracefully...`)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
