import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import prisma from '../utils/prisma.js'
import { generateToken, hashToken } from '../utils/crypto.js'
import { loginAttemptsTotal } from '../utils/metrics.js'

const router = Router()

router.get('/profile', async (req: Request, res: Response) => {
  try {
    const sessionToken = req.cookies.sso_session
    
    if (!sessionToken) {
      return res.redirect('/login')
    }
    
    const sessionTokenHash = hashToken(sessionToken)
    const session = await prisma.ssoSession.findFirst({
      where: { sessionTokenHash, status: 'active' },
      include: { user: true }
    })
    
    if (!session || session.expiresAt < new Date()) {
      res.clearCookie('sso_session')
      return res.redirect('/login')
    }
    
    res.render('profile', {
      title: 'Profile',
      user: session.user,
      session: session
    })
  } catch (error) {
    console.error('Profile error:', error)
    res.redirect('/login')
  }
})

router.get('/login', (req: Request, res: Response) => {
  const redirectUri = req.query.redirect_uri as string
  res.render('login', { 
    title: 'Login',
    error: null,
    redirect_uri: redirectUri 
  })
})

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, redirect_uri } = req.body
    
    const user = await prisma.user.findUnique({ where: { email } })
    
    if (!user) {
      loginAttemptsTotal.inc({ result: 'failure' })
      await prisma.auditLog.create({
        data: {
          eventType: 'login_failed',
          result: 'failure',
          ipAddress: req.ip,
          metadata: { email, reason: 'user_not_found' }
        }
      })
      return res.render('login', { 
        title: 'Login',
        error: 'Invalid credentials',
        redirect_uri 
      })
    }
    
    const validPassword = await bcrypt.compare(password, user.passwordHash)
    
    if (!validPassword) {
      loginAttemptsTotal.inc({ result: 'failure' })
      await prisma.auditLog.create({
        data: {
          eventType: 'login_failed',
          result: 'failure',
          userId: user.id,
          ipAddress: req.ip,
          metadata: { email, reason: 'invalid_password' }
        }
      })
      return res.render('login', { 
        title: 'Login',
        error: 'Invalid credentials',
        redirect_uri 
      })
    }
    
    if (user.status !== 'active') {
      loginAttemptsTotal.inc({ result: 'failure' })
      await prisma.auditLog.create({
        data: {
          eventType: 'login_failed',
          result: 'failure',
          userId: user.id,
          ipAddress: req.ip,
          metadata: { email, reason: 'user_inactive' }
        }
      })
      return res.render('login', { 
        title: 'Login',
        error: 'Account is inactive',
        redirect_uri 
      })
    }
    
    const sessionToken = generateToken()
    const sessionTokenHash = hashToken(sessionToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    if (user.totpEnabled) {
      const payload = JSON.stringify({ userId: user.id, redirectUri: redirect_uri || null, ts: Date.now() })
      const mfaToken = Buffer.from(payload).toString('base64url')
      res.cookie('mfa_pending', mfaToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000
      })
      return res.redirect('/mfa/verify')
    }

    await prisma.ssoSession.create({
      data: {
        userId: user.id,
        sessionTokenHash,
        status: 'active',
        expiresAt,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    })
    
    res.cookie('sso_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    })
    
    loginAttemptsTotal.inc({ result: 'success' })

    await prisma.auditLog.create({
      data: {
        eventType: 'login_success',
        result: 'success',
        userId: user.id,
        ipAddress: req.ip,
        metadata: { email }
      }
    })
    
    if (redirect_uri) {
      return res.redirect(redirect_uri)
    }
    
    res.redirect('/profile')
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).render('login', { 
      title: 'Login',
      error: 'An error occurred',
      redirect_uri: req.body.redirect_uri 
    })
  }
})

router.get('/password/change', async (req: Request, res: Response) => {
  const sessionToken = req.cookies.sso_session
  if (!sessionToken) {
    return res.redirect('/login')
  }
  
  const sessionTokenHash = hashToken(sessionToken)
  const session = await prisma.ssoSession.findFirst({
    where: { sessionTokenHash, status: 'active' }
  })
  
  if (!session || session.expiresAt < new Date()) {
    res.clearCookie('sso_session')
    return res.redirect('/login')
  }
  
  res.render('password-change', { title: 'Change Password', error: null, success: null })
})

router.post('/password/change', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body
    const sessionToken = req.cookies.sso_session
    
    if (!sessionToken) {
      return res.redirect('/login')
    }
    
    const sessionTokenHash = hashToken(sessionToken)
    const session = await prisma.ssoSession.findFirst({
      where: { sessionTokenHash, status: 'active' },
      include: { user: true }
    })
    
    if (!session || session.expiresAt < new Date()) {
      res.clearCookie('sso_session')
      return res.redirect('/login')
    }
    
    const validPassword = await bcrypt.compare(currentPassword, session.user.passwordHash)
    
    if (!validPassword) {
      return res.render('password-change', { 
        title: 'Change Password', 
        error: 'Current password is incorrect',
        success: null 
      })
    }
    
    const newPasswordHash = await bcrypt.hash(newPassword, 10)
    
    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash: newPasswordHash }
    })
    
    await prisma.ssoSession.updateMany({
      where: { userId: session.userId, status: 'active' },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        revokeReason: 'password_changed'
      }
    })
    
    await prisma.event.create({
      data: {
        eventType: 'PasswordChanged',
        userId: session.userId,
        centralSessionId: session.id,
        payload: {
          reason: 'password_changed'
        }
      }
    })
    
    await prisma.auditLog.create({
      data: {
        eventType: 'password_changed',
        result: 'success',
        userId: session.userId,
        ipAddress: req.ip
      }
    })
    
    res.clearCookie('sso_session')
    res.render('password-change', { 
      title: 'Change Password', 
      error: null,
      success: 'Password changed successfully. Please login again.' 
    })
  } catch (error) {
    console.error('Password change error:', error)
    res.render('password-change', { 
      title: 'Change Password', 
      error: 'An error occurred',
      success: null 
    })
  }
})

router.get('/logout', (req: Request, res: Response) => {
  const redirectUri = req.query.redirect_uri as string
  res.render('logout-confirm', { 
    title: 'Logout',
    redirect_uri: redirectUri 
  })
})

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const sessionToken = req.cookies.sso_session
    const redirectUri = req.body.redirect_uri || req.query.redirect_uri
    
    if (sessionToken) {
      const sessionTokenHash = hashToken(sessionToken)
      
      const session = await prisma.ssoSession.findFirst({
        where: { sessionTokenHash, status: 'active' }
      })
      
      if (session) {
        await prisma.ssoSession.update({
          where: { id: session.id },
          data: {
            status: 'revoked',
            revokedAt: new Date(),
            revokeReason: 'user_logout'
          }
        })
        
        await prisma.event.create({
          data: {
            eventType: 'SessionRevoked',
            userId: session.userId,
            centralSessionId: session.id,
            payload: {
              reason: 'sso_logout',
              sessionId: session.id
            }
          }
        })
        
        await prisma.auditLog.create({
          data: {
            eventType: 'logout_success',
            result: 'success',
            userId: session.userId,
            sessionId: session.id,
            ipAddress: req.ip
          }
        })
      }
    }
    
    res.clearCookie('sso_session')
    
    if (redirectUri) {
      return res.redirect(redirectUri)
    }
    
    res.redirect('/login')
  } catch (error) {
    console.error('Logout error:', error)
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Logout failed' } })
  }
})

export default router
