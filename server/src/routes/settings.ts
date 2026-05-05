import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAllSettings, getSetting, setSetting, setSettings } from '../services/settings.service.js';
import { getUserMonthlyUsage, getGlobalCentralUsage } from '../services/usage.service.js';
import { config, isCentralKeyAvailable } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../services/crypto.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { reconcileNotificationSchedule } from '../services/notification.service.js';

export const settingsRouter = Router();
const NOTIFICATION_SCHEDULE_SETTING_KEYS = new Set(['notifications_enabled', 'notification_time', 'review_timezone']);

function shouldReconcileNotificationSchedule(keys: string[]): boolean {
  return keys.some(key => NOTIFICATION_SCHEDULE_SETTING_KEYS.has(key));
}

settingsRouter.use(requireAuth);

// API key management
settingsRouter.put('/api-key', async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) throw new AppError(400, 'MISSING_FIELDS', 'apiKey is required.');

    // Validate key first
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

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new AppError(400, 'INVALID_KEY', err?.error?.message ?? 'Invalid API key.');
    }

    const encrypted = encrypt(apiKey);
    await prisma.user.update({
      where: { id: req.userId! },
      data: { claudeApiKey: encrypted },
    });

    res.json({ success: true });
  } catch (e) { next(e); }
});

settingsRouter.delete('/api-key', async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.userId! },
      data: { claudeApiKey: null },
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

settingsRouter.get('/api-key/status', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { claudeApiKey: true },
    });
    res.json({ hasKey: !!user?.claudeApiKey });
  } catch (e) { next(e); }
});

// Usage status
settingsRouter.get('/usage-status', async (req, res, next) => {
  try {
    const centralAvailable = isCentralKeyAvailable();
    const preference = await getSetting(req.userId!, 'api_key_preference');
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { claudeApiKey: true },
    });
    const usage = await getUserMonthlyUsage(req.userId!);
    const globalUsage = centralAvailable ? await getGlobalCentralUsage() : 0;

    res.json({
      centralKeyAvailable: centralAvailable,
      preference: preference ?? (centralAvailable ? 'central' : 'own'),
      hasOwnKey: !!user?.claudeApiKey,
      userLimit: config.centralKeyUserMonthlyLimit,
      globalLimit: config.centralKeyGlobalMonthlyLimit,
      globalLimitReached: config.centralKeyGlobalMonthlyLimit > 0 && globalUsage >= config.centralKeyGlobalMonthlyLimit,
      usage,
    });
  } catch (e) { next(e); }
});

// Generic settings
settingsRouter.get('/', async (req, res, next) => {
  try {
    const settings = await getAllSettings(req.userId!);
    res.json({ settings });
  } catch (e) { next(e); }
});

settingsRouter.put('/', async (req, res, next) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new AppError(400, 'MISSING_FIELDS', 'settings object is required.');
    }

    const entries = Object.entries(settings);
    if (entries.some(([key, value]) => typeof key !== 'string' || typeof value !== 'string')) {
      throw new AppError(400, 'INVALID_SETTINGS', 'All setting values must be strings.');
    }

    const nextSettings = settings as Record<string, string>;
    await setSettings(req.userId!, nextSettings);
    if (shouldReconcileNotificationSchedule(Object.keys(nextSettings))) {
      await reconcileNotificationSchedule(req.userId!);
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

settingsRouter.get('/:key', async (req, res, next) => {
  try {
    const value = await getSetting(req.userId!, req.params.key);
    res.json({ value });
  } catch (e) { next(e); }
});

settingsRouter.put('/:key', async (req, res, next) => {
  try {
    const { value } = req.body;
    if (value === undefined) throw new AppError(400, 'MISSING_FIELDS', 'value is required.');
    await setSetting(req.userId!, req.params.key, value);
    if (shouldReconcileNotificationSchedule([req.params.key])) {
      await reconcileNotificationSchedule(req.userId!);
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});
