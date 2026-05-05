export type StudyMode = 'scheduled' | 'early';

export interface SrsConfig {
  dailyDueTime: string;
  reviewTimezone: string;
}

export interface ReviewSchedule {
  nextIntervalDays: number;
  dueAt: Date;
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_DAILY_DUE_TIME = '01:00';

const SCHEDULED_MULTIPLIERS: Record<number, number | null> = {
  1: null,
  2: 0.25,
  3: 0.75,
  4: 1.5,
  5: 2.0,
};

const EARLY_MULTIPLIERS: Record<number, number | null> = {
  1: null,
  2: 0.25,
  3: 0.75,
  4: 1,
  5: 1,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDayKeyUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDayKey(dayKey: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function dayKeyToEpochDay(dayKey: string): number {
  const parsed = parseDayKey(dayKey);
  if (!parsed) return 0;
  return Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / MS_PER_DAY);
}

function addDaysToDayKey(dayKey: string, days: number): string {
  const parsed = parseDayKey(dayKey);
  if (!parsed) return dayKey;
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * MS_PER_DAY);
  return formatDayKeyUtc(next);
}

function normalizeTimezone(value: string | null | undefined): string {
  const candidate = value && value.trim().length > 0 ? value.trim() : 'UTC';
  try {
    // Throws RangeError for invalid timezone names.
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

function parseDailyDueTime(value: string | null | undefined): { hour: number; minute: number } {
  const raw = value && value.trim().length > 0 ? value.trim() : DEFAULT_DAILY_DUE_TIME;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return { hour: 1, minute: 0 };

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return { hour: 1, minute: 0 };
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 1, minute: 0 };
  return { hour, minute };
}

function dueCutoffMinutes(config: SrsConfig): number {
  const { hour, minute } = parseDailyDueTime(config.dailyDueTime);
  return hour * 60 + minute;
}

export function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = getFormatter(timeZone).formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;

  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    if (part.type === 'month') month = Number(part.value);
    if (part.type === 'day') day = Number(part.value);
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }

  return { year, month, day, hour, minute };
}

function studyDayKeyFromParts(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  cutoffMinutes: number,
): string {
  let dayStartMs = Date.UTC(parts.year, parts.month - 1, parts.day);
  const localMinutes = parts.hour * 60 + parts.minute;
  if (localMinutes < cutoffMinutes) {
    dayStartMs -= MS_PER_DAY;
  }
  return formatDayKeyUtc(new Date(dayStartMs));
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Iteratively refine UTC guess until projected zoned time matches requested local wall-clock.
  let guessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let i = 0; i < 4; i++) {
    const projected = getZonedParts(new Date(guessMs), timeZone);
    const desiredAnchor = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const projectedAnchor = Date.UTC(projected.year, projected.month - 1, projected.day, projected.hour, projected.minute, 0, 0);
    const diffMinutes = Math.round((desiredAnchor - projectedAnchor) / 60_000);
    if (diffMinutes === 0) break;
    guessMs += diffMinutes * 60_000;
  }

  return new Date(guessMs);
}

export function buildSrsConfig(dailyDueTime: string | null | undefined, reviewTimezone: string | null | undefined): SrsConfig {
  const parsedTime = parseDailyDueTime(dailyDueTime);
  return {
    dailyDueTime: `${pad2(parsedTime.hour)}:${pad2(parsedTime.minute)}`,
    reviewTimezone: normalizeTimezone(reviewTimezone),
  };
}

export function getCurrentStudyDayKey(config: SrsConfig, now = new Date()): string {
  const parts = getZonedParts(now, config.reviewTimezone);
  return studyDayKeyFromParts(parts, dueCutoffMinutes(config));
}

export function getCalendarDayKey(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function dueDateStringToDueAt(dueDate: string, config: SrsConfig): Date | null {
  const parsed = parseDayKey(dueDate);
  if (!parsed) return null;
  const dueTime = parseDailyDueTime(config.dailyDueTime);
  return zonedDateTimeToUtc(parsed.year, parsed.month, parsed.day, dueTime.hour, dueTime.minute, config.reviewTimezone);
}

export function computeIntervalDaysForDueDate(dueDate: string, config: SrsConfig, now = new Date()): number {
  const target = parseDayKey(dueDate);
  if (!target) return 1;
  const todayKey = getCurrentStudyDayKey(config, now);
  const todayEpoch = dayKeyToEpochDay(todayKey);
  const targetEpoch = dayKeyToEpochDay(dueDate);
  return Math.max(1, targetEpoch - todayEpoch);
}

export function resolveDueAt(dueAt: Date | null): number | null {
  return dueAt !== null ? dueAt.getTime() : null;
}

export function isDueNow(
  dueAtMs: number | null,
  config: SrsConfig,
  now = new Date(),
): boolean {
  if (dueAtMs === null) return false;

  const nowKey = getCurrentStudyDayKey(config, now);
  const dueKey = getCurrentStudyDayKey(config, new Date(dueAtMs));
  return dueKey <= nowKey;
}

/**
 * Calculate the next review date based on star rating and current interval.
 * Due timestamps are snapped to the user's daily due-release time.
 */
export function calculateNextReview(
  stars: 1 | 2 | 3 | 4 | 5,
  currentIntervalDays: number,
  opts: {
    studyMode: StudyMode;
    config: SrsConfig;
    now?: Date;
    forceEarlyMultipliers?: boolean;
  },
): ReviewSchedule {
  const now = opts.now ?? new Date();
  const multipliers = (opts.studyMode === 'early' || opts.forceEarlyMultipliers)
    ? EARLY_MULTIPLIERS
    : SCHEDULED_MULTIPLIERS;

  const mult = multipliers[stars];
  const nextDays = mult === null ? 1 : Math.max(1, currentIntervalDays * mult);
  const dueInStudyDays = Math.max(1, Math.ceil(nextDays));

  const todayKey = getCurrentStudyDayKey(opts.config, now);
  const targetDayKey = addDaysToDayKey(todayKey, dueInStudyDays);
  const targetDueAt = dueDateStringToDueAt(targetDayKey, opts.config);

  return {
    nextIntervalDays: nextDays,
    dueAt: targetDueAt ?? new Date(now.getTime() + dueInStudyDays * MS_PER_DAY),
  };
}
