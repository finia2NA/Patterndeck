import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { setExplanation, setExplanationError, setExplanationGenerating } from '../deck.service.js';
import { sseHeaders, sendChunk, sendDone, sendError } from '../../lib/sse.js';
import { AppError } from '../../middleware/errorHandler.js';
import type { AiAnalyticsContext } from '../analytics.service.js';
import { EXPLANATION_PROMPT } from '../../constants/prompts.js';
import { callTextStream, recordUsage, resolveApiKey, resolveResponseLanguage, SONNET } from './shared.js';

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
    const [{ apiKey, source }, responseLang] = await Promise.all([
      resolveApiKey(userId),
      resolveResponseLanguage(userId),
    ]);
    const { cost } = await callTextStream(
      apiKey, SONNET,
      EXPLANATION_PROMPT(deck.language, responseLang),
      [{ role: 'user', content: JSON.stringify({ topic: deck.topic, studyLanguage: deck.language, responseLanguage: responseLang, ...(deck.clarification?.trim() ? { clarification: deck.clarification.trim() } : {}) }) }],
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
      },
    );
    await recordUsage(userId, source, 'explanation', SONNET, cost);
    if (activeVersion.get(deckId) === version) {
      await setExplanation(deckId, fullText);
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

export async function streamExplanation(req: Request, res: Response, userId: string, deckId: string) {
  const [{ apiKey, source }, responseLang, deck] = await Promise.all([
    resolveApiKey(userId),
    resolveResponseLanguage(userId),
    prisma.deck.findUnique({
      where: { nodeId: deckId },
      include: { node: { select: { name: true } } },
    }),
  ]);
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');

  await setExplanationGenerating(deckId);

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sseHeaders(res);

  let fullText = '';
  try {
    const { wasTruncated, cost } = await callTextStream(
      apiKey, SONNET,
      EXPLANATION_PROMPT(deck.language, responseLang),
      [{ role: 'user', content: JSON.stringify({ topic: deck.topic, studyLanguage: deck.language, responseLanguage: responseLang, ...(deck.clarification?.trim() ? { clarification: deck.clarification.trim() } : {}) }) }],
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
      },
    );
    await recordUsage(userId, source, 'explanation', SONNET, cost);
    await setExplanation(deckId, fullText);
    enqueueCaseExtractionAfterExplanation(userId, deckId, {
      deckId,
      deckName: deck.node.name,
      deckTopic: deck.topic,
      language: deck.language,
      traceId: `case_extraction:${deckId}`,
    });
    sendDone(res, { cost, wasTruncated });
  } catch (e) {
    await setExplanationError(deckId);
    if (!controller.signal.aborted) {
      sendError(res, e instanceof Error ? e.message : 'Unknown error');
    }
  }
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
