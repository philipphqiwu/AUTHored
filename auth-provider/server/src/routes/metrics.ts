import { Router, Request, Response } from 'express'
import { register } from '../utils/metrics.js'

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
