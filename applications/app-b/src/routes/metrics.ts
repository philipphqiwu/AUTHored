import { Router, Request, Response } from 'express'
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client'

const register = new Registry()
collectDefaultMetrics({ register, prefix: 'authored_app_' })

export const httpRequestDuration = new Histogram({
  name: 'authored_app_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register]
})

export const httpRequestTotal = new Counter({
  name: 'authored_app_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
})

export function httpMetricsMiddleware(req: any, res: any, next: any) {
  const start = process.hrtime.bigint()
  const originalEnd = res.end
  res.end = function (this: any, ...args: any[]) {
    const end = process.hrtime.bigint()
    const durationNs = Number(end - start)
    const durationSec = durationNs / 1e9
    const route = req.route?.path || req.path || 'unknown'
    const labels = { method: req.method, route, status_code: res.statusCode }
    httpRequestDuration.observe(labels, durationSec)
    httpRequestTotal.inc(labels)
    originalEnd.apply(this, args)
  }
  next()
}

const router = Router()

router.get('/metrics', async (req: Request, res: Response) => {
  try {
    res.setHeader('Content-Type', register.contentType)
    const metrics = await register.metrics()
    res.send(metrics)
  } catch (error) {
    console.error('Error collecting metrics:', error)
    res.status(500).send('Error collecting metrics')
  }
})

export default router
