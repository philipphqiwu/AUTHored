import { Router, Request, Response } from 'express'
import prisma from '../utils/prisma.js'
import { isAmqpConnected } from '../utils/eventPublisher.js'

const router = Router()

router.get('/health/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

router.get('/health/ready', async (req: Request, res: Response) => {
  const checks: Record<string, boolean> = {}

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = true
  } catch {
    checks.database = false
  }

  checks.rabbitmq = isAmqpConnected()

  const isReady = Object.values(checks).every(Boolean)

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks
  })
})

export default router
