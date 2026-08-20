import { Router, Request, Response } from 'express'
import prisma from '../utils/prisma.js'
import { logActivity } from '../utils/activity.js'
import { verifyHmacSignature } from '../utils/hmac.js'

const router = Router()

const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'shared-secret-change-in-production'

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-signature'] as string
    
    if (!signature) {
      await logActivity('backchannel_logout_failed', {
        reason: 'missing_signature'
      }, { status: 'error' })
      
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Missing signature' }
      })
    }
    
    const payload = JSON.stringify(req.body)
    const isValid = verifyHmacSignature(payload, signature, INTERNAL_SECRET)
    
    if (!isValid) {
      await logActivity('backchannel_logout_failed', {
        reason: 'invalid_signature'
      }, { status: 'error' })
      
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid signature' }
      })
    }
    
    const { eventId, eventType, userId, sessionId, reason, timestamp } = req.body
    
    if (!eventId || !eventType || !userId || !timestamp) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Missing required event data' }
      })
    }

    const occurredAt = new Date(timestamp)
    if (Number.isNaN(occurredAt.getTime()) || Math.abs(Date.now() - occurredAt.getTime()) > 5 * 60 * 1000) {
      return res.status(401).json({
        error: { code: 'STALE_REQUEST', message: 'Request timestamp is invalid' }
      })
    }

    const processedEvent = await prisma.processedEvent.findUnique({ where: { eventId } })
    if (processedEvent) {
      return res.json({ message: 'Event already processed', sessionsRevoked: 0 })
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
    
    await prisma.$transaction([
      prisma.localSession.updateMany({
        where: {
          externalUserId: userId,
          status: 'active'
        },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          revokeReason: reason || 'backchannel_logout'
        }
      }),
      prisma.processedEvent.create({
        data: {
          eventId,
          eventType,
          result: `revoked ${sessions.length} local session(s)`
        }
      })
    ])

    for (const session of sessions) {
      await logActivity('session_revoked', {
        eventId,
        eventType,
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
