import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { decrypt } from './crypto.service.js';
import { setExplanation, setExplanationError, setExplanationGenerating } from './deck.service.js';
import { getSetting } from './settings.service.js';
import { recordUsage, canUseCentralKey } from './usage.service.js';
import { config, isCentralKeyAvailable } from '../config.js';
import { sseHeaders, sendChunk, sendDone, sendError } from '../lib/sse.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  EXPLANATION_PROMPT,
  DECK_EXPLANATION_PROMPT,
  CARD_GEN_PROMPT,
  JUDGMENT_PROMPT,
  REJECTION_PROMPT,
  SESSION_RATING_PROMPT,
  WORD_HINT_PROMPT,
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
): Promise<{ wasTruncated: boolean; cost: number }> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ model, max_tokens: maxTokens, system, stream: true, messages }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const state = { inputTokens: 0, outputTokens: 0, wasTruncated: false };

  try {
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
  } finally {
    reader.cancel();
  }

  return {
    wasTruncated: state.wasTruncated,
    cost: calcCost(model, state.inputTokens, state.outputTokens),
  };
}

async function callTool<T>(
  apiKey: string,
  model: string,
  system: string,
  userMessage: string,
  toolName: string,
  toolDescription: string,
  inputSchema: object,
  maxTokens: number,
): Promise<{ result: T; cost: number }> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      tools: [{ name: toolName, description: toolDescription, input_schema: inputSchema }],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as any;
  const cost = calcCost(model, data.usage.input_tokens, data.usage.output_tokens);
  const toolUse = data.content.find((b: any) => b.type === 'tool_use');
  return { result: toolUse.input as T, cost };
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

  const deck = await prisma.deck.findUnique({ where: { nodeId: deckId } });
  if (!deck) throw new Error(`Deck ${deckId} not found`);

  await setExplanationGenerating(deckId);

  let fullText = '';
  try {
    const { cost } = await callTextStream(
      apiKey, SONNET,
      DECK_EXPLANATION_PROMPT(deck.topic, deck.language, deck.clarification),
      [{ role: 'user', content: 'Please explain the grammar topic for my study session.' }],
      4096,
      (chunk) => { fullText += chunk; },
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
  const deck = await prisma.deck.findUnique({ where: { nodeId: deckId } });
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');

  await setExplanationGenerating(deckId);

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sseHeaders(res);

  let fullText = '';
  try {
    const { wasTruncated, cost } = await callTextStream(
      apiKey, SONNET,
      DECK_EXPLANATION_PROMPT(deck.topic, deck.language, deck.clarification),
      [{ role: 'user', content: 'Please explain the grammar topic for my study session.' }],
      4096,
      (chunk) => {
        fullText += chunk;
        sendChunk(res, { type: 'text', text: chunk });
      },
      controller.signal,
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

export async function generateCards(userId: string, topic: string, language: string, count: number, explanation: string) {
  const { apiKey, source } = await resolveApiKey(userId);

  const { result, cost } = await callTool<{ cards: Omit<Card, 'id'>[] }>(
    apiKey, HAIKU,
    CARD_GEN_PROMPT(topic, language, count, explanation),
    'Generate the flashcards now.',
    'generate_flashcards',
    'Output the requested flashcard pairs.',
    {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          minItems: count,
          maxItems: count,
          items: {
            type: 'object',
            properties: {
              english: { type: 'string', description: 'The English sentence the learner must translate.' },
              targetLanguage: { type: 'string', description: `The correct ${language} translation.` },
              sentenceContext: { type: 'string', description: 'Optional 1–3 word context note.' },
              notes: { type: 'string', description: 'Optional grammar note.' },
            },
            required: ['english', 'targetLanguage'],
          },
        },
      },
      required: ['cards'],
    },
    2000,
  );

  await recordUsage(userId, source, 'cards', HAIKU, cost);

  const cards: Card[] = result.cards.map((c, i) => ({ ...c, id: String(i) }));
  // Fisher-Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return { cards, cost };
}

export async function judgeAnswer(userId: string, card: Card, userAnswer: string, language: string, explanation?: string, brevity: 'brief' | 'normal' = 'normal') {
  const { apiKey, source } = await resolveApiKey(userId);

  const prompt = JUDGMENT_PROMPT(card.english, card.targetLanguage, userAnswer, language, card.sentenceContext, explanation, brevity);
  if (DEBUG_AI) console.log('[AI:judge prompt]\n', prompt);

  const { result, cost } = await callTool<{ reason: string; correct: boolean }>(
    apiKey, HAIKU,
    prompt,
    'Judge the answer.',
    'submit_judgment',
    brevity === 'brief'
      ? 'Submit whether the student answer is correct with a very short reason (a few words).'
      : 'First explain your reasoning in one sentence, then submit whether the student answer is correct.',
    {
      type: 'object',
      properties: {
        reason: { type: 'string', description: brevity === 'brief' ? 'A few-word note (e.g. "Wrong tense" or "Correct!").' : 'One-sentence explanation of why the answer is correct or incorrect.' },
        correct: { type: 'boolean', description: 'Whether the answer is correct.' },
      },
      required: ['reason', 'correct'],
    },
    brevity === 'brief' ? 60 : 120,
  );

  if (DEBUG_AI) console.log('[AI:judge response]', JSON.stringify(result));
  await recordUsage(userId, source, 'judge', HAIKU, cost);
  return { ...result, cost };
}

export async function reviewRejection(
  userId: string, card: Card, userAnswer: string, language: string, explanation?: string, brevity: 'brief' | 'normal' = 'normal',
) {
  const { apiKey, source } = await resolveApiKey(userId);

  const prompt = REJECTION_PROMPT(card.english, card.targetLanguage, userAnswer, language, card.sentenceContext, explanation, brevity);
  if (DEBUG_AI) console.log('[AI:rejection prompt]\n', prompt);

  const { result, cost } = await callTool<{ explanation: string; overrideToCorrect: boolean }>(
    apiKey, SONNET,
    prompt,
    'Review the learner\'s answer.',
    'submit_review',
    'Submit the review of the learner\'s answer, including whether to override the rejection.',
    {
      type: 'object',
      properties: {
        explanation: { type: 'string', description: brevity === 'brief' ? 'Feedback for the learner (1–2 sentences).' : 'Feedback for the learner (2–4 sentences).' },
        overrideToCorrect: { type: 'boolean', description: 'True if the answer was actually correct and the rejection was a mistake.' },
      },
      required: ['explanation', 'overrideToCorrect'],
    },
    brevity === 'brief' ? 200 : 400,
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
): Promise<{ stars: number; recap: string; cost: number }> {
  const { apiKey, source } = await resolveApiKey(userId);

  const cardSummary = cards.map((c, i) => {
    const answers = Array.isArray(c.answers) ? c.answers : [];
    const wrongAnswers = answers.slice(0, -1);
    const correctAnswer = answers[answers.length - 1] ?? c.targetLanguage;
    const attemptLines = wrongAnswers.map(a => `    ✗ "${a}"`).join('\n');
    return [
      `Card ${i + 1}: "${c.english}" → correct: "${c.targetLanguage}"`,
      wrongAnswers.length > 0
        ? `  Wrong attempts (${wrongAnswers.length}):\n${attemptLines}\n  ✓ "${correctAnswer}"`
        : `  ✓ "${correctAnswer}" (first try)`,
    ].join('\n');
  }).join('\n\n');

  const { result, cost } = await callTool<{ stars: number; recap: string }>(
    apiKey, HAIKU,
    SESSION_RATING_PROMPT(topic, language, cardSummary),
    'Rate this study session.',
    'rate_session',
    'Submit a star rating and short recap for the student\'s session performance.',
    {
      type: 'object',
      properties: {
        stars: { type: 'integer', minimum: 1, maximum: 5, description: 'Performance rating from 1 (poor) to 5 (excellent).' },
        recap: { type: 'string', description: '1–2 sentence recap of the student\'s performance.' },
      },
      required: ['stars', 'recap'],
    },
    200,
  );

  await recordUsage(userId, source, 'rate-session', HAIKU, cost);
  return { stars: result.stars, recap: result.recap, cost };
}

export async function generateWordHint(
  userId: string,
  word: string,
  english: string,
  targetLanguage: string,
  language: string,
): Promise<{ infinitive: string; with_annotation: string; word_type: string; cost: number }> {
  const { apiKey, source } = await resolveApiKey(userId);

  const { result, cost } = await callTool<{ infinitive: string; with_annotation: string; word_type: string }>(
    apiKey, HAIKU,
    WORD_HINT_PROMPT(language),
    `The learner is translating this English sentence into ${language}:\n"${english}"\n\nThe correct ${language} translation is:\n"${targetLanguage}"\n\nThe learner does not know the ${language} word for the English word: "${word}"\n\nIdentify the corresponding ${language} vocabulary item and return its dictionary form with annotation and word type.`,
    'provide_word_hint',
    'Provide the dictionary form, furigana annotation, and grammatical category for the requested word.',
    {
      type: 'object',
      properties: {
        infinitive: { type: 'string', description: 'The dictionary/plain form of the word (not the conjugated form from the translation).' },
        with_annotation: { type: 'string', description: 'The infinitive in Anki-style furigana notation. For Latin-script languages equals infinitive.' },
        word_type: { type: 'string', description: 'Grammatical category using language-appropriate terminology.' },
      },
      required: ['infinitive', 'with_annotation', 'word_type'],
    },
    150,
  );

  await recordUsage(userId, source, 'word-hint', HAIKU, cost);
  return { ...result, cost };
}

export async function streamExplanationGeneric(
  req: Request, res: Response,
  userId: string, topic: string, language: string,
) {
  const { apiKey, source } = await resolveApiKey(userId);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sseHeaders(res);

  try {
    const { wasTruncated, cost } = await callTextStream(
      apiKey, SONNET,
      EXPLANATION_PROMPT(topic, language),
      [{ role: 'user', content: 'Please explain the grammar topic for my study session.' }],
      4096,
      (chunk) => sendChunk(res, { type: 'text', text: chunk }),
      controller.signal,
    );
    await recordUsage(userId, source, 'explanation', SONNET, cost);
    sendDone(res, { cost, wasTruncated });
  } catch (e) {
    if (!controller.signal.aborted) {
      sendError(res, e instanceof Error ? e.message : 'Unknown error');
    }
  }
}
