import 'dotenv/config'
import amqp from 'amqplib'
import crypto from 'crypto'
import { PrismaClient } from './generated/prisma-client/index.js'

const prisma = new PrismaClient()
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'
const EXCHANGE_NAME = 'auth_events'
const QUEUE_NAME = 'sync_worker_queue'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'shared-secret-change-in-production'
const MAX_RETRIES = 5
const BASE_DELAY = 1000 // 1 second

let connection: amqp.Connection | null = null
let channel: amqp.Channel | null = null

function generateHmacSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
}

function calculateBackoff(attemptCount: number): number {
  return BASE_DELAY * Math.pow(2, attemptCount - 1)
}

async function connect(): Promise<void> {
  try {
    connection = await amqp.connect(RABBITMQ_URL) as any
    channel = await (connection as any).createChannel()
    
    await channel!.assertExchange(EXCHANGE_NAME, 'topic', { durable: true })
    await channel!.assertQueue(QUEUE_NAME, { durable: true })
    
    await channel!.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'sessionrevoked')
    await channel!.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'passwordchanged')
    await channel!.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'accesspolicychanged')
    
    console.log('Sync Worker connected to RabbitMQ')
  } catch (error) {
    console.error('Sync Worker connection error:', error)
    setTimeout(connect, 5000)
  }
}

async function notifyApp(application: any, userId: string, sessionId: string | null, reason: string): Promise<boolean> {
  try {
    const payload = JSON.stringify({
      userId,
      sessionId,
      reason,
      timestamp: new Date().toISOString()
    })
    
    const signature = generateHmacSignature(payload, INTERNAL_SECRET)
    
    const response = await fetch(application.logoutNotificationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature
      },
      body: payload
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    console.log(`Notified ${application.name} for user ${userId}`)
    return true
  } catch (error) {
    console.error(`Failed to notify ${application.name}:`, error)
    return false
  }
}

async function processEvent(event: any): Promise<void> {
  console.log(`Processing event: ${event.eventType} (${event.id})`)
  
  const payload = event.payload as any
  
  if (event.eventType === 'SessionRevoked') {
    const applications = await prisma.application.findMany({
      where: { status: 'active' }
    })
    
    for (const app of applications) {
      let delivery = await prisma.eventDelivery.findFirst({
        where: {
          eventId: event.id,
          applicationId: app.id
        }
      })
      
      if (!delivery) {
        delivery = await prisma.eventDelivery.create({
          data: {
            eventId: event.id,
            applicationId: app.id,
            status: 'pending',
            attemptCount: 0
          }
        })
      }
      
      if (delivery.status === 'completed') {
        continue
      }
      
      if (delivery.attemptCount >= MAX_RETRIES) {
        console.log(`Max retries reached for event ${event.id} to ${app.name}`)
        continue
      }
      
      if (delivery.nextRetryAt && delivery.nextRetryAt > new Date()) {
        continue
      }
      
      const success = await notifyApp(
        app,
        event.userId,
        event.centralSessionId,
        payload.reason || 'session_revoked'
      )
      
      await prisma.eventDelivery.update({
        where: { id: delivery.id },
        data: {
          attemptCount: delivery.attemptCount + 1,
          lastAttemptAt: new Date(),
          status: success ? 'completed' : 'failed',
          processedAt: success ? new Date() : null,
          lastError: success ? null : 'Notification failed',
          nextRetryAt: success ? null : new Date(Date.now() + calculateBackoff(delivery.attemptCount + 1))
        }
      })
    }
  }
  
  await prisma.event.update({
    where: { id: event.id },
    data: { status: 'processed' }
  })
  
  console.log(`Event ${event.id} processed`)
}

async function startConsuming(): Promise<void> {
  if (!channel) {
    console.error('Channel not available')
    return
  }
  
  await channel.prefetch(1)
  
  console.log('Sync Worker started consuming events')
  
  channel.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return
    
    try {
      const event = JSON.parse(msg.content.toString())
      await processEvent(event)
      channel!.ack(msg)
    } catch (error) {
      console.error('Error processing message:', error)
      channel!.nack(msg, false, false)
    }
  })
}

async function main(): Promise<void> {
  console.log('Sync Worker starting...')
  
  await connect()
  await startConsuming()
  
  process.on('SIGINT', async () => {
    console.log('Sync Worker shutting down...')
    if (channel) await (channel as any).close()
    if (connection) await (connection as any).close()
    await prisma.$disconnect()
    process.exit(0)
  })
}

main().catch(console.error)
