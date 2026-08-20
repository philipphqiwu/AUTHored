import { Router, Request, Response } from 'express'
import prisma from '../utils/prisma.js'

const router = Router()

router.get('/health/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

router.get('/health/ready', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: true
      }
    })
  } catch (error) {
    console.error('Database health check failed:', error)
    
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: false
      }
    })
  }
})

export default router
