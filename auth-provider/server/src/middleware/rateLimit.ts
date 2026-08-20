import rateLimit from 'express-rate-limit'

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many login attempts. Please try again after 15 minutes.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
})

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
})
