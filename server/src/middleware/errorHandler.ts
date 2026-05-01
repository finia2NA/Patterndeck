import type { Request, Response, NextFunction } from 'express';
import { capture, captureException } from '../services/analytics.service.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  console.error('[error]', err);

  if (err instanceof AppError) {
    if (err.code === 'USAGE_LIMIT') {
      capture(req.userId, 'usage_limit_hit', {
        route: req.path,
        endpoint: req.originalUrl,
        method: req.method,
        app_session_id: req.appSessionId,
        status_code: err.statusCode,
        error_code: err.code,
      });
    }
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  captureException(err, req.userId, {
    route: req.path,
    endpoint: req.originalUrl,
    method: req.method,
    app_session_id: req.appSessionId,
    status_code: 500,
    error_code: 'INTERNAL_ERROR',
  });

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
}
