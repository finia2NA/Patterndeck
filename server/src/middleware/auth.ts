import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth.service.js';
import { AppError } from './errorHandler.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      appSessionId?: string;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header.');
    }

    const token = header.slice(7);
    const { userId } = verifyToken(token);
    req.userId = userId;
    const appSessionId = req.headers['x-app-session-id'];
    if (typeof appSessionId === 'string' && appSessionId.trim().length > 0) {
      req.appSessionId = appSessionId.trim();
    }

    next();
  } catch (e) {
    next(e);
  }
}
