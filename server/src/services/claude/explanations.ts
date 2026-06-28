import crypto from 'crypto';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { setExplanation, setExplanationError, setExplanationGenerating } from '../deck.service.js';
import { sseHeaders, sendChunk, sendDone, sendError } from '../../lib/sse.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { AiAnalyticsContext } from '../analytics.service.js';
import { EXPLANATION_PROMPT, EXPLANATION_SUMMARY_PROMPT } from '../../constants/prompts.js';
import { callStructuredTool, callTextStream } from '../ai-routing.service.js';

const activeVersion = new Map<string, number>();

function enqueueCaseExtractionAfterExplanation(userId: string, deckId: string, analyticsContext: AiAnalyticsContext) {
  void import('../scheduler.service.js')
    .then(({ enqueueGrammarCaseExtraction }) => {
      enqueueGrammarCaseExtraction(userId, deckId, { analyticsContext });
    })
    .catch(err => {
      console.error(`[scheduler] Failed to enqueue case extraction for deck ${deckId}:`, err);
    });
}

export function explanationSummarySourceHash(
  topic: string,
  language: string,
  responseLanguage: string,
  explanation: string,
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ topic, language, responseLanguage, explanation }))
    .digest('hex');
}

export async function generateExplanationSummary(
  userId: string,
  topic: string,
  language: string,
  explanation: string,
  responseLanguage = 'English',
  analyticsContext?: AiAnalyticsContext,
): Promise<{ explanationSummary: string; cost: number }> {
  const { result, cost } = await callStructuredTool<{ explanationSummary: string }>(
    userId,
    'explanation-summary',
    EXPLANATION_SUMMARY_PROMPT(language, responseLanguage),
    JSON.stringify({ topic, studyLanguage: language, responseLanguage, explanation }),
    1800,
    {
      userId,
      endpoint: 'explanation-summary',
      context: {
        ...analyticsContext,
        deckTopic: analyticsContext?.deckTopic ?? topic,
        language: analyticsContext?.language ?? language,
      },
    },
  );
  const explanationSummary = result.explanationSummary?.trim();
  if (!explanationSummary) {
    throw new Error('Invalid AI response: expected explanationSummary');
  }
  return { explanationSummary, cost };
}

export async function ensureDeckExplanationSummary(
  userId: string,
  deckId: string,
  responseLanguage = 'English',
  analyticsContext?: AiAnalyticsContext,
): Promise<{ explanationSummary: string | undefined; cost: number }> {
  const deck = await prisma.deck.findFirst({
    where: { nodeId: deckId, node: { userId } },
    select: {
      nodeId: true,
      topic: true,
      language: true,
      explanation: true,
      explanationSummary: true,
      explanationSummarySourceHash: true,
    },
  });
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');
  if (!deck.explanation?.trim()) return { explanationSummary: undefined, cost: 0 };

  const sourceHash = explanationSummarySourceHash(deck.topic, deck.language, responseLanguage, deck.explanation);
  if (deck.explanationSummary?.trim() && deck.explanationSummarySourceHash === sourceHash) {
    return { explanationSummary: deck.explanationSummary, cost: 0 };
  }

  const { explanationSummary, cost } = await generateExplanationSummary(
    userId,
    deck.topic,
    deck.language,
    deck.explanation,
    responseLanguage,
    {
      ...analyticsContext,
      deckId,
      deckTopic: analyticsContext?.deckTopic ?? deck.topic,
      language: analyticsContext?.language ?? deck.language,
      traceId: analyticsContext?.traceId ?? `explanation_summary:${deckId}`,
    },
  );
  await prisma.deck.update({
    where: { nodeId: deckId },
    data: { explanationSummary, explanationSummarySourceHash: sourceHash },
  });
  return { explanationSummary, cost };
}

export function generateDeckExplanation(userId: string, deckId: string): Promise<void> {
  const version = (activeVersion.get(deckId) ?? 0) + 1;
  activeVersion.set(deckId, version);
  return runExplanation(userId, deckId, version)
    .finally(() => {
      if (activeVersion.get(deckId) === version) activeVersion.delete(deckId);
    });
}

async function runExplanation(userId: string, deckId: string, version: number): Promise<void> {
  const deck = await prisma.deck.findUnique({
    where: { nodeId: deckId },
    include: { node: { select: { name: true } } },
  });
  if (!deck) throw new Error(`Deck ${deckId} not found`);

  await setExplanationGenerating(deckId);

  let fullText = '';
  try {
    await callTextStream(
      userId, 'explanation',
      EXPLANATION_PROMPT(deck.language),
      [{ role: 'user', content: JSON.stringify({ topic: deck.topic, ...(deck.clarification?.trim() ? { clarification: deck.clarification.trim() } : {}) }) }],
      4096,
      (chunk) => { fullText += chunk; },
      undefined,
      {
        userId,
        endpoint: 'explanation',
        context: {
          deckId,
          deckName: deck.node.name,
          deckTopic: deck.topic,
          language: deck.language,
          traceId: `deck_generation:${deckId}`,
        },
      },
    );
    if (activeVersion.get(deckId) === version) {
      const { explanationSummary } = await generateExplanationSummary(
        userId,
        deck.topic,
        deck.language,
        fullText,
        'English',
        {
          deckId,
          deckName: deck.node.name,
          deckTopic: deck.topic,
          language: deck.language,
          traceId: `explanation_summary:${deckId}`,
        },
      );
      await setExplanation(deckId, fullText, explanationSummary, explanationSummarySourceHash(deck.topic, deck.language, 'English', fullText));
      enqueueCaseExtractionAfterExplanation(userId, deckId, {
        deckId,
        deckName: deck.node.name,
        deckTopic: deck.topic,
        language: deck.language,
        traceId: `case_extraction:${deckId}`,
      });
    }
  } catch (e) {
    if (activeVersion.get(deckId) === version) {
      await setExplanationError(deckId);
    }
    throw e;
  }
}

export async function streamExplanation(_req: Request, res: Response, userId: string, deckId: string) {
  const deck = await prisma.deck.findUnique({
    where: { nodeId: deckId },
    include: { node: { select: { name: true } } },
  });
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');

  await setExplanationGenerating(deckId);

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  sseHeaders(res);

  let fullText = '';
  try {
    const { wasTruncated, cost } = await callTextStream(
      userId, 'explanation',
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
        endpoint: 'explanation',
        context: {
          deckId,
          deckName: deck.node.name,
          deckTopic: deck.topic,
          language: deck.language,
          traceId: `deck_generation:${deckId}`,
        },
      },
    );
    const { explanationSummary, cost: summaryCost } = await generateExplanationSummary(
      userId,
      deck.topic,
      deck.language,
      fullText,
      'English',
      {
        deckId,
        deckName: deck.node.name,
        deckTopic: deck.topic,
        language: deck.language,
        traceId: `explanation_summary:${deckId}`,
      },
    );
    await setExplanation(deckId, fullText, explanationSummary, explanationSummarySourceHash(deck.topic, deck.language, 'English', fullText));
    enqueueCaseExtractionAfterExplanation(userId, deckId, {
      deckId,
      deckName: deck.node.name,
      deckTopic: deck.topic,
      language: deck.language,
      traceId: `case_extraction:${deckId}`,
    });
    sendDone(res, { cost: cost + summaryCost, wasTruncated });
  } catch (e) {
    await setExplanationError(deckId);
    if (!controller.signal.aborted) {
      sendError(res, e instanceof Error ? e.message : 'Unknown error');
    }
  }
}

export async function streamExplanationGeneric(
  _req: Request, res: Response,
  userId: string, topic: string, language: string, responseLanguage = 'English', analyticsContext?: AiAnalyticsContext,
) {
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  sseHeaders(res);

  try {
    const { wasTruncated, cost } = await callTextStream(
      userId, 'explanation',
      EXPLANATION_PROMPT(language, responseLanguage),
      [{ role: 'user', content: JSON.stringify({ topic, studyLanguage: language, responseLanguage }) }],
      4096,
      (chunk) => sendChunk(res, { type: 'text', text: chunk }),
      controller.signal,
      {
        userId,
        endpoint: 'explanation',
        context: {
          ...analyticsContext,
          deckTopic: analyticsContext?.deckTopic ?? topic,
          language: analyticsContext?.language ?? language,
        },
      },
    );
    sendDone(res, { cost, wasTruncated });
  } catch (e) {
    if (!controller.signal.aborted) {
      sendError(res, e instanceof Error ? e.message : 'Unknown error');
    }
  }
}
