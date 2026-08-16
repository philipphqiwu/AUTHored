import { Request, Response, NextFunction } from 'express'

const sessions = new Map<string, boolean>()

export function createSession(): string {
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36)
  sessions.set(token, true)
  return token
}

export function destroySession(token: string): void {
  sessions.delete(token)
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies.admin_session
  
  if (!token || !sessions.has(token)) {
    res.redirect('/login')
    return
  }
  
  next()
}
