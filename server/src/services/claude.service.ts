import type { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { decrypt } from './crypto.service.js';
import { setExplanation, setExplanationError, setExplanationGenerating } from './deck.service.js';
import { getSetting } from './settings.service.js';
import { recordUsage, canUseCentralKey } from './usage.service.js';
import { config, isCentralKeyAvailable } from '../config.js';
import { sseHeaders, sendChunk, sendDone, sendError } from '../lib/sse.js';
import { AppError } from '../middleware/errorHandler.js';
import { capture, captureAiGeneration, captureException, type AiAnalyticsContext } from './analytics.service.js';
import {
  EXPLANATION_PROMPT,
  CARD_GEN_PROMPT,
  JUDGMENT_PROMPT,
  REJECTION_PROMPT,
  SESSION_RATING_PROMPT,
  SENTENCE_REVEAL_PROMPT,
  WORD_HINT_PROMPT,
  type PromptWithTool,
} from '../constants/prompts.js';
import type { Card } from '../types/index.js';
import { DEBUG_AI } from '../routes/claude-proxy.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const SONNET = 'claude-sonnet-4-6';
const HAIKU = 'claude-haiku-4-5-20251001';

const PRICE: Record<string, { input: number; output: number }> = {
  [SONNET]: { input: 3.00, output: 15.00 },
  [HAIKU]: { input: 0.80, output: 4.00 },
};

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICE[model] ?? { input: 3.00, output: 15.00 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof AppError) return error.code;
  if (error instanceof Error) return error.name;
  return undefined;
}

function defaultTraceId(endpoint: string, context?: AiAnalyticsContext): string {
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
  stream?: boolean;
}

// ─── Resolve which API key to use ────────────────────────────────────────────

async function resolveApiKey(userId: string): Promise<{ apiKey: string; source: 'central' | 'own' }> {
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

  // Preference is 'own' or central not available
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { claudeApiKey: true },
  });

  if (user?.claudeApiKey) {
    return { apiKey: decrypt(user.claudeApiKey), source: 'own' };
  }

  // No own key — try central as last resort
  if (centralAvailable) {
    const check = await canUseCentralKey(userId);
    if (check.allowed) {
      return { apiKey: config.centralApiKey!, source: 'central' };
    }
    throw new AppError(429, 'USAGE_LIMIT', check.reason ?? 'Usage limit reached.');
  }

  throw new AppError(400, 'NO_API_KEY', 'No API key available. Please add one in settings.');
}

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

// ─── Server-side streaming ───────────────────────────────────────────────────

async function callTextStream(
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

async function callTool<T>(
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

// ─── Background explanation generation ───────────────────────────────────────

const activeVersion = new Map<string, number>();

export function generateDeckExplanation(userId: string, deckId: string): Promise<void> {
  const version = (activeVersion.get(deckId) ?? 0) + 1;
  activeVersion.set(deckId, version);
  return runExplanation(userId, deckId, version)
    .finally(() => {
      if (activeVersion.get(deckId) === version) activeVersion.delete(deckId);
    });
}

async function runExplanation(userId: string, deckId: string, version: number): Promise<void> {
  const { apiKey, source } = await resolveApiKey(userId);

  const deck = await prisma.deck.findUnique({
    where: { nodeId: deckId },
    include: { node: { select: { name: true } } },
  });
  if (!deck) throw new Error(`Deck ${deckId} not found`);

  await setExplanationGenerating(deckId);

  let fullText = '';
  try {
    const { cost } = await callTextStream(
      apiKey, SONNET,
      EXPLANATION_PROMPT(deck.language),
      [{ role: 'user', content: JSON.stringify({ topic: deck.topic, ...(deck.clarification?.trim() ? { clarification: deck.clarification.trim() } : {}) }) }],
      4096,
      (chunk) => { fullText += chunk; },
      undefined,
      {
        userId,
        source,
        endpoint: 'explanation',
        context: {
          deckId,
          deckName: deck.node.name,
          deckTopic: deck.topic,
          language: deck.language,
          traceId: `deck_generation:${deckId}`,
        },
        stream: true,
      },
    );
    await recordUsage(userId, source, 'explanation', SONNET, cost);
    if (activeVersion.get(deckId) === version) {
      await setExplanation(deckId, fullText);
    }
  } catch (e) {
    if (activeVersion.get(deckId) === version) {
      await setExplanationError(deckId);
    }
    throw e;
  }
}

// ─── Streaming SSE endpoint for explanation ──────────────────────────────────

export async function streamExplanation(req: Request, res: Response, userId: string, deckId: string) {
  const { apiKey, source } = await resolveApiKey(userId);
  const deck = await prisma.deck.findUnique({
    where: { nodeId: deckId },
    include: { node: { select: { name: true } } },
  });
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');

  await setExplanationGenerating(deckId);

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sseHeaders(res);

  let fullText = '';
  try {
    const { wasTruncated, cost } = await callTextStream(
      apiKey, SONNET,
      EXPLANATION_PROMPT(deck.language),
      [{ role: 'user', content: JSON.stringify({ topic: deck.topic, ...(deck.clarification?.trim() ? { clarification: deck.clarification.trim() } : {}) }) }],
      4096,
      (chunk) => {
        fullText += chunk;
        sendChunk(res, { type: 'text', text: chunk });
      },
      controller.signal,
      {
        userId,
        source,
        endpoint: 'explanation',
        context: {
          deckId,
          deckName: deck.node.name,
          deckTopic: deck.topic,
          language: deck.language,
          traceId: `deck_generation:${deckId}`,
        },
        stream: true,
      },
    );
    await recordUsage(userId, source, 'explanation', SONNET, cost);
    await setExplanation(deckId, fullText);
    sendDone(res, { cost, wasTruncated });
  } catch (e) {
    await setExplanationError(deckId);
    if (!controller.signal.aborted) {
      sendError(res, e instanceof Error ? e.message : 'Unknown error');
    }
  }
}

// ─── Public AI endpoints ─────────────────────────────────────────────────────

type GeneratedCard = {
  translateFrom?: string;
  targetSentence?: string;
  english?: string;
  targetLanguage?: string;
  sentenceContext?: string;
  hint?: string;
};

export async function generateCards(userId: string, topic: string, language: string, count: number, explanation: string, responseLanguage = 'English', analyticsContext?: AiAnalyticsContext) {
  const { apiKey, source } = await resolveApiKey(userId);

  const { result, cost } = await callTool<{ cards: GeneratedCard[] }>(
    apiKey, HAIKU,
    CARD_GEN_PROMPT(language, count, responseLanguage),
    JSON.stringify({ topic, studyLanguage: language, responseLanguage, count, explanation }),
    2000,
    {
      userId,
      source,
      endpoint: 'cards',
      context: {
        ...analyticsContext,
        deckTopic: analyticsContext?.deckTopic ?? topic,
        language: analyticsContext?.language ?? language,
      },
    },
  );

  await recordUsage(userId, source, 'cards', HAIKU, cost);

  captureAiGeneration(userId, {
    ...analyticsContext,
    endpoint: 'cards_qc',
    traceId: `${analyticsContext?.traceId ?? defaultTraceId('cards', analyticsContext)}:qc`,
    model: HAIKU,
    source,
    cost: 0,
    success: true,
    stream: false,
    input: {
      topic,
      language,
      requested_card_count: count,
      explanation,
    },
    output: {
      cards: result.cards,
    },
  });

  const cards: Card[] = result.cards.map((c, i) => ({
    id: String(i),
    english: c.translateFrom ?? c.english ?? '',
    targetLanguage: c.targetSentence ?? c.targetLanguage ?? '',
    ...(c.sentenceContext ? { sentenceContext: c.sentenceContext } : {}),
    ...(c.hint ? { hint: c.hint } : {}),
  }));
  // Fisher-Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return { cards, cost };
}

export async function judgeAnswer(userId: string, card: Card, userAnswer: string, language: string, explanation?: string, brevity: 'brief' | 'normal' = 'normal', responseLanguage = 'English', analyticsContext?: AiAnalyticsContext) {
  const { apiKey, source } = await resolveApiKey(userId);

  const userPayload = {
    english: card.english,
    targetLanguage: card.targetLanguage,
    userAnswer,
    ...(card.sentenceContext ? { sentenceContext: card.sentenceContext } : {}),
    ...(explanation ? { explanation } : {}),
  };
  if (DEBUG_AI) console.log('[AI:judge payload]\n', JSON.stringify(userPayload));

  const { result, cost } = await callTool<{ reason: string; correct: boolean }>(
    apiKey, HAIKU,
    JUDGMENT_PROMPT(language, brevity, responseLanguage),
    JSON.stringify(userPayload),
    brevity === 'brief' ? 60 : 120,
    {
      userId,
      source,
      endpoint: 'judge',
      context: { ...analyticsContext, language: analyticsContext?.language ?? language },
    },
  );

  if (DEBUG_AI) console.log('[AI:judge response]', JSON.stringify(result));
  await recordUsage(userId, source, 'judge', HAIKU, cost);
  return { ...result, cost };
}

export async function reviewRejection(
  userId: string, card: Card, userAnswer: string, language: string, explanation?: string, brevity: 'brief' | 'normal' = 'normal', responseLanguage = 'English', analyticsContext?: AiAnalyticsContext,
) {
  const { apiKey, source } = await resolveApiKey(userId);

  const userPayload = {
    english: card.english,
    targetLanguage: card.targetLanguage,
    userAnswer,
    ...(card.sentenceContext ? { sentenceContext: card.sentenceContext } : {}),
    ...(explanation ? { explanation } : {}),
  };
  if (DEBUG_AI) console.log('[AI:rejection payload]\n', JSON.stringify(userPayload));

  const { result, cost } = await callTool<{ explanation: string; overrideToCorrect: boolean }>(
    apiKey, SONNET,
    REJECTION_PROMPT(language, brevity, responseLanguage),
    JSON.stringify(userPayload),
    brevity === 'brief' ? 200 : 400,
    {
      userId,
      source,
      endpoint: 'rejection',
      context: { ...analyticsContext, language: analyticsContext?.language ?? language },
    },
  );

  if (DEBUG_AI) console.log('[AI:rejection response]', JSON.stringify(result));
  await recordUsage(userId, source, 'rejection', SONNET, cost);
  return { ...result, cost };
}

export async function streamChat(
  req: Request, res: Response,
  userId: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  analyticsContext?: AiAnalyticsContext,
) {
  const { apiKey, source } = await resolveApiKey(userId);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sseHeaders(res);

  try {
    const { cost } = await callTextStream(
      apiKey, SONNET, systemPrompt, messages, 600,
      (chunk) => sendChunk(res, { type: 'text', text: chunk }),
      controller.signal,
      {
        userId,
        source,
        endpoint: 'chat',
        context: analyticsContext,
        stream: true,
      },
    );
    await recordUsage(userId, source, 'chat', SONNET, cost);
    sendDone(res, { cost });
  } catch (e) {
    if (!controller.signal.aborted) {
      sendError(res, e instanceof Error ? e.message : 'Unknown error');
    }
  }
}

export interface CardAttemptData {
  english: string;
  targetLanguage: string;
  answers: string[];  // all attempts in order; last is always the correct one
}

export async function rateSession(
  userId: string,
  topic: string,
  language: string,
  cards: CardAttemptData[],
  responseLanguage = 'English',
  analyticsContext?: AiAnalyticsContext,
): Promise<{ stars: number; recap: string; cost: number }> {
  const { apiKey, source } = await resolveApiKey(userId);

  const normalizedCards = cards.map(c => ({
    english: c.english,
    targetLanguage: c.targetLanguage,
    answers: Array.isArray(c.answers) && c.answers.length > 0 ? c.answers : [c.targetLanguage],
  }));

  const { result, cost } = await callTool<{ stars: number; recap: string }>(
    apiKey, HAIKU,
    SESSION_RATING_PROMPT(language, responseLanguage),
    JSON.stringify({ topic, cards: normalizedCards }),
    200,
    {
      userId,
      source,
      endpoint: 'rate-session',
      context: {
        ...analyticsContext,
        deckTopic: analyticsContext?.deckTopic ?? topic,
        language: analyticsContext?.language ?? language,
      },
    },
  );

  await recordUsage(userId, source, 'rate-session', HAIKU, cost);
  return { stars: result.stars, recap: result.recap, cost };
}

export async function explainSentence(
  userId: string,
  card: Card,
  language: string,
  explanation?: string,
  responseLanguage = 'English',
  analyticsContext?: AiAnalyticsContext,
): Promise<{ explanation: string; cost: number }> {
  const { apiKey, source } = await resolveApiKey(userId);

  const userPayload = {
    english: card.english,
    targetLanguage: card.targetLanguage,
    ...(card.sentenceContext ? { sentenceContext: card.sentenceContext } : {}),
    ...(explanation ? { explanation } : {}),
  };
  if (DEBUG_AI) console.log('[AI:explain-sentence payload]\n', JSON.stringify(userPayload));

  const { result, cost } = await callTool<{ explanation: string }>(
    apiKey, HAIKU,
    SENTENCE_REVEAL_PROMPT(language, responseLanguage),
    JSON.stringify(userPayload),
    300,
    {
      userId,
      source,
      endpoint: 'explain-sentence',
      context: { ...analyticsContext, language: analyticsContext?.language ?? language },
    },
  );

  if (DEBUG_AI) console.log('[AI:explain-sentence response]', JSON.stringify(result));
  await recordUsage(userId, source, 'explain-sentence', HAIKU, cost);
  return { explanation: result.explanation, cost };
}

export async function generateWordHint(
  userId: string,
  word: string,
  english: string,
  targetLanguage: string,
  language: string,
  responseLanguage = 'English',
  analyticsContext?: AiAnalyticsContext,
): Promise<{ infinitive: string; with_annotation: string; word_type: string; cost: number }> {
  const { apiKey, source } = await resolveApiKey(userId);

  const { result, cost } = await callTool<{ infinitive: string; with_annotation: string; word_type: string }>(
    apiKey, HAIKU,
    WORD_HINT_PROMPT(language, responseLanguage),
    JSON.stringify({ english, targetLanguage, word }),
    150,
    {
      userId,
      source,
      endpoint: 'word-hint',
      context: { ...analyticsContext, language: analyticsContext?.language ?? language },
    },
  );

  await recordUsage(userId, source, 'word-hint', HAIKU, cost);
  return { ...result, cost };
}

export async function streamExplanationGeneric(
  req: Request, res: Response,
  userId: string, topic: string, language: string, responseLanguage = 'English', analyticsContext?: AiAnalyticsContext,
) {
  const { apiKey, source } = await resolveApiKey(userId);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sseHeaders(res);

  try {
    const { wasTruncated, cost } = await callTextStream(
      apiKey, SONNET,
      EXPLANATION_PROMPT(language, responseLanguage),
      [{ role: 'user', content: JSON.stringify({ topic, studyLanguage: language, responseLanguage }) }],
      4096,
      (chunk) => sendChunk(res, { type: 'text', text: chunk }),
      controller.signal,
      {
        userId,
        source,
        endpoint: 'explanation',
        context: {
          ...analyticsContext,
          deckTopic: analyticsContext?.deckTopic ?? topic,
          language: analyticsContext?.language ?? language,
        },
        stream: true,
      },
    );
    await recordUsage(userId, source, 'explanation', SONNET, cost);
    sendDone(res, { cost, wasTruncated });
  } catch (e) {
    if (!controller.signal.aborted) {
      sendError(res, e instanceof Error ? e.message : 'Unknown error');
    }
  }
}
