export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request', code: string = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code: string = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code: string = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', code: string = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists', code: string = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', code: string = 'VALIDATION_ERROR') {
    super(message, 422, code);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', code: string = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code);
  }
}

export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', code: string = 'INTERNAL_ERROR') {
    super(message, 500, code);
    this.isOperational = false;
  }
}
