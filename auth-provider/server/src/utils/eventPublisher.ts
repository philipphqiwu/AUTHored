import amqp from 'amqplib'
import prisma from '../utils/prisma.js'

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'
const EXCHANGE_NAME = 'auth_events'
const POLL_INTERVAL = 5000 // 5 seconds

let connection: amqp.Connection | null = null
let channel: amqp.Channel | null = null
let isPolling = false

export async function connect(): Promise<void> {
  try {
    connection = await amqp.connect(RABBITMQ_URL)
    channel = await connection.createChannel()
    
    await channel.assertExchange(EXCHANGE_NAME, 'topic', {
      durable: true
    })
    
    console.log('Event Publisher connected to RabbitMQ')
  } catch (error) {
    console.error('Event Publisher connection error:', error)
    setTimeout(connect, 5000)
  }
}

export async function publishEvent(event: any): Promise<boolean> {
  if (!channel) {
    console.error('Channel not available')
    return false
  }
  
  try {
    const message = Buffer.from(JSON.stringify(event))
    const routingKey = event.eventType.toLowerCase()
    
    channel.publish(EXCHANGE_NAME, routingKey, message, {
      persistent: true,
      contentType: 'application/json'
    })
    
    console.log(`Event published: ${event.eventType} (${event.id})`)
    return true
  } catch (error) {
    console.error('Event publish error:', error)
    return false
  }
}

export async function pollAndPublish(): Promise<void> {
  if (isPolling) return
  isPolling = true
  
  try {
    const unpublishedEvents = await prisma.event.findMany({
      where: {
        status: 'pending'
      },
      orderBy: {
        createdAt: 'asc'
      },
      take: 10
    })
    
    for (const event of unpublishedEvents) {
      const success = await publishEvent(event)
      
      if (success) {
        await prisma.event.update({
          where: { id: event.id },
          data: {
            status: 'published',
            publishedAt: new Date()
          }
        })
      }
    }
    
    if (unpublishedEvents.length > 0) {
      console.log(`Published ${unpublishedEvents.length} events`)
    }
  } catch (error) {
    console.error('Poll error:', error)
  } finally {
    isPolling = false
  }
}

export function startPolling(): void {
  console.log('Event Publisher started polling')
  setInterval(pollAndPublish, POLL_INTERVAL)
  pollAndPublish()
}

export async function disconnect(): Promise<void> {
  if (channel) {
    await channel.close()
  }
  if (connection) {
    await connection.close()
  }
  console.log('Event Publisher disconnected')
}
