import { Request, Response, NextFunction } from 'express'
import prisma from '../utils/prisma.js'
import { hashToken } from '../utils/crypto.js'

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionToken = req.cookies.local_session
    
    if (!sessionToken) {
      res.redirect('/login')
      return
    }
    
    const sessionTokenHash = hashToken(sessionToken)
    const session = await prisma.localSession.findFirst({
      where: { sessionTokenHash, status: 'active' }
    })
    
    if (!session) {
      res.clearCookie('local_session')
      res.redirect('/login')
      return
    }
    
    if (session.expiresAt < new Date()) {
      await prisma.localSession.update({
        where: { id: session.id },
        data: { status: 'expired' }
      })
      res.clearCookie('local_session')
      res.redirect('/login')
      return
    }
    
    const profile = await prisma.profileCache.findUnique({
      where: { externalUserId: session.externalUserId }
    })
    
    if (!profile) {
      res.clearCookie('local_session')
      res.redirect('/login')
      return
    }
    
    (req as any).session = session
    ;(req as any).user = profile
    
    await prisma.localSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() }
    })
    
    next()
  } catch (error) {
    console.error('Session validation error:', error)
    res.clearCookie('local_session')
    res.redirect('/login')
  }
}
