import { Router, Request, Response } from 'express'
import bcrypt from 'bcrypt'
import prisma from '../utils/prisma.js'
import { generateToken, hashToken, verifyCodeChallenge, generateRandomString } from '../utils/crypto.js'
import { authorizationCodesIssued } from '../utils/metrics.js'

const router = Router()

router.get('/authorize', async (req: Request, res: Response) => {
  try {
    const { 
      client_id, 
      redirect_uri, 
      response_type, 
      state, 
      code_challenge, 
      code_challenge_method 
    } = req.query as {
      client_id: string
      redirect_uri: string
      response_type: string
      state: string
      code_challenge: string
      code_challenge_method: string
    }
    
    if (response_type !== 'code') {
      return res.status(400).json({ 
        error: { code: 'UNSUPPORTED_RESPONSE_TYPE', message: 'Only authorization code flow is supported' } 
      })
    }
    
    if (!code_challenge || code_challenge_method !== 'S256') {
      return res.status(400).json({ 
        error: { code: 'PKCE_REQUIRED', message: 'PKCE with S256 is required' } 
      })
    }
    
    const application = await prisma.application.findUnique({
      where: { clientId: client_id },
      include: { redirectUris: true, policies: true }
    })
    
    if (!application) {
      return res.status(400).json({ 
        error: { code: 'INVALID_CLIENT', message: 'Invalid client_id' } 
      })
    }
    
    if (application.status !== 'active') {
      return res.status(400).json({ 
        error: { code: 'CLIENT_INACTIVE', message: 'Application is inactive' } 
      })
    }
    
    const validRedirectUri = application.redirectUris.some(uri => uri.redirectUri === redirect_uri)
    if (!validRedirectUri) {
      return res.status(400).json({ 
        error: { code: 'INVALID_REDIRECT_URI', message: 'Invalid redirect_uri' } 
      })
    }
    
    const sessionToken = req.cookies.sso_session
    if (!sessionToken) {
      const loginUrl = `/login?redirect_uri=${encodeURIComponent(req.originalUrl)}`
      return res.redirect(loginUrl)
    }
    
    const sessionTokenHash = hashToken(sessionToken)
    const session = await prisma.ssoSession.findFirst({
      where: { sessionTokenHash, status: 'active' },
      include: { user: true }
    })
    
    if (!session || session.expiresAt < new Date()) {
      const loginUrl = `/login?redirect_uri=${encodeURIComponent(req.originalUrl)}`
      return res.redirect(loginUrl)
    }
    
    await prisma.ssoSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() }
    })
    
    const userGroups = await prisma.userGroup.findMany({
      where: { userId: session.userId },
      select: { groupId: true }
    })
    
    const userGroupIds = userGroups.map(ug => ug.groupId)
    
    const hasAccess = application.policies.some(policy => 
      userGroupIds.includes(policy.groupId) && policy.effect === 'allow'
    )
    
    if (!hasAccess) {
      await prisma.auditLog.create({
        data: {
          eventType: 'authorization_denied',
          result: 'failure',
          userId: session.userId,
          applicationId: application.id,
          ipAddress: req.ip,
          metadata: { reason: 'no_policy_match', client_id }
        }
      })
      
      const errorUrl = `${redirect_uri}?error=access_denied&error_description=Access%20denied&state=${state}`
      return res.redirect(errorUrl)
    }
    
    const authCode = generateRandomString(32)
    const authCodeHash = hashToken(authCode)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    
    await prisma.authorizationCode.create({
      data: {
        codeHash: authCodeHash,
        userId: session.userId,
        applicationId: application.id,
        ssoSessionId: session.id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        expiresAt
      }
    })

    authorizationCodesIssued.inc()
    
    await prisma.auditLog.create({
      data: {
        eventType: 'authorization_code_issued',
        result: 'success',
        userId: session.userId,
        applicationId: application.id,
        sessionId: session.id,
        ipAddress: req.ip,
        metadata: { client_id, redirect_uri }
      }
    })
    
    const redirectUrl = `${redirect_uri}?code=${authCode}&state=${state}`
    res.redirect(redirectUrl)
  } catch (error) {
    console.error('Authorize error:', error)
    res.status(500).json({ 
      error: { code: 'SERVER_ERROR', message: 'Authorization failed' } 
    })
  }
})

router.post('/token', async (req: Request, res: Response) => {
  try {
    const { 
      grant_type, 
      code, 
      redirect_uri, 
      client_id, 
      client_secret, 
      code_verifier 
    } = req.body
    
    if (grant_type !== 'authorization_code') {
      return res.status(400).json({ 
        error: { code: 'UNSUPPORTED_GRANT_TYPE', message: 'Only authorization_code grant is supported' } 
      })
    }
    
    const application = await prisma.application.findUnique({
      where: { clientId: client_id }
    })
    
    if (!application) {
      return res.status(400).json({ 
        error: { code: 'INVALID_CLIENT', message: 'Invalid client_id' } 
      })
    }
    
    if (!application.clientSecretHash) {
      return res.status(400).json({ 
        error: { code: 'INVALID_CLIENT', message: 'Client secret not configured' } 
      })
    }
    
    const validSecret = await bcrypt.compare(client_secret, application.clientSecretHash)
    
    if (!validSecret) {
      await prisma.auditLog.create({
        data: {
          eventType: 'token_exchange_failed',
          result: 'failure',
          applicationId: application.id,
          ipAddress: req.ip,
          metadata: { client_id, reason: 'invalid_client_secret' }
        }
      })
      
      return res.status(401).json({ 
        error: { code: 'INVALID_CLIENT', message: 'Invalid client credentials' } 
      })
    }
    
    const codeHash = hashToken(code)
    const authCode = await prisma.authorizationCode.findFirst({
      where: { codeHash }
    })
    
    if (!authCode) {
      return res.status(400).json({ 
        error: { code: 'INVALID_GRANT', message: 'Invalid authorization code' } 
      })
    }
    
    if (authCode.usedAt) {
      await prisma.auditLog.create({
        data: {
          eventType: 'token_exchange_failed',
          result: 'failure',
          userId: authCode.userId,
          applicationId: application.id,
          ipAddress: req.ip,
          metadata: { client_id, reason: 'code_already_used' }
        }
      })
      
      return res.status(400).json({ 
        error: { code: 'INVALID_GRANT', message: 'Authorization code already used' } 
      })
    }
    
    if (authCode.expiresAt < new Date()) {
      return res.status(400).json({ 
        error: { code: 'INVALID_GRANT', message: 'Authorization code expired' } 
      })
    }
    
    if (authCode.applicationId !== application.id) {
      return res.status(400).json({ 
        error: { code: 'INVALID_GRANT', message: 'Authorization code issued for different client' } 
      })
    }
    
    if (authCode.redirectUri !== redirect_uri) {
      return res.status(400).json({ 
        error: { code: 'INVALID_GRANT', message: 'Redirect URI mismatch' } 
      })
    }
    
    if (!verifyCodeChallenge(code_verifier, authCode.codeChallenge)) {
      return res.status(400).json({ 
        error: { code: 'INVALID_GRANT', message: 'PKCE verification failed' } 
      })
    }
    
    await prisma.authorizationCode.update({
      where: { id: authCode.id },
      data: { usedAt: new Date() }
    })
    
    const accessToken = generateToken()
    const accessTokenHash = hashToken(accessToken)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    
    await prisma.accessToken.create({
      data: {
        tokenHash: accessTokenHash,
        userId: authCode.userId,
        applicationId: application.id,
        ssoSessionId: authCode.ssoSessionId,
        status: 'active',
        expiresAt
      }
    })
    
    await prisma.auditLog.create({
      data: {
        eventType: 'token_issued',
        result: 'success',
        userId: authCode.userId,
        applicationId: application.id,
        sessionId: authCode.ssoSessionId,
        ipAddress: req.ip,
        metadata: { client_id }
      }
    })
    
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600
    })
  } catch (error) {
    console.error('Token error:', error)
    res.status(500).json({ 
      error: { code: 'SERVER_ERROR', message: 'Token exchange failed' } 
    })
  }
})

router.get('/userinfo', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } 
      })
    }
    
    const accessToken = authHeader.substring(7)
    const accessTokenHash = hashToken(accessToken)
    
    const token = await prisma.accessToken.findFirst({
      where: { tokenHash: accessTokenHash, status: 'active' },
      include: { user: true }
    })
    
    if (!token) {
      return res.status(401).json({ 
        error: { code: 'INVALID_TOKEN', message: 'Invalid access token' } 
      })
    }
    
    if (token.expiresAt < new Date()) {
      return res.status(401).json({ 
        error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' } 
      })
    }
    
    const session = await prisma.ssoSession.findFirst({
      where: { id: token.ssoSessionId, status: 'active' }
    })
    
    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ 
        error: { code: 'SESSION_INVALID', message: 'Session no longer valid' } 
      })
    }
    
    res.json({
      sub: token.user.id,
      name: token.user.name,
      email: token.user.email,
      email_verified: true,
      central_session_id: token.ssoSessionId
    })
  } catch (error) {
    console.error('Userinfo error:', error)
    res.status(500).json({ 
      error: { code: 'SERVER_ERROR', message: 'Failed to get user info' } 
    })
  }
})

router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

export default router
