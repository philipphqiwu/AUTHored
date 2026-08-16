import { Router } from "express"
import userRoutes from './users'
import groupRoutes from './groups'
import applicationRoutes from './applications'

const router = Router()

router.use('/users', userRoutes)
router.use('/groups', groupRoutes)
router.use('/applications', applicationRoutes)

export default router