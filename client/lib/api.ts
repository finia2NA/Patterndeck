import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { getAuthToken, clearAuthToken, clearUserId, getBackendBaseUrl } from './storage';
import { analytics } from './analytics';
import { appSessionId } from './analytics';
import type { Card, TreeNode, DeckData, ChatMessage, CardAttempt, WordHint, AnalyticsContext } from './types';
import {
  areSettingsHydrated,
  getLocalSetting,
  getSettingsSnapshot,
  replaceLocalSettings,
  resetLocalSettings,
  setLocalSetting,
  type SettingsMap,
} from '@/hooks/state/persistent/settingsStore';

const ANDROID_EMULATOR_HOST = '10.0.2.2';
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function getAndroidDevHost(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    try {
      const url = new URL(/^https?:\/\//i.test(hostUri) ? hostUri : `http://${hostUri}`);
      if (url.hostname && !LOCALHOST_HOSTS.has(url.hostname.toLowerCase())) {
        return url.hostname;
      }
    } catch {
      // Fall back to the Android emulator host alias below.
    }
  }
  return ANDROID_EMULATOR_HOST;
}

export function resolveBackendBaseUrlForPlatform(baseUrl: string): string {
  if (Platform.OS !== 'android' || !__DEV__) return baseUrl;

  try {
    const url = new URL(baseUrl);
    if (LOCALHOST_HOSTS.has(url.hostname.toLowerCase())) {
      url.hostname = getAndroidDevHost();
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return baseUrl;
  }
}

function getConfiguredBaseUrl(): string {
  if (Platform.OS === 'web' && !__DEV__) {
    // Production web: same origin, nginx proxies /api → Express
    return '/api';
  }
  if (!__DEV__) {
    return Constants.expoConfig?.extra?.productionBackendBaseUrl ?? 'https://patterndeck.richardhanss.de/api';
  }
  // Dev (all platforms) and native prod: use configured host
  const host = Constants.expoConfig?.extra?.devServerHost ?? 'localhost';
  const port = Constants.expoConfig?.extra?.devServerPort ?? '3001';
  return resolveBackendBaseUrlForPlatform(`http://${host}:${port}/api`);
}

async function getBaseUrl(): Promise<string> {
  const override = await getBackendBaseUrl();
  return override ? resolveBackendBaseUrlForPlatform(override) : getConfiguredBaseUrl();
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function getHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  headers['X-App-Session-Id'] = appSessionId;
  return headers;
}

export class ApiError extends Error {
  constructor(message: string, public statusCode: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleHttpError(status: number, bodyJson: any): Promise<never> {
  if (status === 401) {
    await clearAuthToken();
    await clearUserId();
    analytics.reset();
    resetLocalSettings();
    router.replace('/onboarding');
    throw new ApiError('Session expired', 401, 'INVALID_TOKEN');
  }
  const message = bodyJson?.error?.message ?? `HTTP ${status}`;
  const code = bodyJson?.error?.code;
  throw new ApiError(message, status, code);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getHeaders();
  const baseUrl = await getBaseUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    await handleHttpError(res.status, body);
  }

  return res.json() as Promise<T>;
}

let settingsHydrationPromise: Promise<SettingsMap> | null = null;

export async function hydrateSettings(): Promise<SettingsMap> {
  const token = await getAuthToken();
  if (!token) return getSettingsSnapshot();
  if (areSettingsHydrated()) return getSettingsSnapshot();
  if (settingsHydrationPromise) return settingsHydrationPromise;

  settingsHydrationPromise = request<{ settings: SettingsMap }>('/settings')
    .then(({ settings }) => {
      replaceLocalSettings(settings, true);
      return getSettingsSnapshot();
    })
    .finally(() => {
      settingsHydrationPromise = null;
    });

  return settingsHydrationPromise;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function register(email: string, password: string) {
  return request<{ token: string; user: { id: string; email: string | null } }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function login(email: string, password: string) {
  return request<{ token: string; user: { id: string; email: string | null } }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function forgotPassword(email: string) {
  return request<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function validateResetToken(token: string) {
  return request<{ valid: boolean }>('/auth/validate-reset-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function resetPassword(token: string, newPassword: string) {
  return request<{ message: string }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function loginWithApple(identityToken: string) {
  return request<{ token: string; user: { id: string; email: string | null } }>('/auth/apple', {
    method: 'POST',
    body: JSON.stringify({ identityToken }),
  });
}

export async function loginWithGoogle(idToken: string) {
  return request<{ token: string; user: { id: string; email: string | null } }>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  });
}

export async function getMe() {
  return request<{ id: string; email: string | null; hasApiKey: boolean; centralKeyAvailable: boolean; authMethods: string[] }>('/auth/me');
}

export async function validateApiKey(apiKey: string) {
  return request<{ valid: boolean; error?: string }>('/auth/validate-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  });
}

// ─── API Key ──────────────────────────────────────────────────────────────────

export async function setApiKey(apiKey: string) {
  return request<{ success: boolean }>('/settings/api-key', {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  });
}

export async function deleteApiKey() {
  return request<{ success: boolean }>('/settings/api-key', { method: 'DELETE' });
}

export async function getApiKeyStatus() {
  return request<{ hasKey: boolean }>('/settings/api-key/status');
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

export interface TreeResponse {
  tree: TreeNode[];
  newDecksStartedToday: number;
}

export interface TreeHashResponse {
  hash: string;
}

export async function getTree(signal?: AbortSignal, hashOnly?: boolean) {
  const query = hashOnly ? '?hashOnly=true' : '';
  if (hashOnly) {
    return request<TreeHashResponse>('/tree' + query, { signal });
  }
  return request<TreeResponse>('/tree' + query, { signal });
}

export async function getNode(id: string) {
  return request<TreeNode>(`/tree/${id}`);
}

export async function getNodePath(id: string) {
  return request<{ path: string }>(`/tree/${id}/path`).then(r => r.path);
}

export async function getDescendantDeckIds(nodeId: string) {
  return request<{ deckIds: string[] }>(`/tree/${nodeId}/descendant-deck-ids`).then(r => r.deckIds);
}

export async function exportNodeCsv(nodeId: string) {
  return request<{ filename: string; csv: string }>(`/tree/${nodeId}/export-csv`);
}

export async function deleteNode(nodeId: string) {
  return request<{ success: boolean }>(`/nodes/${nodeId}`, { method: 'DELETE' });
}

// ─── Decks ────────────────────────────────────────────────────────────────────

export async function createDeckFromPath(
  path: string,
  topic: string,
  language: string,
  cardCount = 10,
  clarification?: string,
  explanation?: string,
) {
  return request<{ nodeId: string }>('/decks', {
    method: 'POST',
    body: JSON.stringify({ path, topic, clarification, language, cardCount, explanation }),
  }).then(r => r.nodeId);
}

export async function getDeck(nodeId: string) {
  return request<DeckData>(`/decks/${nodeId}`);
}

export async function updateDeck(nodeId: string, updates: { name?: string; topic?: string; clarification?: string; language?: string; cardCount?: number; explanation?: string }) {
  return request<{ regenerateExplanation: boolean }>(`/decks/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function resetDeckToNeverStudied(nodeId: string) {
  return request<{ success: boolean }>(`/decks/${nodeId}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'reset_never_studied' }),
  });
}

export async function setDeckDueDate(nodeId: string, dueDate: string) {
  const clientTimezone = getDeviceTimezone();
  return request<{ success: boolean }>(`/decks/${nodeId}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'set_due_date', dueDate, clientTimezone }),
  });
}

export async function markStudied(nodeId: string) {
  return request<{ success: boolean }>(`/decks/${nodeId}/mark-studied`, { method: 'POST' });
}

export interface CsvImportResult {
  createdCount: number;
  queuedCount: number;
  failedCount: number;
  failures: Array<{ line: number; context: string; error: string }>;
}

export async function importDecksFromCsv(
  csvContent: string,
  collectionPath: string,
  language: string,
  cardCount: number,
): Promise<CsvImportResult> {
  const token = await getAuthToken();
  const baseUrl = await getBaseUrl();
  const formData = new FormData();
  formData.append('file', new Blob([csvContent], { type: 'text/csv' }), 'import.csv');
  formData.append('collectionPath', collectionPath);
  formData.append('language', language);
  formData.append('cardCount', String(cardCount));

  const res = await fetch(`${baseUrl}/decks/import-csv`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-App-Session-Id': appSessionId,
    },
    body: formData,
  });

  if (!res.ok) {
    if (res.status === 401) {
      await clearAuthToken();
      await clearUserId();
      analytics.reset();
      router.replace('/onboarding');
      throw new ApiError('Session expired', 401, 'INVALID_TOKEN');
    }
    const body = await res.json().catch(() => ({})) as any;
    const message = body?.error?.message ?? `HTTP ${res.status}`;
    const code = body?.error?.code;
    throw new ApiError(message, res.status, code);
  }

  return res.json() as Promise<CsvImportResult>;
}

// ─── Collections ──────────────────────────────────────────────────────────────

export async function renameCollection(nodeId: string, name: string) {
  return request<{ success: boolean }>(`/collections/${nodeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function moveNode(nodeId: string, newPath: string) {
  return request<{ success: boolean }>(`/nodes/${nodeId}/move`, {
    method: 'POST',
    body: JSON.stringify({ newPath }),
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(key: string) {
  if (!areSettingsHydrated()) {
    await hydrateSettings().catch(() => {});
  }
  return getLocalSetting(key);
}

export async function setSetting(key: string, value: string) {
  setLocalSetting(key, value);
  return request<{ success: boolean }>(`/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function saveSettings(settings: SettingsMap) {
  const result = await request<{ success: boolean }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
  replaceLocalSettings(settings, true);
  return result;
}

function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz.trim().length > 0) return tz;
  } catch {}
  return 'UTC';
}

export async function syncReviewTimezone() {
  const tz = getDeviceTimezone();
  await setSetting('review_timezone', tz);
  return tz;
}

export async function getEnabledLanguages(defaultLanguages: string[]): Promise<string[]> {
  if (!areSettingsHydrated()) {
    await hydrateSettings().catch(() => {});
  }
  return parseEnabledLanguages(getLocalSetting('enabled_languages'), defaultLanguages);
}

export async function setEnabledLanguages(langs: string[]): Promise<void> {
  await setSetting('enabled_languages', JSON.stringify(langs));
}

export function parseEnabledLanguages(raw: string | null, defaultLanguages: string[]): string[] {
  if (!raw) return defaultLanguages;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.filter(lang => typeof lang === 'string');
  } catch {}
  return defaultLanguages;
}

export interface UsageStatus {
  centralKeyAvailable: boolean;
  preference: 'central' | 'own';
  hasOwnKey: boolean;
  userLimit: number;
  globalLimit: number;
  globalLimitReached: boolean;
  usage: { central: number; own: number };
}

export async function getUsageStatus() {
  return request<UsageStatus>('/settings/usage-status');
}

// ─── Notifications ───────────────────────────────────────────────────────────

export async function registerPushDevice(expoPushToken: string, platform: string) {
  return request<{ success: boolean }>('/notifications/register', {
    method: 'POST',
    body: JSON.stringify({ expoPushToken, platform }),
  });
}

export async function unregisterPushDevice(expoPushToken?: string) {
  return request<{ success: boolean }>('/notifications/unregister', {
    method: 'POST',
    body: JSON.stringify(expoPushToken ? { expoPushToken } : {}),
  });
}

// ─── AI (non-streaming) ──────────────────────────────────────────────────────

export async function generateCards(topic: string, language: string, count: number, explanation: string, analyticsContext?: AnalyticsContext) {
  return request<{ cards: Card[]; cost: number }>('/ai/cards', {
    method: 'POST',
    body: JSON.stringify({ topic, language, count, explanation, analyticsContext }),
  });
}

export async function judgeAnswer(card: Card, userAnswer: string, language: string, explanation?: string, brevity?: 'brief' | 'normal', analyticsContext?: AnalyticsContext) {
  return request<{ correct: boolean; reason: string; cost: number }>('/ai/judge', {
    method: 'POST',
    body: JSON.stringify({ card, userAnswer, language, explanation, brevity, analyticsContext }),
  });
}

export async function rateSession(topic: string, language: string, cards: CardAttempt[], analyticsContext?: AnalyticsContext) {
  const payload = cards.map(a => ({
    english: a.card.english,
    targetLanguage: a.card.targetLanguage,
    answers: a.answers,
  }));
  return request<{ stars: number; recap: string; cost: number }>('/ai/rate-session', {
    method: 'POST',
    body: JSON.stringify({ topic, language, cards: payload, analyticsContext }),
  });
}

export async function submitDeckReview(
  nodeId: string,
  userStars: number,
  aiStars: number,
  aiRecap: string,
  studyMode: 'scheduled' | 'early' = 'scheduled',
  studySessionId?: string,
  correctCount?: number,
  totalCount?: number,
) {
  return request<{ dueAt: number; nextIntervalDays: number }>(`/decks/${nodeId}/review`, {
    method: 'POST',
    body: JSON.stringify({ userStars, aiStars, aiRecap, studyMode, studySessionId, correctCount, totalCount }),
  });
}

// ─── Review History ─────────────────────────────────────────────────────────

export interface DeckReviewRecord {
  id: string;
  deckId: string;
  studiedAt: string;
  eventType: string;
  aiStars: number;
  userStars: number;
  aiRecap: string;
  intervalApplied: number;
  correctCount: number | null;
  totalCount: number | null;
}

export interface CollectionReviewRecord extends DeckReviewRecord {
  deckName: string;
}

export async function getDeckReviews(nodeId: string) {
  return request<{ reviews: DeckReviewRecord[] }>(`/decks/${nodeId}/reviews`);
}

export async function getCollectionReviews(nodeId: string) {
  return request<{ decks: { id: string; name: string }[]; reviews: CollectionReviewRecord[] }>(`/tree/${nodeId}/reviews`);
}

// ─── AI (streaming via SSE) ──────────────────────────────────────────────────

function parseSSEBuffer(
  buffer: string,
  onChunk: (text: string) => void,
  onCost: ((usd: number) => void) | undefined,
  wasTruncated: { value: boolean },
): string {
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) continue;
    try {
      const ev = JSON.parse(jsonStr);
      if (ev.type === 'text') {
        onChunk(ev.text);
      } else if (ev.type === 'done') {
        if (ev.cost) onCost?.(ev.cost);
        if (ev.wasTruncated) wasTruncated.value = true;
      } else if (ev.type === 'error') {
        throw new Error(ev.message);
      }
    } catch (e) {
      if (e instanceof Error && e.message !== 'Unknown error') throw e;
    }
  }
  return remaining;
}

async function streamSSE(
  path: string,
  body: object,
  onChunk: (text: string) => void,
  onCost?: (usd: number) => void,
): Promise<{ wasTruncated?: boolean }> {
  const headers = await getHeaders();
  const baseUrl = await getBaseUrl();
  const url = `${baseUrl}${path}`;
  const wasTruncated = { value: false };

  // Web supports ReadableStream; native (iOS/Android) does not expose res.body reliably.
  if (Platform.OS === 'web') {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      await handleHttpError(res.status, err);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSSEBuffer(buffer, onChunk, onCost, wasTruncated);
    }
  } else {
    // XHR onprogress gives us incremental responseText on native.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      let cursor = 0;
      let buffer = '';
      xhr.onprogress = () => {
        const newText = xhr.responseText.slice(cursor);
        cursor = xhr.responseText.length;
        buffer += newText;
        try {
          buffer = parseSSEBuffer(buffer, onChunk, onCost, wasTruncated);
        } catch (e) {
          reject(e);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 400) {
          let err: any = {};
          try { err = JSON.parse(xhr.responseText); } catch {}
          handleHttpError(xhr.status, err).catch(reject);
          return;
        }
        resolve();
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(JSON.stringify(body));
    });
  }

  return { wasTruncated: wasTruncated.value };
}

export async function generateExplanation(
  topic: string,
  language: string,
  onChunk: (text: string) => void,
  onCost?: (usd: number) => void,
  analyticsContext?: AnalyticsContext,
): Promise<{ wasTruncated: boolean }> {
  const result = await streamSSE('/ai/explanation/stream', { topic, language, analyticsContext }, onChunk, onCost);
  return { wasTruncated: result.wasTruncated ?? false };
}

export async function explainRejection(card: Card, userAnswer: string, language: string, explanation?: string, brevity?: 'brief' | 'normal', analyticsContext?: AnalyticsContext) {
  return request<{ explanation: string; overrideToCorrect: boolean; cost: number }>('/ai/rejection', {
    method: 'POST',
    body: JSON.stringify({ card, userAnswer, language, explanation, brevity, analyticsContext }),
  });
}

export async function explainSentence(card: Card, language: string, explanation?: string, analyticsContext?: AnalyticsContext) {
  return request<{ explanation: string; cost: number }>('/ai/explain-sentence', {
    method: 'POST',
    body: JSON.stringify({ card, language, explanation, analyticsContext }),
  });
}

export async function wordHint(
  word: string,
  english: string,
  targetLanguage: string,
  language: string,
  analyticsContext?: AnalyticsContext,
): Promise<WordHint & { cost: number }> {
  return request('/ai/word-hint', {
    method: 'POST',
    body: JSON.stringify({ word, english, targetLanguage, language, analyticsContext }),
  });
}

export async function chatAboutCard(
  card: Card,
  userAnswer: string,
  language: string,
  wasCorrect: boolean,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onCost?: (usd: number) => void,
  explanation?: string,
  analyticsContext?: AnalyticsContext,
): Promise<void> {
  await streamSSE('/ai/chat/stream', { card, userAnswer, language, wasCorrect, messages, explanation, analyticsContext }, onChunk, onCost);
}
