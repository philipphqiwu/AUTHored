import prisma from './prisma.js'

export async function logActivity(
  eventType: string,
  metadata: Record<string, any> = {},
  options: {
    userId?: string
    sessionId?: string
    correlationId?: string
    status?: string
  } = {}
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        eventType,
        userId: options.userId,
        sessionId: options.sessionId,
        correlationId: options.correlationId,
        metadata,
        status: options.status || 'success'
      }
    })
  } catch (error) {
    console.error('Failed to log activity:', error)
  }
}

export async function getRecentActivities(limit: number = 20) {
  return prisma.activityLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit
  })
}

export async function getProcessedEvents() {
  return prisma.processedEvent.findMany({
    orderBy: { processedAt: 'desc' }
  })
}
