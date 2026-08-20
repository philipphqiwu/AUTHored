import { Router, Request, Response } from 'express'

const router = Router()

const AUTH_SERVER_URL = process.env.AUTH_PROVIDER_URL || 'http://localhost:3000'
const APP_A_URL = process.env.APP_A_URL || 'http://localhost:3002'
const APP_B_URL = process.env.APP_B_URL || 'http://localhost:3003'

async function fetchMetrics(url: string): Promise<string | null> {
  try {
    const response = await fetch(`${url}/metrics`)
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

function parseMetricValue(text: string, metricName: string): string {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith(metricName) && !line.startsWith('#')) {
      const parts = line.split(' ')
      if (parts.length >= 2) return parts[1]
    }
  }
  return 'N/A'
}

function parseHistogramBuckets(text: string, metricName: string): { p50: string; p95: string; p99: string } {
  const lines = text.split('\n')
  const values: number[] = []
  for (const line of lines) {
    if (line.startsWith(metricName + '_bucket') && !line.startsWith('#')) {
      const match = line.match(/\{.*\}\s+(\d+)/)
      if (match) values.push(parseInt(match[1]))
    }
  }
  if (values.length === 0) return { p50: 'N/A', p95: 'N/A', p99: 'N/A' }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)]?.toString() || 'N/A',
    p95: sorted[Math.floor(sorted.length * 0.95)]?.toString() || 'N/A',
    p99: sorted[Math.floor(sorted.length * 0.99)]?.toString() || 'N/A'
  }
}

router.get('/', async (req: Request, res: Response) => {
  const [authMetrics, appAMetrics, appBMetrics] = await Promise.all([
    fetchMetrics(AUTH_SERVER_URL),
    fetchMetrics(APP_A_URL),
    fetchMetrics(APP_B_URL)
  ])

  const dashboard = {
    authServer: {
      uptime: authMetrics ? parseMetricValue(authMetrics, 'authored_process_uptime_seconds') : 'N/A',
      activeSessions: authMetrics ? parseMetricValue(authMetrics, 'authored_sso_sessions_active') : 'N/A',
      activeTokens: authMetrics ? parseMetricValue(authMetrics, 'authored_access_tokens_active') : 'N/A',
      httpRequests: authMetrics ? parseMetricValue(authMetrics, 'authored_http_requests_total') : 'N/A',
      loginAttempts: authMetrics ? parseMetricValue(authMetrics, 'authored_login_attempts_total') : 'N/A',
      mfaVerifications: authMetrics ? parseMetricValue(authMetrics, 'authored_mfa_verifications_total') : 'N/A',
      authCodesIssued: authMetrics ? parseMetricValue(authMetrics, 'authored_authorization_codes_issued_total') : 'N/A',
      eventsPublished: authMetrics ? parseMetricValue(authMetrics, 'authored_events_published_total') : 'N/A',
    },
    appA: {
      uptime: appAMetrics ? parseMetricValue(appAMetrics, 'authored_app_process_uptime_seconds') : 'N/A',
      httpRequests: appAMetrics ? parseMetricValue(appAMetrics, 'authored_app_http_requests_total') : 'N/A',
    },
    appB: {
      uptime: appBMetrics ? parseMetricValue(appBMetrics, 'authored_app_process_uptime_seconds') : 'N/A',
      httpRequests: appBMetrics ? parseMetricValue(appBMetrics, 'authored_app_http_requests_total') : 'N/A',
    }
  }

  res.render('metrics', { title: 'Metrics Dashboard', dashboard })
})

export default router
