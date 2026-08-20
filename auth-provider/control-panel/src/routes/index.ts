import { Router } from "express"
import userRoutes from './users'
import groupRoutes from './groups'
import applicationRoutes from './applications'
import metricsRoutes from './metrics'

const router = Router()

router.use('/users', userRoutes)
router.use('/groups', groupRoutes)
router.use('/applications', applicationRoutes)
router.use('/metrics', metricsRoutes)

export default router