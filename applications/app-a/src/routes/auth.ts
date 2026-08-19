import { Router, Request, Response } from 'express'
import { generateCodeVerifier, generateCodeChallenge, generateState, generateSessionToken, hashToken } from '../utils/crypto.js'
import { buildAuthorizationUrl, exchangeCodeForToken, getUserInfo } from '../utils/oauth.js'
import { logActivity, getRecentActivities, getProcessedEvents } from '../utils/activity.js'
import { requireAuth } from '../middleware/session.js'
import prisma from '../utils/prisma.js'

const router = Router()

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const session = (req as any).session
    const user = (req as any).user
    const activities = await getRecentActivities(20)
    const processedEvents = await getProcessedEvents()
    
    res.render('home', {
      title: 'App A',
      appName: 'APP A',
      user,
      session,
      activities,
      processedEvents
    })
  } catch (error) {
    console.error('Home page error:', error)
    res.render('error', {
      title: 'Error',
      error: { code: 'SERVER_ERROR', message: 'Failed to load home page' }
    })
  }
})

router.get('/login', (req: Request, res: Response) => {
  res.render('login', { title: 'Login - App A', appName: 'APP A' })
})

router.get('/auth/login', async (req: Request, res: Response) => {
  try {
    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000
    })
    
    res.cookie('code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000
    })
    
    await logActivity('redirect_to_auth_provider', {
      state,
      code_challenge: codeChallenge
    })
    
    const authUrl = buildAuthorizationUrl(state, codeChallenge)
    res.redirect(authUrl)
  } catch (error) {
    console.error('Login error:', error)
    await logActivity('error_occurred', {
      step: 'redirect_to_auth_provider',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 'error' })
    
    res.render('error', {
      title: 'Error',
      error: { code: 'AUTH_ERROR', message: 'Failed to initiate login' }
    })
  }
})

router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error: authError } = req.query as {
      code?: string
      state?: string
      error?: string
    }
    
    if (authError) {
      await logActivity('authorization_denied', { error: authError }, { status: 'error' })
      return res.render('error', {
        title: 'Error',
        error: { code: 'ACCESS_DENIED', message: 'Access denied by authorization server' }
      })
    }
    
    if (!code || !state) {
      await logActivity('invalid_callback', { reason: 'missing_code_or_state' }, { status: 'error' })
      return res.render('error', {
        title: 'Error',
        error: { code: 'INVALID_CALLBACK', message: 'Invalid authorization callback' }
      })
    }
    
    const storedState = req.cookies.oauth_state
    if (state !== storedState) {
      await logActivity('state_mismatch', { received: state, expected: storedState }, { status: 'error' })
      return res.render('error', {
        title: 'Error',
        error: { code: 'STATE_MISMATCH', message: 'Invalid state parameter' }
      })
    }
    
    await logActivity('authorization_code_received', { code: code.substring(0, 8) + '...' })
    
    const codeVerifier = req.cookies.code_verifier
    if (!codeVerifier) {
      await logActivity('missing_code_verifier', {}, { status: 'error' })
      return res.render('error', {
        title: 'Error',
        error: { code: 'MISSING_VERIFIER', message: 'Missing code verifier' }
      })
    }
    
    await logActivity('token_exchange_started', {})
    
    const tokenResponse = await exchangeCodeForToken(code, codeVerifier)
    
    await logActivity('token_exchange_success', {
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in
    })
    
    await logActivity('userinfo_fetched', {})
    
    const userInfo = await getUserInfo(tokenResponse.access_token)
    
    await prisma.profileCache.upsert({
      where: { externalUserId: userInfo.sub },
      update: {
        name: userInfo.name,
        email: userInfo.email,
        syncedAt: new Date()
      },
      create: {
        externalUserId: userInfo.sub,
        name: userInfo.name,
        email: userInfo.email
      }
    })
    
    const sessionToken = generateSessionToken()
    const sessionTokenHash = hashToken(sessionToken)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    
    const session = await prisma.localSession.create({
      data: {
        sessionTokenHash,
        externalUserId: userInfo.sub,
        centralSessionId: tokenResponse.access_token,
        status: 'active',
        expiresAt
      }
    })
    
    await logActivity('local_session_created', {
      sessionId: session.id,
      expiresAt: expiresAt.toISOString()
    }, {
      userId: userInfo.sub,
      sessionId: session.id
    })
    
    res.cookie('local_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000
    })
    
    res.clearCookie('oauth_state')
    res.clearCookie('code_verifier')
    
    res.redirect('/')
  } catch (error) {
    console.error('Callback error:', error)
    await logActivity('error_occurred', {
      step: 'callback',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 'error' })
    
    res.render('error', {
      title: 'Error',
      error: { code: 'CALLBACK_ERROR', message: 'Authentication failed' }
    })
  }
})

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const sessionToken = req.cookies.local_session
    
    if (sessionToken) {
      const sessionTokenHash = hashToken(sessionToken)
      const session = await prisma.localSession.findFirst({
        where: { sessionTokenHash, status: 'active' }
      })
      
      if (session) {
        await prisma.localSession.update({
          where: { id: session.id },
          data: {
            status: 'revoked',
            revokedAt: new Date(),
            revokeReason: 'user_logout'
          }
        })
        
        await logActivity('local_logout', {
          sessionId: session.id
        }, {
          userId: session.externalUserId,
          sessionId: session.id
        })
      }
    }
    
    res.clearCookie('local_session')
    res.redirect('/login')
  } catch (error) {
    console.error('Logout error:', error)
    res.clearCookie('local_session')
    res.redirect('/login')
  }
})

router.get('/sso-logout', async (req: Request, res: Response) => {
  try {
    const sessionToken = req.cookies.local_session
    
    if (sessionToken) {
      const sessionTokenHash = hashToken(sessionToken)
      const session = await prisma.localSession.findFirst({
        where: { sessionTokenHash, status: 'active' }
      })
      
      if (session) {
        await prisma.localSession.update({
          where: { id: session.id },
          data: {
            status: 'revoked',
            revokedAt: new Date(),
            revokeReason: 'sso_logout'
          }
        })
        
        await logActivity('sso_logout_initiated', {
          sessionId: session.id
        }, {
          userId: session.externalUserId,
          sessionId: session.id
        })
      }
    }
    
    res.clearCookie('local_session')
    
    const authProviderUrl = process.env.AUTH_PROVIDER_URL || 'http://localhost:3000'
    const redirectUri = `${req.protocol}://${req.get('host')}/login`
    
    res.redirect(`${authProviderUrl}/logout?redirect_uri=${encodeURIComponent(redirectUri)}`)
  } catch (error) {
    console.error('SSO logout error:', error)
    res.clearCookie('local_session')
    res.redirect('/login')
  }
})

export default router
