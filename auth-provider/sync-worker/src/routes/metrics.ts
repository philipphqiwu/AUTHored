import http from 'http'
import { register } from '../utils/metrics.js'

const METRICS_PORT = parseInt(process.env.METRICS_PORT || '3004')

export function startMetricsServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      try {
        res.setHeader('Content-Type', register.contentType)
        const metrics = await register.metrics()
        res.writeHead(200)
        res.end(metrics)
      } catch (error) {
        console.error('Error collecting metrics:', error)
        res.writeHead(500)
        res.end('Error collecting metrics')
      }
    } else if (req.url === '/health/live' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'alive', timestamp: new Date().toISOString() }))
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  server.listen(METRICS_PORT, () => {
    console.log(`Sync Worker metrics server on port ${METRICS_PORT}`)
  })

  return server
}
