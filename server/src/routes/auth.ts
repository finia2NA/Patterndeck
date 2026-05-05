import { Router } from 'express';
import { register, login, findOrCreateByApple, findOrCreateByGoogle, getMe, requestPasswordReset, validateResetToken, resetPassword } from '../services/auth.service.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config.js';
import { validateEmail, validatePassword } from '@patterndeck/shared';
import { capture, identify } from '../services/analytics.service.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new AppError(400, 'MISSING_FIELDS', 'Email and password are required.');
    const emailErr = validateEmail(email);
    if (emailErr) throw new AppError(400, 'INVALID_EMAIL', emailErr);
    const pwErr = validatePassword(password);
    if (pwErr) throw new AppError(400, 'WEAK_PASSWORD', pwErr);
    const result = await register(email, password);
    identify(result.user.id, { auth_method: 'email', email });
    capture(result.user.id, 'onboarding_completed', { auth_method: 'email', auth_flow: 'register' });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new AppError(400, 'MISSING_FIELDS', 'Email and password are required.');
    const result = await login(email, password);
    identify(result.user.id, { auth_method: 'email', email });
    res.json(result);
  } catch (e) { next(e); }
});

authRouter.post('/apple', async (req, res, next) => {
  try {
    const { identityToken } = req.body;
    if (!identityToken) throw new AppError(400, 'MISSING_FIELDS', 'identityToken is required.');

    // Dynamically import apple-signin-auth to avoid issues if not configured
    const appleSignin = await import('apple-signin-auth');
    const payload = await appleSignin.verifyIdToken(identityToken, {
      audience: config.appleClientId,
      ignoreExpiration: false,
    });

    const appleId = payload.sub;
    const email = payload.email ?? null;
    const result = await findOrCreateByApple(appleId, email);
    identify(result.user.id, { auth_method: 'apple', email: result.user.email ?? undefined });
    res.json(result);
  } catch (e) { next(e); }
});

authRouter.post('/google', async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) throw new AppError(400, 'MISSING_FIELDS', 'idToken is required.');

    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client(config.googleClientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new AppError(401, 'INVALID_TOKEN', 'Invalid Google token.');

    const result = await findOrCreateByGoogle(payload.sub, payload.email ?? null);
    identify(result.user.id, { auth_method: 'google', email: result.user.email ?? undefined });
    res.json(result);
  } catch (e) { next(e); }
});

const resetRateLimit = new Map<string, { count: number; resetAt: number }>();

authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    const forgotEmailErr = validateEmail(email ?? '');
    if (!email || forgotEmailErr) {
      throw new AppError(400, 'INVALID_EMAIL', forgotEmailErr ?? 'Please enter a valid email address.');
    }

    const key = email.toLowerCase();
    const now = Date.now();
    const entry = resetRateLimit.get(key);
    if (entry && entry.resetAt > now && entry.count >= 3) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many reset requests. Please try again later.');
    }
    if (!entry || entry.resetAt <= now) {
      resetRateLimit.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    } else {
      entry.count++;
    }

    await requestPasswordReset(email.trim());
    res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (e) { next(e); }
});

authRouter.post('/validate-reset-token', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) throw new AppError(400, 'MISSING_FIELDS', 'Token is required.');
    const valid = await validateResetToken(token);
    res.json({ valid });
  } catch (e) { next(e); }
});

authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) throw new AppError(400, 'MISSING_FIELDS', 'Token and new password are required.');
    if (newPassword.length < 8) throw new AppError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) throw new AppError(400, 'WEAK_PASSWORD', 'Password must contain at least one letter and one number.');

    await resetPassword(token, newPassword);
    res.json({ message: 'Password has been reset.' });
  } catch (e) { next(e); }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await getMe(req.userId!);
    identify(req.userId!, { has_api_key: result.hasApiKey, central_key_available: result.centralKeyAvailable, email: result.email ?? undefined });
    res.json(result);
  } catch (e) { next(e); }
});

authRouter.post('/validate-key', requireAuth, async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) throw new AppError(400, 'MISSING_FIELDS', 'apiKey is required.');

    // Quick validation: make a minimal API call
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (response.ok) {
      res.json({ valid: true });
    } else {
      const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
      res.json({ valid: false, error: err?.error?.message ?? `HTTP ${response.status}` });
    }
  } catch (e) { next(e); }
});
