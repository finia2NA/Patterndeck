import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../crypto.service.js';
import { getSetting } from '../settings.service.js';
import { recordUsage, canUseCentralKey } from '../usage.service.js';
import { config, isCentralKeyAvailable } from '../../config.js';
import { AppError } from '../../middleware/errorHandler.js';
import { capture, captureAiGeneration, captureException, type AiAnalyticsContext } from '../analytics.service.js';
import type { PromptWithTool } from '../../constants/prompts.js';
import { UI_LOCALE_LANGUAGE_NAMES, isUiLocale } from '@patterndeck/shared';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
export const SONNET = 'claude-sonnet-4-6';
export const HAIKU = 'claude-haiku-4-5-20251001';

const PRICE: Record<string, { input: number; output: number }> = {
  [SONNET]: { input: 3.00, output: 15.00 },
  [HAIKU]: { input: 0.80, output: 4.00 },
};

export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE[model] ?? { input: 3.00, output: 15.00 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error) return error.name;
  return undefined;
}

export function defaultTraceId(endpoint: string, context?: AiAnalyticsContext): string {
  if (context?.traceId) return context.traceId;
  if (context?.studySessionId && context.deckId) return `${endpoint}:${context.studySessionId}:${context.deckId}`;
  if (context?.studySessionId) return `${endpoint}:${context.studySessionId}`;
  if (context?.deckId) return `${endpoint}:${context.deckId}`;
  return `${endpoint}:${crypto.randomUUID()}`;
}

interface AiCallAnalytics {
  userId: string;
  source: 'central' | 'own';
  endpoint: string;
  context?: AiAnalyticsContext;
}

export async function resolveResponseLanguage(userId: string): Promise<string> {
  const locale = await getSetting(userId, 'ui_language');
  return locale !== null && isUiLocale(locale) ? UI_LOCALE_LANGUAGE_NAMES[locale] : 'English';
}

export async function resolveApiKey(userId: string): Promise<{ apiKey: string; source: 'central' | 'own' }> {
  const preference = await getSetting(userId, 'api_key_preference');
  const centralAvailable = isCentralKeyAvailable();
  const effectivePref = preference ?? (centralAvailable ? 'central' : 'own');

  if (effectivePref === 'central' && centralAvailable) {
    const check = await canUseCentralKey(userId);
    if (check.allowed) {
      return { apiKey: config.centralApiKey!, source: 'central' };
    }
    throw new AppError(429, 'USAGE_LIMIT', check.reason ?? 'Usage limit reached. Please provide your own API key in settings to continue using AI features.');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { claudeApiKey: true },
  });

  if (user?.claudeApiKey) {
    return { apiKey: decrypt(user.claudeApiKey), source: 'own' };
  }

  if (centralAvailable) {
    const check = await canUseCentralKey(userId);
    if (check.allowed) {
      return { apiKey: config.centralApiKey!, source: 'central' };
    }
    throw new AppError(429, 'USAGE_LIMIT', check.reason ?? 'Usage limit reached.');
  }

  throw new AppError(400, 'NO_API_KEY', 'No API key available. Please add one in settings.');
}

export function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

export async function callTextStream(
  apiKey: string,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  analytics?: AiCallAnalytics,
): Promise<{ wasTruncated: boolean; cost: number; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const startedAt = Date.now();
  let buffer = '';
  const state = { inputTokens: 0, outputTokens: 0, wasTruncated: false };

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({ model, max_tokens: maxTokens, system, stream: true, messages }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const ev = JSON.parse(jsonStr);
          if (ev.type === 'message_start') {
            state.inputTokens = ev.message?.usage?.input_tokens ?? 0;
          } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            onChunk(ev.delta.text);
          } else if (ev.type === 'message_delta') {
            state.outputTokens = ev.usage?.output_tokens ?? state.outputTokens;
            if (ev.delta?.stop_reason === 'max_tokens') state.wasTruncated = true;
          }
        } catch { /* malformed event */ }
      }
    }
    reader.cancel().catch(() => { });

    const latencyMs = Date.now() - startedAt;
    const cost = calcCost(model, state.inputTokens, state.outputTokens);
    if (analytics) {
      captureAiGeneration(analytics.userId, {
        ...analytics.context,
        endpoint: analytics.endpoint,
        traceId: defaultTraceId(analytics.endpoint, analytics.context),
        model,
        source: analytics.source,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cost,
        latencyMs,
        success: true,
        stream: true,
      });
    }

    return {
      wasTruncated: state.wasTruncated,
      cost,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      latencyMs,
    };
  } catch (error) {
    if (analytics && errorCode(error) !== 'AbortError') {
      captureAiGeneration(analytics.userId, {
        ...analytics.context,
        endpoint: analytics.endpoint,
        traceId: defaultTraceId(analytics.endpoint, analytics.context),
        model,
        source: analytics.source,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cost: calcCost(model, state.inputTokens, state.outputTokens),
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
        stream: true,
      });
      captureException(error, analytics.userId, {
        endpoint: analytics.endpoint,
        model,
        study_session_id: analytics.context?.studySessionId,
        deck_id: analytics.context?.deckId,
      });
      capture(analytics.userId, 'ai_request_failed', {
        endpoint: analytics.endpoint,
        model,
        error_code: errorCode(error),
        study_session_id: analytics.context?.studySessionId,
        deck_id: analytics.context?.deckId,
      });
    }
    throw error;
  }
}

export async function callTool<T>(
  apiKey: string,
  model: string,
  prompt: PromptWithTool,
  userMessage: string,
  maxTokens: number,
  analytics?: AiCallAnalytics,
): Promise<{ result: T; cost: number; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: prompt.system,
        tools: [{ name: prompt.tool.name, description: prompt.tool.description, input_schema: prompt.tool.inputSchema }],
        tool_choice: { type: 'tool', name: prompt.tool.name },
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
    }

    const data = await res.json() as { usage?: { input_tokens?: number; output_tokens?: number }; content: { type: string; input?: unknown }[] };
    inputTokens = data.usage?.input_tokens ?? 0;
    outputTokens = data.usage?.output_tokens ?? 0;
    const cost = calcCost(model, inputTokens, outputTokens);
    const latencyMs = Date.now() - startedAt;
    const toolUse = data.content.find((b) => b.type === 'tool_use');
    if (!toolUse) throw new Error('No tool_use block in Claude response');

    if (analytics) {
      captureAiGeneration(analytics.userId, {
        ...analytics.context,
        endpoint: analytics.endpoint,
        traceId: defaultTraceId(analytics.endpoint, analytics.context),
        model,
        source: analytics.source,
        inputTokens,
        outputTokens,
        cost,
        latencyMs,
        success: true,
        stream: false,
      });
    }

    return { result: toolUse.input as T, cost, inputTokens, outputTokens, latencyMs };
  } catch (error) {
    if (analytics) {
      captureAiGeneration(analytics.userId, {
        ...analytics.context,
        endpoint: analytics.endpoint,
        traceId: defaultTraceId(analytics.endpoint, analytics.context),
        model,
        source: analytics.source,
        inputTokens,
        outputTokens,
        cost: calcCost(model, inputTokens, outputTokens),
        latencyMs: Date.now() - startedAt,
        success: false,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
        stream: false,
      });
      captureException(error, analytics.userId, {
        endpoint: analytics.endpoint,
        model,
        study_session_id: analytics.context?.studySessionId,
        deck_id: analytics.context?.deckId,
      });
      capture(analytics.userId, 'ai_request_failed', {
        endpoint: analytics.endpoint,
        model,
        error_code: errorCode(error),
        study_session_id: analytics.context?.studySessionId,
        deck_id: analytics.context?.deckId,
      });
    }
    throw error;
  }
}

export { recordUsage };
