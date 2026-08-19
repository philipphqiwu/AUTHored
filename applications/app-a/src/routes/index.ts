import { Router } from 'express'
import authRoutes from './auth.js'
import internalRoutes from './internal.js'

const router = Router()

router.use('/', authRoutes)
router.use('/internal', internalRoutes)

export default router
