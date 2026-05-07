import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config, isCentralKeyAvailable } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendPasswordResetEmail } from './email.service.js';

const JWT_EXPIRY = '7d';

function normalizeUiLanguage(value: string | undefined): 'en' | 'de' | null {
  return value === 'en' || value === 'de' ? value : null;
}

async function createUiLanguageSetting(userId: string, uiLanguage?: string) {
  const value = normalizeUiLanguage(uiLanguage);
  if (!value) return;
  await prisma.setting.create({ data: { userId, key: 'ui_language', value } });
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): { userId: string } {
  try {
    return jwt.verify(token, config.jwtSecret) as { userId: string };
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token.');
  }
}

export async function register(email: string, password: string, uiLanguage?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash } });
  await createUiLanguageSetting(user.id, uiLanguage);

  return { token: signToken(user.id), user: { id: user.id, email: user.email } };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

  return { token: signToken(user.id), user: { id: user.id, email: user.email } };
}

export async function findOrCreateByApple(appleId: string, email: string | null, uiLanguage?: string) {
  // Try to find by appleId first
  let user = await prisma.user.findUnique({ where: { appleId } });
  if (user) return { token: signToken(user.id), user: { id: user.id, email: user.email } };

  // Try to link to existing account by email
  if (email) {
    user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      user = await prisma.user.update({ where: { id: user.id }, data: { appleId } });
      return { token: signToken(user.id), user: { id: user.id, email: user.email } };
    }
  }

  // Create new user
  user = await prisma.user.create({ data: { appleId, email } });
  await createUiLanguageSetting(user.id, uiLanguage);
  return { token: signToken(user.id), user: { id: user.id, email: user.email } };
}

export async function findOrCreateByGoogle(googleId: string, email: string | null, uiLanguage?: string) {
  let user = await prisma.user.findUnique({ where: { googleId } });
  if (user) return { token: signToken(user.id), user: { id: user.id, email: user.email } };

  if (email) {
    user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
      return { token: signToken(user.id), user: { id: user.id, email: user.email } };
    }
  }

  user = await prisma.user.create({ data: { googleId, email } });
  await createUiLanguageSetting(user.id, uiLanguage);
  return { token: signToken(user.id), user: { id: user.id, email: user.email } };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.passwordResetToken.upsert({
    where: { userId: user.id },
    create: { userId: user.id, tokenHash, expiresAt },
    update: { tokenHash, expiresAt },
  });

  const resetUrl = `${config.appUrl}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(email, resetUrl);
}

export async function validateResetToken(rawToken: string): Promise<boolean> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash } });
  if (!record) return false;
  if (record.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({ where: { id: record.id } });
    return false;
  }
  return true;
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash } });

  if (!record) throw new AppError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.');

  if (record.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({ where: { id: record.id } });
    throw new AppError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.delete({ where: { id: record.id } }),
  ]);
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');

  const authMethods: string[] = [];
  if (user.passwordHash) authMethods.push('email');
  if (user.appleId) authMethods.push('apple');
  if (user.googleId) authMethods.push('google');

  return {
    id: user.id,
    email: user.email,
    hasApiKey: !!user.claudeApiKey,
    centralKeyAvailable: isCentralKeyAvailable(),
    authMethods,
  };
}
