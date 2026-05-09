import type { Request, Response } from 'express';
import type { Card } from '../../types/index.js';
import type { AiAnalyticsContext } from '../analytics.service.js';
import { capture, captureAiGeneration } from '../analytics.service.js';
import type { ExtractedGrammarCase, GrammarCaseTarget } from '../grammar-case.service.js';
import { sseHeaders, sendChunk, sendDone, sendError } from '../../lib/sse.js';
import {
  CARD_GEN_PROMPT,
  CASE_EXTRACTION_PROMPT,
  JUDGMENT_PROMPT,
  REJECTION_PROMPT,
  SESSION_RATING_PROMPT,
  SENTENCE_REVEAL_PROMPT,
  WORD_HINT_PROMPT,
} from '../../constants/prompts.js';
import { DEBUG_AI } from '../../routes/claude-proxy.js';
import { callTextStream, callTool, defaultTraceId, HAIKU, recordUsage, resolveApiKey, SONNET } from './shared.js';

type GeneratedCard = {
  translateFrom?: string;
  targetSentence?: string;
  english?: string;
  targetLanguage?: string;
  caseKey?: string;
  sentenceContext?: string;
  hint?: string;
};

export async function extractGrammarCases(
  userId: string,
  topic: string,
  language: string,
  explanation: string,
  analyticsContext?: AiAnalyticsContext,
  responseLanguage = 'English',
): Promise<ExtractedGrammarCase[]> {
  const { apiKey, source } = await resolveApiKey(userId);

  const { result, cost } = await callTool<{ cases: ExtractedGrammarCase[] }>(
    apiKey, SONNET,
    CASE_EXTRACTION_PROMPT(language, responseLanguage),
    JSON.stringify({ topic, studyLanguage: language, responseLanguage, explanation }),
    2500,
    {
      userId,
      source,
      endpoint: 'case-extraction',
      context: {
        ...analyticsContext,
        deckTopic: analyticsContext?.deckTopic ?? topic,
        language: analyticsContext?.language ?? language,
      },
    },
  );

  await recordUsage(userId, source, 'case-extraction', SONNET, cost);
  return Array.isArray(result.cases) ? result.cases : [];
}

export async function generateCards(
  userId: string,
  topic: string,
  language: string,
  count: number,
  explanation: string,
  responseLanguage = 'English',
  analyticsContext?: AiAnalyticsContext,
  caseTargets?: GrammarCaseTarget[],
) {
  const { apiKey, source } = await resolveApiKey(userId);

  const userMessage = JSON.stringify({
    topic,
    studyLanguage: language,
    responseLanguage,
    count,
    explanation,
    ...(caseTargets && caseTargets.length > 0
      ? {
        caseTargets: caseTargets.map(target => ({
          caseKey: target.caseKey,
          label: target.label,
          ruleSummary: target.ruleSummary,
          generationHint: target.generationHint,
        })),
      }
      : {}),
  });
  const maxTokens = caseTargets && caseTargets.length > 0 ? 2400 : 2000;
  const analyticsOpts = {
    userId,
    source,
    endpoint: 'cards',
    context: {
      ...analyticsContext,
      deckTopic: analyticsContext?.deckTopic ?? topic,
      language: analyticsContext?.language ?? language,
    },
  };

  let result!: { cards: GeneratedCard[] };
  let totalCost = 0;
  for (let attempt = 0; attempt <= 1; attempt++) {
    const { result: r, cost } = await callTool<{ cards: GeneratedCard[] }>(
      apiKey, HAIKU, CARD_GEN_PROMPT(language, count, responseLanguage), userMessage, maxTokens, analyticsOpts,
    );
    await recordUsage(userId, source, 'cards', HAIKU, cost);
    totalCost += cost;
    if (Array.isArray(r.cards)) {
      result = r;
      break;
    }
    if (attempt === 1) {
      throw new Error(`Invalid AI response: expected cards array, got ${typeof r.cards}`);
    }
  }

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
      case_targets: caseTargets?.map(target => ({
        grammar_case_id: target.id,
        case_key: target.caseKey,
        label: target.label,
      })),
    },
    output: {
      cards: result.cards,
    },
  });

  const targetByKey = new Map((caseTargets ?? []).map(target => [target.caseKey, target]));
  let repairedCaseKeys = 0;
  const cards: Card[] = result.cards.map((c, i) => {
    const matchedTarget = c.caseKey ? targetByKey.get(c.caseKey) : undefined;
    const fallbackTarget = caseTargets?.[i];
    const target = matchedTarget ?? fallbackTarget;
    if (caseTargets && caseTargets.length > 0 && target && matchedTarget === undefined) {
      repairedCaseKeys++;
    }

    return {
      id: String(i),
      english: c.translateFrom ?? c.english ?? '',
      targetLanguage: c.targetSentence ?? c.targetLanguage ?? '',
      ...(target ? {
        grammarCaseId: target.id,
        grammarCaseKey: target.caseKey,
        grammarCaseLabel: target.label,
      } : {}),
      ...(c.sentenceContext ? { sentenceContext: c.sentenceContext } : {}),
      ...(c.hint ? { hint: c.hint } : {}),
    };
  });
  if (repairedCaseKeys > 0) {
    capture(userId, 'card_case_key_repaired', {
      ...analyticsContext,
      repaired_count: repairedCaseKeys,
      requested_card_count: count,
    });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return { cards, cost: totalCost };
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
  answers: string[];
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
