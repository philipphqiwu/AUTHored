import { Router, Request, Response } from 'express'
import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import prisma from '../utils/prisma.js'
import { generateToken, hashToken } from '../utils/crypto.js'
import { mfaVerificationsTotal } from '../utils/metrics.js'

const router = Router()

const MFA_ISSUER = 'AUTHored'
const MFA_PENDING_MAX_AGE = 5 * 60 * 1000
const RECOVERY_CODE_COUNT = 8
const RECOVERY_CODE_LENGTH = 10

function generateRecoveryCodes(): string[] {
  const codes: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = crypto.randomBytes(RECOVERY_CODE_LENGTH).toString('base64url').slice(0, RECOVERY_CODE_LENGTH).toUpperCase()
    const formatted = raw.slice(0, 4) + '-' + raw.slice(4)
    codes.push(formatted)
  }
  return codes
}

function setMfaPendingCookie(res: Response, userId: string, redirectUri?: string) {
  const payload = JSON.stringify({ userId, redirectUri: redirectUri || null, ts: Date.now() })
  const token = Buffer.from(payload).toString('base64url')
  res.cookie('mfa_pending', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MFA_PENDING_MAX_AGE
  })
}

function getMfaPendingCookie(req: Request): { userId: string; redirectUri?: string } | null {
  const token = req.cookies.mfa_pending
  if (!token) return null
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString())
    if (Date.now() - payload.ts > MFA_PENDING_MAX_AGE) return null
    return { userId: payload.userId, redirectUri: payload.redirectUri }
  } catch {
    return null
  }
}

function requireSession(req: Request, res: Response): string | null {
  const sessionToken = req.cookies.sso_session
  if (!sessionToken) {
    res.redirect('/login')
    return null
  }
  return sessionToken
}

// GET /mfa/setup — Show enrollment page with QR code
router.get('/mfa/setup', async (req: Request, res: Response) => {
  const sessionToken = requireSession(req, res)
  if (!sessionToken) return

  const sessionTokenHash = hashToken(sessionToken)
  const session = await prisma.ssoSession.findFirst({
    where: { sessionTokenHash, status: 'active' },
    include: { user: true }
  })

  if (!session || session.expiresAt < new Date()) {
    res.clearCookie('sso_session')
    return res.redirect('/login')
  }

  if (session.user.totpEnabled) {
    return res.redirect('/profile')
  }

  const secret = speakeasy.generateSecret({
    name: `${MFA_ISSUER}:${session.user.email}`,
    issuer: MFA_ISSUER,
    length: 20
  })

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!)

  res.render('mfa-setup', {
    title: 'Enable MFA',
    qrCode: qrDataUrl,
    manualKey: secret.base32,
    error: null
  })
})

// POST /mfa/setup — Verify initial code and enable MFA
router.post('/mfa/setup', async (req: Request, res: Response) => {
  const sessionToken = req.cookies.sso_session
  if (!sessionToken) return res.redirect('/login')

  const sessionTokenHash = hashToken(sessionToken)
  const session = await prisma.ssoSession.findFirst({
    where: { sessionTokenHash, status: 'active' },
    include: { user: true }
  })

  if (!session || session.expiresAt < new Date()) {
    res.clearCookie('sso_session')
    return res.redirect('/login')
  }

  if (session.user.totpEnabled) {
    return res.redirect('/profile')
  }

  const { code, secret } = req.body
  if (!code || !secret) {
    return res.render('mfa-setup', {
      title: 'Enable MFA',
      qrCode: '',
      manualKey: '',
      error: 'Missing verification code'
    })
  }

  const verified = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 1
  })

  if (!verified) {
    const otpauthUrl = speakeasy.otpauthURL({
      secret: secret,
      label: `${MFA_ISSUER}:${session.user.email}`,
      issuer: MFA_ISSUER
    })
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl)
    return res.render('mfa-setup', {
      title: 'Enable MFA',
      qrCode: qrDataUrl,
      manualKey: secret,
      error: 'Invalid code. Please try again.'
    })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      totpEnabled: true,
      totpSecret: secret
    }
  })

  const recoveryCodes = generateRecoveryCodes()
  const hashedCodes = await Promise.all(
    recoveryCodes.map(async (code) => ({
      userId: session.user.id,
      codeHash: await bcrypt.hash(code, 10)
    }))
  )
  await prisma.recoveryCode.createMany({ data: hashedCodes })

  await prisma.auditLog.create({
    data: {
      eventType: 'mfa_enabled',
      result: 'success',
      userId: session.user.id,
      sessionId: session.id,
      ipAddress: req.ip
    }
  })

  res.render('mfa-recovery-codes', {
    title: 'Recovery Codes',
    recoveryCodes
  })
})

// GET /mfa/verify — Show TOTP verification page (login flow)
router.get('/mfa/verify', (req: Request, res: Response) => {
  const pending = getMfaPendingCookie(req)
  if (!pending) {
    return res.redirect('/login')
  }

  res.render('mfa-verify', {
    title: 'Verify MFA',
    error: null,
    useRecoveryCode: false
  })
})

// POST /mfa/verify — Verify TOTP code during login
router.post('/mfa/verify', async (req: Request, res: Response) => {
  const pending = getMfaPendingCookie(req)
  if (!pending) {
    return res.redirect('/login')
  }

  const { code, recovery_code } = req.body

  const user = await prisma.user.findUnique({ where: { id: pending.userId } })
  if (!user || !user.totpEnabled) {
    res.clearCookie('mfa_pending')
    return res.redirect('/login')
  }

  let verified = false

  if (recovery_code) {
    const recoveryCodes = await prisma.recoveryCode.findMany({
      where: { userId: user.id, usedAt: null }
    })

    for (const rc of recoveryCodes) {
      const match = await bcrypt.compare(recovery_code.replace(/\s/g, '').toUpperCase(), rc.codeHash)
      if (match) {
        verified = true
        await prisma.recoveryCode.update({
          where: { id: rc.id },
          data: { usedAt: new Date() }
        })

        mfaVerificationsTotal.inc({ method: 'recovery_code', result: 'success' })

        await prisma.auditLog.create({
          data: {
            eventType: 'mfa_recovery_code_used',
            result: 'success',
            userId: user.id,
            ipAddress: req.ip
          }
        })
        break
      }
    }

    if (!verified) {
      mfaVerificationsTotal.inc({ method: 'recovery_code', result: 'failure' })
      return res.render('mfa-verify', {
        title: 'Verify MFA',
        error: 'Invalid recovery code',
        useRecoveryCode: true
      })
    }
  } else if (code) {
    verified = speakeasy.totp.verify({
      secret: user.totpSecret!,
      encoding: 'base32',
      token: code,
      window: 1
    })

    if (!verified) {
      mfaVerificationsTotal.inc({ method: 'totp', result: 'failure' })
      await prisma.auditLog.create({
        data: {
          eventType: 'mfa_verification_failed',
          result: 'failure',
          userId: user.id,
          ipAddress: req.ip
        }
      })

      return res.render('mfa-verify', {
        title: 'Verify MFA',
        error: 'Invalid code. Please try again.',
        useRecoveryCode: false
      })
    }

    mfaVerificationsTotal.inc({ method: 'totp', result: 'success' })

    await prisma.auditLog.create({
      data: {
        eventType: 'mfa_verification_success',
        result: 'success',
        userId: user.id,
        ipAddress: req.ip
      }
    })
  } else {
    return res.render('mfa-verify', {
      title: 'Verify MFA',
      error: 'Please enter a code',
      useRecoveryCode: false
    })
  }

  const sessionToken = generateToken()
  const sessionTokenHash = hashToken(sessionToken)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

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

  res.clearCookie('mfa_pending')

  if (pending.redirectUri) {
    return res.redirect(pending.redirectUri)
  }

  res.redirect('/profile')
})

// GET /mfa/disable — Show disable page
router.get('/mfa/disable', async (req: Request, res: Response) => {
  const sessionToken = requireSession(req, res)
  if (!sessionToken) return

  const sessionTokenHash = hashToken(sessionToken)
  const session = await prisma.ssoSession.findFirst({
    where: { sessionTokenHash, status: 'active' },
    include: { user: true }
  })

  if (!session || session.expiresAt < new Date()) {
    res.clearCookie('sso_session')
    return res.redirect('/login')
  }

  if (!session.user.totpEnabled) {
    return res.redirect('/profile')
  }

  res.render('mfa-disable', {
    title: 'Disable MFA',
    error: null
  })
})

// POST /mfa/disable — Disable MFA after code verification
router.post('/mfa/disable', async (req: Request, res: Response) => {
  const sessionToken = req.cookies.sso_session
  if (!sessionToken) return res.redirect('/login')

  const sessionTokenHash = hashToken(sessionToken)
  const session = await prisma.ssoSession.findFirst({
    where: { sessionTokenHash, status: 'active' },
    include: { user: true }
  })

  if (!session || session.expiresAt < new Date()) {
    res.clearCookie('sso_session')
    return res.redirect('/login')
  }

  if (!session.user.totpEnabled) {
    return res.redirect('/profile')
  }

  const { code } = req.body
  if (!code) {
    return res.render('mfa-disable', {
      title: 'Disable MFA',
      error: 'Please enter your TOTP code'
    })
  }

  const verified = speakeasy.totp.verify({
    secret: session.user.totpSecret!,
    encoding: 'base32',
    token: code,
    window: 1
  })

  if (!verified) {
    return res.render('mfa-disable', {
      title: 'Disable MFA',
      error: 'Invalid code. Please try again.'
    })
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      totpEnabled: false,
      totpSecret: null
    }
  })

  await prisma.recoveryCode.deleteMany({ where: { userId: session.user.id } })

  await prisma.auditLog.create({
    data: {
      eventType: 'mfa_disabled',
      result: 'success',
      userId: session.user.id,
      sessionId: session.id,
      ipAddress: req.ip
    }
  })

  res.redirect('/profile')
})

export default router
