import { Router } from 'express'
import { createSession, destroySession } from '../middleware/auth.js'
import prisma from '../utils/prisma.js'

const router = Router()

router.get('/login', (req, res) => {
  res.render('login', { title: 'Login', error: null })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    const token = createSession()
    res.cookie('admin_session', token, { 
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    })
    
    await prisma.auditLog.create({
      data: {
        eventType: 'admin_login',
        result: 'success',
        ipAddress: req.ip,
        metadata: { email }
      }
    })
    
    res.redirect('/')
  } else {
    await prisma.auditLog.create({
      data: {
        eventType: 'admin_login',
        result: 'failure',
        ipAddress: req.ip,
        metadata: { email, reason: 'invalid_credentials' }
      }
    })
    
    res.render('login', { title: 'Login', error: 'Invalid credentials' })
  }
})

router.post('/logout', async (req, res) => {
  const token = req.cookies.admin_session
  if (token) {
    destroySession(token)
  }
  
  await prisma.auditLog.create({
    data: {
      eventType: 'admin_logout',
      result: 'success',
      ipAddress: req.ip
    }
  })
  
  res.clearCookie('admin_session')
  res.redirect('/login')
})

export default router
