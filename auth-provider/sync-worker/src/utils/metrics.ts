import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

export const register = new Registry()
collectDefaultMetrics({ register, prefix: 'authored_sync_' })

export const eventsProcessedTotal = new Counter({
  name: 'authored_sync_events_processed_total',
  help: 'Total events processed by sync worker',
  labelNames: ['event_type', 'result'],
  registers: [register]
})

export const eventProcessingDuration = new Histogram({
  name: 'authored_sync_event_processing_duration_seconds',
  help: 'Duration of event processing in seconds',
  labelNames: ['event_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
})

export const appNotificationsTotal = new Counter({
  name: 'authored_sync_app_notifications_total',
  help: 'Total notifications sent to applications',
  labelNames: ['app', 'result'],
  registers: [register]
})

export const queueDepth = new Gauge({
  name: 'authored_sync_queue_depth',
  help: 'Number of messages pending in the sync worker queue',
  registers: [register]
})

export const dlqDepth = new Gauge({
  name: 'authored_sync_dlq_depth',
  help: 'Number of messages in the dead-letter queue',
  registers: [register]
})

export const rabbitmqConnected = new Gauge({
  name: 'authored_sync_rabbitmq_connected',
  help: 'Whether sync worker is connected to RabbitMQ (1=yes, 0=no)',
  registers: [register]
})
