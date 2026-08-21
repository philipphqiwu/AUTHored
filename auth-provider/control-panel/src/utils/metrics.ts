const AUTH_SERVER_URL = process.env.INTERNAL_AUTH_PROVIDER_URL || process.env.AUTH_PROVIDER_URL || 'http://auth-server:3000'
const APP_A_URL = process.env.APP_A_INTERNAL_URL || 'http://app-a:3002'
const APP_B_URL = process.env.APP_B_INTERNAL_URL || 'http://app-b:3003'
const SYNC_WORKER_URL = process.env.SYNC_WORKER_URL || 'http://sync-worker:3004'

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
  let total = 0
  let found = false
  for (const line of lines) {
    if (line.startsWith(metricName) && !line.startsWith('#')) {
      const match = line.match(/\}\s+(\d+(?:\.\d+)?)/) || line.match(/\s+(\d+(?:\.\d+)?)$/)
      if (match) {
        total += parseFloat(match[1])
        found = true
      }
    }
  }
  return found ? total.toString() : 'N/A'
}

function parseHistogramAvg(text: string, metricName: string): string {
  const lines = text.split('\n')
  let sum = 0
  let count = 0
  for (const line of lines) {
    if (line.startsWith(metricName + '_bucket') && !line.startsWith('#')) {
      const match = line.match(/\}\s+(\d+(?:\.\d+)?)/)
      if (match) {
        count += parseFloat(match[1])
      }
    }
    if (line.startsWith(metricName + '_sum') && !line.startsWith('#')) {
      const match = line.match(/\s+(\d+(?:\.\d+)?)$/)
      if (match) sum = parseFloat(match[1])
    }
    if (line.startsWith(metricName + '_count') && !line.startsWith('#')) {
      const match = line.match(/\s+(\d+(?:\.\d+)?)$/)
      if (match) count = parseFloat(match[1])
    }
  }
  if (count === 0) return 'N/A'
  return (sum / count * 1000).toFixed(1) + 'ms'
}

function parseHistogramP95(text: string, metricName: string): string {
  const lines = text.split('\n')
  let totalCount = 0
  const buckets: { le: number; count: number }[] = []
  for (const line of lines) {
    if (line.startsWith(metricName + '_bucket') && !line.startsWith('#')) {
      const leMatch = line.match(/le="([^"]+)"/)
      const countMatch = line.match(/\}\s+(\d+(?:\.\d+)?)/)
      if (leMatch && countMatch) {
        const le = leMatch[1] === '+Inf' ? Infinity : parseFloat(leMatch[1])
        const count = parseFloat(countMatch[1])
        buckets.push({ le, count })
        totalCount = Math.max(totalCount, count)
      }
    }
  }
  if (totalCount === 0) return 'N/A'
  const p95Count = totalCount * 0.95
  for (const b of buckets) {
    if (b.count >= p95Count) {
      return b.le === Infinity ? '>' + (buckets[buckets.length - 2]?.le || 5) + 's' : b.le + 's'
    }
  }
  return 'N/A'
}

export async function fetchAllMetrics() {
  const [authMetrics, appAMetrics, appBMetrics, syncMetrics] = await Promise.all([
    fetchMetrics(AUTH_SERVER_URL),
    fetchMetrics(APP_A_URL),
    fetchMetrics(APP_B_URL),
    fetchMetrics(SYNC_WORKER_URL)
  ])

  return {
    authServer: {
      httpRequests: authMetrics ? parseMetricValue(authMetrics, 'authored_http_requests_total') : 'N/A',
      httpErrors: authMetrics ? parseMetricValue(authMetrics, 'authored_http_errors_total') : '0',
      latencyAvg: authMetrics ? parseHistogramAvg(authMetrics, 'authored_http_request_duration_seconds') : 'N/A',
      latencyP95: authMetrics ? parseHistogramP95(authMetrics, 'authored_http_request_duration_seconds') : 'N/A',
      activeSessions: authMetrics ? parseMetricValue(authMetrics, 'authored_sso_sessions_active') : 'N/A',
      activeTokens: authMetrics ? parseMetricValue(authMetrics, 'authored_access_tokens_active') : 'N/A',
      loginAttempts: authMetrics ? parseMetricValue(authMetrics, 'authored_login_attempts_total') : 'N/A',
      mfaVerifications: authMetrics ? parseMetricValue(authMetrics, 'authored_mfa_verifications_total') : 'N/A',
      authCodesIssued: authMetrics ? parseMetricValue(authMetrics, 'authored_authorization_codes_issued_total') : 'N/A',
      eventsPublished: authMetrics ? parseMetricValue(authMetrics, 'authored_events_published_total') : 'N/A',
      memoryBytes: authMetrics ? parseMetricValue(authMetrics, 'authored_process_resident_memory_bytes') : 'N/A',
    },
    appA: {
      httpRequests: appAMetrics ? parseMetricValue(appAMetrics, 'authored_app_http_requests_total') : 'N/A',
      httpErrors: appAMetrics ? parseMetricValue(appAMetrics, 'authored_app_http_errors_total') : '0',
      latencyAvg: appAMetrics ? parseHistogramAvg(appAMetrics, 'authored_app_http_request_duration_seconds') : 'N/A',
      latencyP95: appAMetrics ? parseHistogramP95(appAMetrics, 'authored_app_http_request_duration_seconds') : 'N/A',
      memoryBytes: appAMetrics ? parseMetricValue(appAMetrics, 'authored_app_process_resident_memory_bytes') : 'N/A',
    },
    appB: {
      httpRequests: appBMetrics ? parseMetricValue(appBMetrics, 'authored_app_http_requests_total') : 'N/A',
      httpErrors: appBMetrics ? parseMetricValue(appBMetrics, 'authored_app_http_errors_total') : '0',
      latencyAvg: appBMetrics ? parseHistogramAvg(appBMetrics, 'authored_app_http_request_duration_seconds') : 'N/A',
      latencyP95: appBMetrics ? parseHistogramP95(appBMetrics, 'authored_app_http_request_duration_seconds') : 'N/A',
      memoryBytes: appBMetrics ? parseMetricValue(appBMetrics, 'authored_app_process_resident_memory_bytes') : 'N/A',
    },
    syncWorker: {
      connected: syncMetrics ? parseMetricValue(syncMetrics, 'authored_sync_rabbitmq_connected') : 'N/A',
      queueDepth: syncMetrics ? parseMetricValue(syncMetrics, 'authored_sync_queue_depth') : 'N/A',
      dlqDepth: syncMetrics ? parseMetricValue(syncMetrics, 'authored_sync_dlq_depth') : 'N/A',
      eventsProcessed: syncMetrics ? parseMetricValue(syncMetrics, 'authored_sync_events_processed_total') : 'N/A',
      processingLatencyAvg: syncMetrics ? parseHistogramAvg(syncMetrics, 'authored_sync_event_processing_duration_seconds') : 'N/A',
      processingLatencyP95: syncMetrics ? parseHistogramP95(syncMetrics, 'authored_sync_event_processing_duration_seconds') : 'N/A',
      memoryBytes: syncMetrics ? parseMetricValue(syncMetrics, 'authored_sync_process_resident_memory_bytes') : 'N/A',
    }
  }
}
