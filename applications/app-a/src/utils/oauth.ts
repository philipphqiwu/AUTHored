const AUTH_PROVIDER_URL = process.env.AUTH_PROVIDER_URL || 'http://localhost:3000'
const CLIENT_ID = process.env.CLIENT_ID || 'app-a-client-id'
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'app-a-client-secret'
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3002/callback'

export function buildAuthorizationUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  })
  
  return `${AUTH_PROVIDER_URL}/authorize?${params.toString()}`
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<{ access_token: string, token_type: string, expires_in: number }> {
  const response = await fetch(`${AUTH_PROVIDER_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: codeVerifier
    })
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Token exchange failed')
  }
  
  return response.json()
}

export async function getUserInfo(accessToken: string): Promise<{ sub: string, name: string, email: string, email_verified: boolean }> {
  const response = await fetch(`${AUTH_PROVIDER_URL}/userinfo`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Failed to get user info')
  }
  
  return response.json()
}
