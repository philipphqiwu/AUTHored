import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  } else if (err.name === 'PrismaClientKnownRequestError') {
    // Handle Prisma errors
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      statusCode = 409;
      code = 'CONFLICT';
      message = 'Resource already exists';
    } else if (prismaError.code === 'P2025') {
      statusCode = 404;
      code = 'NOT_FOUND';
      message = 'Resource not found';
    }
  }

  // Log error for debugging
  console.error(`[ERROR] ${code}: ${message}`);
  if (statusCode === 500) {
    console.error(err.stack);
  }

  // Send response
  res.status(statusCode).json({
    error: {
      code,
      message,
      requestId: req.headers['x-request-id'] || undefined
    }
  });
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404, 'NOT_FOUND');
  next(error);
};
