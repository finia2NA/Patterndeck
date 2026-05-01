import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { getAllSettings } from './settings.service.js';
import {
  buildSrsConfig,
  getCurrentStudyDayKey,
  getZonedParts,
  isDueNow,
  resolveDueAt,
  zonedDateTimeToUtc,
} from './srs.service.js';

const NOTIFICATIONS_ENABLED_KEY = 'notifications_enabled';
const NOTIFICATION_TIME_KEY = 'notification_time';
const DEFAULT_NOTIFICATION_TIME = '09:00';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_CHUNK_SIZE = 100;

type PlatformName = 'ios' | 'android' | 'unknown';

interface NotificationScheduleInput {
  notificationTime: string;
  timezone: string;
  scheduledFor: Date;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  channelId: string;
  data: Record<string, string | number | boolean>;
}

interface ExpoPushTicket {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerRunning = false;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function normalizeNotificationTime(value: string | null | undefined): string {
  const raw = value && value.trim().length > 0 ? value.trim() : DEFAULT_NOTIFICATION_TIME;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return DEFAULT_NOTIFICATION_TIME;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return DEFAULT_NOTIFICATION_TIME;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return DEFAULT_NOTIFICATION_TIME;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function normalizePlatform(value: unknown): PlatformName {
  if (value === 'ios' || value === 'android') return value;
  return 'unknown';
}

function parseTimeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = normalizeNotificationTime(value).split(':').map(Number);
  return { hour, minute };
}

function addLocalDays(parts: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function normalizeTimezone(value: string | null | undefined): string {
  return buildSrsConfig(null, value).reviewTimezone;
}

export function computeNextNotificationSchedule(
  notificationTimeRaw: string | null | undefined,
  timezoneRaw: string | null | undefined,
  after = new Date(),
): NotificationScheduleInput {
  const notificationTime = normalizeNotificationTime(notificationTimeRaw);
  const timezone = normalizeTimezone(timezoneRaw);
  const { hour, minute } = parseTimeParts(notificationTime);
  const localToday = getZonedParts(after, timezone);

  let targetDate = {
    year: localToday.year,
    month: localToday.month,
    day: localToday.day,
  };
  let scheduledFor = zonedDateTimeToUtc(targetDate.year, targetDate.month, targetDate.day, hour, minute, timezone);

  if (scheduledFor.getTime() <= after.getTime()) {
    targetDate = addLocalDays(targetDate, 1);
    scheduledFor = zonedDateTimeToUtc(targetDate.year, targetDate.month, targetDate.day, hour, minute, timezone);
  }

  return { notificationTime, timezone, scheduledFor };
}

function computeNextNotificationScheduleAfterLocalDay(
  notificationTime: string,
  timezone: string,
  previousScheduledFor: Date,
  after: Date,
): NotificationScheduleInput {
  const { hour, minute } = parseTimeParts(notificationTime);
  const previousLocal = getZonedParts(previousScheduledFor, timezone);
  let daysToAdd = 1;
  let nextDate = addLocalDays(previousLocal, daysToAdd);
  let scheduledFor = zonedDateTimeToUtc(nextDate.year, nextDate.month, nextDate.day, hour, minute, timezone);

  while (scheduledFor.getTime() <= after.getTime()) {
    daysToAdd += 1;
    nextDate = addLocalDays(previousLocal, daysToAdd);
    scheduledFor = zonedDateTimeToUtc(nextDate.year, nextDate.month, nextDate.day, hour, minute, timezone);
  }

  return { notificationTime, timezone, scheduledFor };
}

async function upsertSchedule(userId: string, schedule: NotificationScheduleInput): Promise<void> {
  await prisma.notificationSchedule.upsert({
    where: { userId },
    update: {
      scheduledFor: schedule.scheduledFor,
      notificationTime: schedule.notificationTime,
      timezone: schedule.timezone,
    },
    create: {
      userId,
      scheduledFor: schedule.scheduledFor,
      notificationTime: schedule.notificationTime,
      timezone: schedule.timezone,
    },
  });
}

async function deleteSchedule(userId: string): Promise<void> {
  await prisma.notificationSchedule.deleteMany({ where: { userId } });
}

async function getActiveDeviceCount(userId: string): Promise<number> {
  return prisma.pushDevice.count({ where: { userId, disabledAt: null } });
}

export async function reconcileNotificationSchedule(userId: string): Promise<void> {
  const [settings, activeDeviceCount] = await Promise.all([
    getAllSettings(userId),
    getActiveDeviceCount(userId),
  ]);

  if (settings[NOTIFICATIONS_ENABLED_KEY] !== 'on' || activeDeviceCount === 0) {
    await deleteSchedule(userId);
    return;
  }

  const schedule = computeNextNotificationSchedule(
    settings[NOTIFICATION_TIME_KEY],
    settings.review_timezone,
  );
  await upsertSchedule(userId, schedule);
}

export async function registerPushDevice(
  userId: string,
  expoPushToken: string,
  platformRaw: unknown,
): Promise<void> {
  const token = expoPushToken.trim();
  if (!isPlausibleExpoPushToken(token)) {
    throw new AppError(400, 'INVALID_PUSH_TOKEN', 'Invalid Expo push token.');
  }

  await prisma.pushDevice.upsert({
    where: { expoPushToken: token },
    update: {
      userId,
      platform: normalizePlatform(platformRaw),
      disabledAt: null,
      lastError: null,
    },
    create: {
      userId,
      expoPushToken: token,
      platform: normalizePlatform(platformRaw),
    },
  });
  await reconcileNotificationSchedule(userId);
}

export async function unregisterPushDevice(userId: string, expoPushToken?: string): Promise<void> {
  if (expoPushToken?.trim()) {
    await prisma.pushDevice.updateMany({
      where: { userId, expoPushToken: expoPushToken.trim() },
      data: { disabledAt: new Date(), lastError: 'unregistered' },
    });
  } else {
    await prisma.pushDevice.updateMany({
      where: { userId, disabledAt: null },
      data: { disabledAt: new Date(), lastError: 'unregistered' },
    });
  }
  await reconcileNotificationSchedule(userId);
}

export async function initializeNotificationScheduling(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      settings: { some: { key: NOTIFICATIONS_ENABLED_KEY, value: 'on' } },
      pushDevices: { some: { disabledAt: null } },
    },
    select: { id: true },
  });

  await Promise.all(users.map(user => reconcileNotificationSchedule(user.id)));
  if (users.length > 0) {
    console.log(`[notifications] Reconciled ${users.length} notification schedule(s)`);
  }
}

export function startNotificationWorker(): void {
  if (workerTimer) return;

  workerTimer = setInterval(() => {
    processDueNotificationSchedules().catch(err => {
      console.error('[notifications] Worker failed:', err);
    });
  }, 60_000);

  processDueNotificationSchedules().catch(err => {
    console.error('[notifications] Initial worker pass failed:', err);
  });
}

export function stopNotificationWorker(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}

export async function processDueNotificationSchedules(now = new Date()): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;

  try {
    const dueSchedules = await prisma.notificationSchedule.findMany({
      where: { scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
    });

    for (const schedule of dueSchedules) {
      await processNotificationSchedule(schedule.userId, schedule.notificationTime, schedule.timezone, schedule.scheduledFor, now);
    }
  } finally {
    workerRunning = false;
  }
}

async function processNotificationSchedule(
  userId: string,
  scheduledNotificationTime: string,
  scheduledTimezone: string,
  scheduledFor: Date,
  now: Date,
): Promise<void> {
  const [settings, activeDevices] = await Promise.all([
    getAllSettings(userId),
    prisma.pushDevice.findMany({
      where: { userId, disabledAt: null },
      select: { id: true, expoPushToken: true },
    }),
  ]);

  if (settings[NOTIFICATIONS_ENABLED_KEY] !== 'on' || activeDevices.length === 0) {
    await deleteSchedule(userId);
    return;
  }

  const currentTime = normalizeNotificationTime(settings[NOTIFICATION_TIME_KEY]);
  const currentTimezone = normalizeTimezone(settings.review_timezone);
  if (currentTime !== scheduledNotificationTime || currentTimezone !== scheduledTimezone) {
    await upsertSchedule(userId, computeNextNotificationSchedule(currentTime, currentTimezone, now));
    return;
  }

  const nextSchedule = computeNextNotificationScheduleAfterLocalDay(currentTime, currentTimezone, scheduledFor, now);
  await upsertSchedule(userId, nextSchedule);

  const srsConfig = buildSrsConfig(settings.daily_due_time, settings.review_timezone);
  const dueDeckCount = await countStudyableDueDecks(userId, srsConfig, now);
  if (dueDeckCount === 0) return;

  const studyDayKey = getCurrentStudyDayKey(srsConfig, now);
  const reserved = await reserveNotificationDelivery(userId, studyDayKey, dueDeckCount);
  if (!reserved) return;

  await sendDueDeckPushes(userId, activeDevices, dueDeckCount, studyDayKey);
}

async function countStudyableDueDecks(
  userId: string,
  srsConfig: { dailyDueTime: string; reviewTimezone: string },
  now: Date,
): Promise<number> {
  const decks = await prisma.deck.findMany({
    where: {
      node: { userId },
      dueAt: { not: null },
      explanationStatus: 'ready',
    },
    select: { dueAt: true },
  });

  return decks.filter(deck => isDueNow(resolveDueAt(deck.dueAt), srsConfig, now)).length;
}

async function reserveNotificationDelivery(
  userId: string,
  studyDayKey: string,
  dueDeckCount: number,
): Promise<boolean> {
  try {
    await prisma.notificationDelivery.create({
      data: { userId, studyDayKey, dueDeckCount },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return false;
    }
    throw e;
  }
}

async function sendDueDeckPushes(
  userId: string,
  devices: Array<{ id: string; expoPushToken: string }>,
  dueDeckCount: number,
  studyDayKey: string,
): Promise<void> {
  const body = dueDeckCount === 1
    ? 'You have 1 deck ready to review.'
    : `You have ${dueDeckCount} decks ready to review.`;

  const messages: ExpoPushMessage[] = devices.map(device => ({
    to: device.expoPushToken,
    title: 'Decks are due',
    body,
    sound: 'default',
    channelId: 'due-decks',
    data: {
      type: 'due_decks',
      dueDeckCount,
      studyDayKey,
    },
  }));

  for (let i = 0; i < messages.length; i += PUSH_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + PUSH_CHUNK_SIZE);
    const deviceChunk = devices.slice(i, i + PUSH_CHUNK_SIZE);
    const tickets = await sendExpoPushChunk(chunk);
    await handleExpoPushTickets(userId, deviceChunk, tickets);
  }
}

async function sendExpoPushChunk(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  const json = await response.json().catch(() => ({})) as { data?: ExpoPushTicket[]; errors?: unknown };
  if (!response.ok) {
    throw new Error(`Expo push request failed with HTTP ${response.status}`);
  }
  return Array.isArray(json.data) ? json.data : [];
}

async function handleExpoPushTickets(
  userId: string,
  devices: Array<{ id: string; expoPushToken: string }>,
  tickets: ExpoPushTicket[],
): Promise<void> {
  const permanentErrors = new Set(['DeviceNotRegistered', 'InvalidPushToken']);

  await Promise.all(tickets.map((ticket, index) => {
    if (ticket.status !== 'error') return Promise.resolve();
    const errorCode = ticket.details?.error ?? ticket.message ?? 'push_error';
    if (!permanentErrors.has(errorCode)) return Promise.resolve();

    const device = devices[index];
    if (!device) return Promise.resolve();
    return prisma.pushDevice.updateMany({
      where: { id: device.id, userId },
      data: { disabledAt: new Date(), lastError: errorCode },
    });
  }));
}

function isPlausibleExpoPushToken(value: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(value);
}
