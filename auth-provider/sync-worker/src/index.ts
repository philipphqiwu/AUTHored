import 'dotenv/config'
import amqp from 'amqplib'
import crypto from 'crypto'
import { PrismaClient } from './generated/prisma-client/index.js'
import { startMetricsServer } from './routes/metrics.js'
import {
  eventsProcessedTotal,
  eventProcessingDuration,
  appNotificationsTotal,
  queueDepth,
  dlqDepth,
  rabbitmqConnected
} from './utils/metrics.js'

const prisma = new PrismaClient()
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'
const RABBITMQ_HTTP = process.env.RABBITMQ_HTTP_URL || 'http://rabbitmq:15672'
const RABBITMQ_USER = process.env.RABBITMQ_DEFAULT_USER || 'guest'
const RABBITMQ_PASS = process.env.RABBITMQ_DEFAULT_PASS || 'guest'
const EXCHANGE_NAME = 'auth_events'
const QUEUE_NAME = 'sync_worker_queue'
const DEAD_LETTER_QUEUE = 'sync_worker_dlq'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'shared-secret-change-in-production'
const MAX_RETRIES = 5
const BASE_DELAY = 1000 // 1 second
const QUEUE_POLL_INTERVAL = 5000 // 5 seconds

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
    await channel!.assertQueue(DEAD_LETTER_QUEUE, { durable: true })
    
    await channel!.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'sessionrevoked')
    await channel!.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'passwordchanged')
    await channel!.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'accesspolicychanged')
    
    rabbitmqConnected.set(1)
    console.log('Sync Worker connected to RabbitMQ')
  } catch (error) {
    console.error('Sync Worker connection error:', error)
    rabbitmqConnected.set(0)
    setTimeout(connect, 5000)
  }
}

async function notifyApp(application: any, event: any, reason: string): Promise<boolean> {
  try {
    const payload = JSON.stringify({
      eventId: event.id,
      eventType: event.eventType,
      userId: event.userId,
      sessionId: event.centralSessionId,
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
    
    appNotificationsTotal.inc({ app: application.name, result: 'success' })
    console.log(`Notified ${application.name} for user ${event.userId}`)
    return true
  } catch (error) {
    console.error(`Failed to notify ${application.name}:`, error)
    appNotificationsTotal.inc({ app: application.name, result: 'failure' })
    return false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function deliverEvent(event: any, application: any, reason: string): Promise<boolean> {
  let delivery = await prisma.eventDelivery.findFirst({
    where: { eventId: event.id, applicationId: application.id }
  })

  if (!delivery) {
    delivery = await prisma.eventDelivery.create({
      data: { eventId: event.id, applicationId: application.id }
    })
  }

  if (delivery.status === 'completed') return true

  for (let attempt = delivery.attemptCount + 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) await delay(calculateBackoff(attempt - 1))

    const success = await notifyApp(application, event, reason)
    const nextRetryAt = success || attempt === MAX_RETRIES
      ? null
      : new Date(Date.now() + calculateBackoff(attempt))

    await prisma.eventDelivery.update({
      where: { id: delivery.id },
      data: {
        attemptCount: attempt,
        lastAttemptAt: new Date(),
        status: success ? 'completed' : 'failed',
        processedAt: success ? new Date() : null,
        lastError: success ? null : 'Notification failed',
        nextRetryAt
      }
    })

    if (success) return true
  }

  return false
}

async function processEvent(event: any): Promise<boolean> {
  const startTime = process.hrtime.bigint()
  console.log(`Processing event: ${event.eventType} (${event.id})`)
  const payload = event.payload as any
  let applications: any[] = []
  let reason = payload.reason || event.eventType.toLowerCase()

  if (event.eventType === 'SessionRevoked' || event.eventType === 'PasswordChanged') {
    applications = await prisma.application.findMany()
  } else if (event.eventType === 'AccessPolicyChanged') {
    const applicationId = payload.applicationId || event.applicationId
    if (!applicationId) throw new Error('AccessPolicyChanged event is missing applicationId')

    const application = await prisma.application.findUnique({ where: { id: applicationId } })
    if (!application) throw new Error(`Application ${applicationId} was not found`)
    applications = [application]
  } else {
    throw new Error(`Unsupported event type: ${event.eventType}`)
  }

  const results = await Promise.all(
    applications.map(application => deliverEvent(event, application, reason))
  )
  const completed = results.every(Boolean)

  await prisma.event.update({
    where: { id: event.id },
    data: { status: completed ? 'processed' : 'failed' }
  })

  const durationNs = Number(process.hrtime.bigint() - startTime)
  const durationSec = durationNs / 1e9
  eventProcessingDuration.observe({ event_type: event.eventType }, durationSec)
  eventsProcessedTotal.inc({ event_type: event.eventType, result: completed ? 'success' : 'failure' })

  console.log(`Event ${event.id} ${completed ? 'processed' : 'failed'} (${durationSec.toFixed(2)}s)`)
  return completed
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
      const completed = await processEvent(event)
      if (completed) {
        channel!.ack(msg)
      } else {
        channel!.sendToQueue(DEAD_LETTER_QUEUE, msg.content, {
          persistent: true,
          contentType: 'application/json'
        })
        channel!.ack(msg)
      }
    } catch (error) {
      console.error('Error processing message:', error)
      channel!.sendToQueue(DEAD_LETTER_QUEUE, msg.content, {
        persistent: true,
        contentType: 'application/json'
      })
      channel!.ack(msg)
    }
  })
}

async function pollQueueDepth(): Promise<void> {
  const auth = Buffer.from(`${RABBITMQ_USER}:${RABBITMQ_PASS}`).toString('base64')
  try {
    const [qRes, dlqRes] = await Promise.all([
      fetch(`${RABBITMQ_HTTP}/api/queues/%2F/${QUEUE_NAME}`, {
        headers: { 'Authorization': `Basic ${auth}` }
      }),
      fetch(`${RABBITMQ_HTTP}/api/queues/%2F/${DEAD_LETTER_QUEUE}`, {
        headers: { 'Authorization': `Basic ${auth}` }
      })
    ])

    if (qRes.ok) {
      const qData = await qRes.json() as any
      queueDepth.set(qData.messages || 0)
    }
    if (dlqRes.ok) {
      const dlqData = await dlqRes.json() as any
      dlqDepth.set(dlqData.messages || 0)
    }
  } catch {
    queueDepth.set(-1)
    dlqDepth.set(-1)
  }
}

async function main(): Promise<void> {
  console.log('Sync Worker starting...')
  
  startMetricsServer()
  await connect()
  await startConsuming()

  setInterval(pollQueueDepth, QUEUE_POLL_INTERVAL)
  pollQueueDepth()
  
  const shutdown = async (signal: string) => {
    console.log(`Sync Worker received ${signal}, shutting down gracefully...`)
    rabbitmqConnected.set(0)
    if (channel) await (channel as any).close()
    if (connection) await (connection as any).close()
    await prisma.$disconnect()
    process.exit(0)
  }
  
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch(console.error)
