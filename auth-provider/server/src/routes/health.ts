import { Router, Request, Response } from 'express'
import prisma from '../utils/prisma.js'
import amqp from 'amqplib'

const router = Router()

router.get('/health/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

router.get('/health/ready', async (req: Request, res: Response) => {
  const checks = {
    database: false,
    rabbitmq: false
  }
  
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = true
  } catch (error) {
    console.error('Database health check failed:', error)
  }
  
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672')
    await connection.close()
    checks.rabbitmq = true
  } catch (error) {
    console.error('RabbitMQ health check failed:', error)
  }
  
  const isReady = checks.database && checks.rabbitmq
  
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks
  })
})

export default router
