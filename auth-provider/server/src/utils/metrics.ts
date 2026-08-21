import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

export const register = new Registry()

collectDefaultMetrics({ register, prefix: 'authored_' })

export const httpRequestDuration = new Histogram({
  name: 'authored_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register]
})

export const httpRequestTotal = new Counter({
  name: 'authored_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
})

export const activeSsoSessions = new Gauge({
  name: 'authored_sso_sessions_active',
  help: 'Number of active SSO sessions',
  registers: [register]
})

export const activeAccessTokens = new Gauge({
  name: 'authored_access_tokens_active',
  help: 'Number of active access tokens',
  registers: [register]
})

export const authorizationCodesIssued = new Counter({
  name: 'authored_authorization_codes_issued_total',
  help: 'Total authorization codes issued',
  registers: [register]
})

export const loginAttemptsTotal = new Counter({
  name: 'authored_login_attempts_total',
  help: 'Total login attempts',
  labelNames: ['result'],
  registers: [register]
})

export const mfaVerificationsTotal = new Counter({
  name: 'authored_mfa_verifications_total',
  help: 'Total MFA verification attempts',
  labelNames: ['method', 'result'],
  registers: [register]
})

export const eventsPublishedTotal = new Counter({
  name: 'authored_events_published_total',
  help: 'Total events published to RabbitMQ',
  labelNames: ['event_type'],
  registers: [register]
})

export const httpErrorsTotal = new Counter({
  name: 'authored_http_errors_total',
  help: 'Total HTTP error responses (4xx/5xx)',
  labelNames: ['status_code_class'],
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
    if (res.statusCode >= 400) {
      const classLabel = res.statusCode >= 500 ? '5xx' : '4xx'
      httpErrorsTotal.inc({ status_code_class: classLabel })
    }
    originalEnd.apply(this, args)
  }
  next()
}
