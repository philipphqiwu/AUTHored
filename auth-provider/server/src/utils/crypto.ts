import crypto from 'crypto'

export function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length)
}

export function generateCodeChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url')
}

export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const computed = generateCodeChallenge(codeVerifier)
  return computed === codeChallenge
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}
