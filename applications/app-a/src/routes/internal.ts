import { Router, Request, Response } from 'express'
import prisma from '../utils/prisma.js'
import { logActivity } from '../utils/activity.js'

const router = Router()

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'shared-secret-change-in-production'

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader || authHeader !== `Bearer ${INTERNAL_SECRET}`) {
      await logActivity('backchannel_logout_failed', {
        reason: 'invalid_secret'
      }, { status: 'error' })
      
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid authorization' }
      })
    }
    
    const { userId, sessionId, reason } = req.body
    
    if (!userId) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Missing userId' }
      })
    }
    
    await logActivity('backchannel_logout_received', {
      userId,
      sessionId,
      reason
    })
    
    const sessions = await prisma.localSession.findMany({
      where: {
        externalUserId: userId,
        status: 'active'
      }
    })
    
    for (const session of sessions) {
      await prisma.localSession.update({
        where: { id: session.id },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          revokeReason: reason || 'backchannel_logout'
        }
      })
      
      await logActivity('session_revoked', {
        sessionId: session.id,
        reason: reason || 'backchannel_logout'
      }, {
        userId,
        sessionId: session.id
      })
    }
    
    res.json({
      message: 'Logout processed',
      sessionsRevoked: sessions.length
    })
  } catch (error) {
    console.error('Internal logout error:', error)
    res.status(500).json({
      error: { code: 'SERVER_ERROR', message: 'Logout failed' }
    })
  }
})

export default router
