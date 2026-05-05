import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  generateCards,
  judgeAnswer,
  reviewRejection,
  streamChat,
  streamExplanationGeneric,
  rateSession,
  generateWordHint,
} from '../services/claude.service.js';
import { CARD_CHAT_PROMPT } from '../constants/prompts.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSetting } from '../services/settings.service.js';
import type { AiAnalyticsContext } from '../services/analytics.service.js';

const DEFAULT_CARD_COUNT = 10;

export const claudeProxyRouter = Router();
export const DEBUG_AI = true;

claudeProxyRouter.use(requireAuth);

function logAI(userId: string, type: string, model: string) {
  console.log(`[AI] ${userId} | ${type} | ${model}`);
}

function analyticsContext(body: Record<string, unknown>, fallback: Partial<AiAnalyticsContext> = {}): AiAnalyticsContext {
  const raw = (body?.analyticsContext ?? {}) as Record<string, unknown>;
  return {
    appSessionId: typeof raw.appSessionId === 'string' ? raw.appSessionId : fallback.appSessionId,
    studySessionId: typeof raw.studySessionId === 'string' ? raw.studySessionId : fallback.studySessionId,
    deckId: typeof raw.deckId === 'string' ? raw.deckId : fallback.deckId,
    deckName: typeof raw.deckName === 'string' ? raw.deckName : fallback.deckName,
    deckTopic: typeof raw.deckTopic === 'string' ? raw.deckTopic : fallback.deckTopic,
    collectionPath: typeof raw.collectionPath === 'string' ? raw.collectionPath : fallback.collectionPath,
    language: typeof raw.language === 'string' ? raw.language : fallback.language,
    studyMode: typeof raw.studyMode === 'string' ? raw.studyMode : fallback.studyMode,
    cardIndex: typeof raw.cardIndex === 'number' ? raw.cardIndex : fallback.cardIndex,
    attemptNumber: typeof raw.attemptNumber === 'number' ? raw.attemptNumber : fallback.attemptNumber,
    turnIndex: typeof raw.turnIndex === 'number' ? raw.turnIndex : fallback.turnIndex,
    wordIndex: typeof raw.wordIndex === 'number' ? raw.wordIndex : fallback.wordIndex,
    traceId: typeof raw.traceId === 'string' ? raw.traceId : fallback.traceId,
  };
}

// Non-streaming: generate cards
claudeProxyRouter.post('/cards', async (req, res, next) => {
  try {
    const { topic, language, count, explanation } = req.body;
    if (!topic || !language || count === undefined || count === null || !explanation) {
      throw new AppError(400, 'MISSING_FIELDS', 'topic, language, count, and explanation are required.');
    }
    let resolvedCount = Number(count);
    if (resolvedCount === 0) {
      const setting = await getSetting(req.userId!, 'default_card_count');
      resolvedCount = setting ? parseInt(setting, 10) : DEFAULT_CARD_COUNT;
    }
    logAI(req.userId!, 'cards', 'haiku');
    const result = await generateCards(req.userId!, topic, language, resolvedCount, explanation, analyticsContext(req.body, {
      appSessionId: req.appSessionId,
      deckTopic: String(topic),
      language: String(language),
      traceId: req.body.analyticsContext?.deckId ? `deck_generation:${req.body.analyticsContext.deckId}` : undefined,
    }));
    res.json(result);
  } catch (e) { next(e); }
});

// Non-streaming: judge answer
claudeProxyRouter.post('/judge', async (req, res, next) => {
  try {
    const { card, userAnswer, language, explanation, brevity } = req.body;
    if (!card || !userAnswer || !language) {
      throw new AppError(400, 'MISSING_FIELDS', 'card, userAnswer, and language are required.');
    }
    const resolvedBrevity = brevity === 'brief' ? 'brief' : 'normal';
    logAI(req.userId!, `judge:${resolvedBrevity}`, 'haiku');
    const ctx = analyticsContext(req.body, { appSessionId: req.appSessionId, language: String(language) });
    const result = await judgeAnswer(req.userId!, card, userAnswer, language, explanation, resolvedBrevity, {
      ...ctx,
      traceId: ctx.traceId ?? (ctx.studySessionId ? `answer:${ctx.studySessionId}:${ctx.cardIndex ?? 'unknown'}:${ctx.attemptNumber ?? 1}` : undefined),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// Streaming: explanation
claudeProxyRouter.post('/explanation/stream', async (req, res, next) => {
  try {
    const { topic, language } = req.body;
    if (!topic || !language) {
      throw new AppError(400, 'MISSING_FIELDS', 'topic and language are required.');
    }
    logAI(req.userId!, 'explanation', 'sonnet');
    await streamExplanationGeneric(req, res, req.userId!, topic, language, analyticsContext(req.body, {
      appSessionId: req.appSessionId,
      deckTopic: String(topic),
      language: String(language),
    }));
  } catch (e) { next(e); }
});

// Non-streaming: rejection review
claudeProxyRouter.post('/rejection', async (req, res, next) => {
  try {
    const { card, userAnswer, language, explanation, brevity } = req.body;
    if (!card || !userAnswer || !language) {
      throw new AppError(400, 'MISSING_FIELDS', 'card, userAnswer, and language are required.');
    }
    const resolvedBrevity = brevity === 'brief' ? 'brief' : 'normal';
    logAI(req.userId!, `rejection:${resolvedBrevity}`, 'sonnet');
    const ctx = analyticsContext(req.body, { appSessionId: req.appSessionId, language: String(language) });
    const result = await reviewRejection(req.userId!, card, userAnswer, language, explanation, resolvedBrevity, {
      ...ctx,
      traceId: ctx.traceId ?? (ctx.studySessionId ? `answer:${ctx.studySessionId}:${ctx.cardIndex ?? 'unknown'}:${ctx.attemptNumber ?? 1}` : undefined),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// Non-streaming: rate session
claudeProxyRouter.post('/rate-session', async (req, res, next) => {
  try {
    const { topic, language, cards } = req.body;
    if (!topic || !language || !Array.isArray(cards)) {
      throw new AppError(400, 'MISSING_FIELDS', 'topic, language, and cards are required.');
    }
    logAI(req.userId!, 'rate-session', 'haiku');
    const ctx = analyticsContext(req.body, { appSessionId: req.appSessionId, deckTopic: String(topic), language: String(language) });
    const result = await rateSession(req.userId!, topic, language, cards, {
      ...ctx,
      traceId: ctx.traceId ?? (ctx.studySessionId ? `session_rating:${ctx.studySessionId}:${ctx.deckId ?? 'quick'}` : undefined),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// Non-streaming: word hint
claudeProxyRouter.post('/word-hint', async (req, res, next) => {
  try {
    const { word, english, targetLanguage, language } = req.body;
    if (!word || !english || !targetLanguage || !language) {
      throw new AppError(400, 'MISSING_FIELDS', 'word, english, targetLanguage, and language are required.');
    }
    logAI(req.userId!, 'word-hint', 'haiku');
    const ctx = analyticsContext(req.body, { appSessionId: req.appSessionId, language: String(language) });
    const result = await generateWordHint(req.userId!, word, english, targetLanguage, language, {
      ...ctx,
      traceId: ctx.traceId ?? (ctx.studySessionId ? `word_hint:${ctx.studySessionId}:${ctx.cardIndex ?? 'unknown'}:${ctx.wordIndex ?? 0}` : undefined),
    });
    res.json(result);
  } catch (e) { next(e); }
});

// Streaming: chat
claudeProxyRouter.post('/chat/stream', async (req, res, next) => {
  try {
    const { card, userAnswer, language, wasCorrect, messages, explanation } = req.body;
    if (!card || !userAnswer || !language || wasCorrect === undefined || !messages) {
      throw new AppError(400, 'MISSING_FIELDS', 'card, userAnswer, language, wasCorrect, and messages are required.');
    }
    logAI(req.userId!, 'chat', 'sonnet');
    const systemPrompt = CARD_CHAT_PROMPT(language);
    const cardContext = {
      english: card.english,
      targetLanguage: card.targetLanguage,
      userAnswer,
      wasCorrect,
      ...(card.sentenceContext ? { sentenceContext: card.sentenceContext } : {}),
      ...(explanation ? { explanation } : {}),
    };
    const messagesWithContext = [
      { role: 'user', content: JSON.stringify(cardContext) },
      { role: 'assistant', content: 'Got it. What would you like to know about this card?' },
      ...messages,
    ];
    const ctx = analyticsContext(req.body, { appSessionId: req.appSessionId, language: String(language) });
    await streamChat(req, res, req.userId!, systemPrompt, messagesWithContext, {
      ...ctx,
      traceId: ctx.traceId ?? (ctx.studySessionId ? `chat:${ctx.studySessionId}:${ctx.cardIndex ?? 'unknown'}:${ctx.turnIndex ?? 0}` : undefined),
    });
  } catch (e) { next(e); }
});
