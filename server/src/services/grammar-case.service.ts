import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { capture, captureException, type AiAnalyticsContext } from './analytics.service.js';

const PRIOR_DIFFICULTY = 0.35;
const PRIOR_STRENGTH = 3;
const HALF_LIFE_ITERATIONS = 6;
const MAX_EXTRACTED_CASES = 32;

type GrammarCaseRow = {
  id: string;
  deckId: string;
  caseKey: string;
  label: string;
  ruleSummary: string;
  generationHint: string;
  baseWeight: number;
  sourceHash: string;
  active: boolean;
  sortOrder: number;
};

export interface ExtractedGrammarCase {
  caseKey?: string;
  label?: string;
  ruleSummary?: string;
  generationHint?: string;
  importance?: number;
}

export interface GrammarCaseTarget {
  id: string;
  caseKey: string;
  label: string;
  ruleSummary: string;
  generationHint: string;
  baseWeight: number;
}

export interface GrammarCaseSummary extends GrammarCaseTarget {
  difficulty: number;
  seenCount: number;
  correctFirstTryCount: number;
  lastPracticedIteration: number | null;
}

export interface GrammarCaseReviewAttempt {
  grammarCaseId?: string | null;
  grammarCaseKey?: string | null;
  answers?: string[];
}

type GrammarCaseTx = Prisma.TransactionClient;

const extractionPromises = new Map<string, Promise<GrammarCaseTarget[]>>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sourceHashFor(topic: string, language: string, explanation: string): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ topic, language, explanation }))
    .digest('hex');
}

function normalizeCaseKey(raw: string | undefined, fallback: string): string {
  const normalized = (raw ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeExtractedCases(cases: ExtractedGrammarCase[]): Array<{
  caseKey: string;
  label: string;
  ruleSummary: string;
  generationHint: string;
  baseWeight: number;
}> {
  const used = new Set<string>();
  const normalized: Array<{
    caseKey: string;
    label: string;
    ruleSummary: string;
    generationHint: string;
    baseWeight: number;
  }> = [];

  for (const [index, item] of cases.slice(0, MAX_EXTRACTED_CASES).entries()) {
    const fallback = index === 0 && cases.length === 1 ? 'general' : `case_${index + 1}`;
    let caseKey = normalizeCaseKey(item.caseKey, fallback);
    if (used.has(caseKey)) {
      const base = caseKey;
      let suffix = 2;
      while (used.has(`${base}_${suffix}`)) suffix++;
      caseKey = `${base}_${suffix}`;
    }
    used.add(caseKey);

    const label = item.label?.trim() || caseKey.replace(/_/g, ' ');
    const ruleSummary = item.ruleSummary?.trim() || `Practice ${label}.`;
    const generationHint = item.generationHint?.trim() || `Generate a card that tests ${label}.`;
    const importance = typeof item.importance === 'number' && Number.isFinite(item.importance)
      ? item.importance
      : 1;

    normalized.push({
      caseKey,
      label,
      ruleSummary,
      generationHint,
      baseWeight: clamp(importance, 0.5, 2),
    });
  }

  return normalized.length > 0
    ? normalized
    : [{
      caseKey: 'general',
      label: 'General pattern',
      ruleSummary: 'Practice the core grammar pattern.',
      generationHint: 'Generate a card that tests the core grammar pattern.',
      baseWeight: 1,
    }];
}

function toTarget(row: GrammarCaseRow): GrammarCaseTarget {
  return {
    id: row.id,
    caseKey: row.caseKey,
    label: row.label,
    ruleSummary: row.ruleSummary,
    generationHint: row.generationHint,
    baseWeight: row.baseWeight,
  };
}

async function persistCases(
  deckId: string,
  sourceHash: string,
  cases: ReturnType<typeof normalizeExtractedCases>,
): Promise<GrammarCaseTarget[]> {
  await prisma.$transaction(async (tx) => {
    await tx.grammarCase.deleteMany({ where: { deckId } });

    for (const [sortOrder, item] of cases.entries()) {
      await tx.grammarCase.create({
        data: {
          deckId,
          caseKey: item.caseKey,
          label: item.label,
          ruleSummary: item.ruleSummary,
          generationHint: item.generationHint,
          baseWeight: item.baseWeight,
          sourceHash,
          active: true,
          sortOrder,
        },
      });
    }
  });

  const rows = await prisma.grammarCase.findMany({
    where: { deckId, active: true, sourceHash },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toTarget);
}

async function persistFallbackCase(deckId: string, sourceHash: string): Promise<GrammarCaseTarget[]> {
  return persistCases(deckId, sourceHash, [{
    caseKey: 'general',
    label: 'General pattern',
    ruleSummary: 'Practice the core grammar pattern.',
    generationHint: 'Generate a card that tests the core grammar pattern for this deck.',
    baseWeight: 1,
  }]);
}

export async function ensureGrammarCasesForDeck(
  userId: string,
  deckId: string,
  analyticsContext?: AiAnalyticsContext,
): Promise<GrammarCaseTarget[]> {
  const deck = await prisma.deck.findFirst({
    where: { nodeId: deckId, node: { userId } },
    select: {
      nodeId: true,
      topic: true,
      language: true,
      explanation: true,
      grammarCases: {
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');
  if (!deck.explanation?.trim()) return [];

  const sourceHash = sourceHashFor(deck.topic, deck.language, deck.explanation);
  const activeCases = deck.grammarCases as GrammarCaseRow[];
  if (activeCases.length > 0 && activeCases.every(c => c.sourceHash === sourceHash)) {
    return activeCases.map(toTarget);
  }

  const promiseKey = `${deckId}:${sourceHash}`;
  const existing = extractionPromises.get(promiseKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { extractGrammarCases } = await import('./claude.service.js');
      const extracted = await extractGrammarCases(
        userId,
        deck.topic,
        deck.language,
        deck.explanation!,
        {
          ...analyticsContext,
          deckId,
          deckTopic: analyticsContext?.deckTopic ?? deck.topic,
          language: analyticsContext?.language ?? deck.language,
          traceId: analyticsContext?.traceId ?? `case_extraction:${deckId}`,
        },
      );
      const cases = normalizeExtractedCases(extracted);
      return persistCases(deckId, sourceHash, cases);
    } catch (error) {
      captureException(error, userId, {
        endpoint: 'case-extraction',
        deck_id: deckId,
        language: deck.language,
      });
      capture(userId, 'grammar_case_extraction_failed', {
        deck_id: deckId,
        deck_topic: deck.topic,
        language: deck.language,
        error_message: error instanceof Error ? error.message : String(error),
      });
      return persistFallbackCase(deckId, sourceHash);
    }
  })().finally(() => {
    extractionPromises.delete(promiseKey);
  });

  extractionPromises.set(promiseKey, promise);
  return promise;
}

export async function regenerateGrammarCasesForDeck(
  userId: string,
  deckId: string,
  analyticsContext?: AiAnalyticsContext,
): Promise<GrammarCaseTarget[]> {
  const deck = await prisma.deck.findFirst({
    where: { nodeId: deckId, node: { userId } },
    select: { topic: true, language: true, explanation: true },
  });
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');
  if (!deck.explanation?.trim()) return [];

  const sourceHash = sourceHashFor(deck.topic, deck.language, deck.explanation);
  try {
    const { extractGrammarCases } = await import('./claude.service.js');
    const extracted = await extractGrammarCases(
      userId,
      deck.topic,
      deck.language,
      deck.explanation,
      {
        ...analyticsContext,
        deckId,
        deckTopic: analyticsContext?.deckTopic ?? deck.topic,
        language: analyticsContext?.language ?? deck.language,
        traceId: analyticsContext?.traceId ?? `case_extraction:${deckId}`,
      },
    );
    return persistCases(deckId, sourceHash, normalizeExtractedCases(extracted));
  } catch (error) {
    captureException(error, userId, {
      endpoint: 'case-extraction',
      deck_id: deckId,
      language: deck.language,
    });
    capture(userId, 'grammar_case_extraction_failed', {
      deck_id: deckId,
      deck_topic: deck.topic,
      language: deck.language,
      error_message: error instanceof Error ? error.message : String(error),
    });
    return persistFallbackCase(deckId, sourceHash);
  }
}

function decayedStat(
  stat: {
    difficultyMass: number;
    attemptMass: number;
    lastUpdatedIteration: number | null;
    lastPracticedIteration: number | null;
    seenCount: number;
  } | undefined,
  currentIteration: number,
): {
  difficulty: number;
  decayedAttemptMass: number;
  stalenessIterations: number;
} {
  if (!stat) {
    return {
      difficulty: PRIOR_DIFFICULTY,
      decayedAttemptMass: 0,
      stalenessIterations: currentIteration + 1,
    };
  }

  const updatedAt = stat.lastUpdatedIteration ?? currentIteration;
  const iterationDelta = Math.max(0, currentIteration - updatedAt);
  const decay = Math.pow(0.5, iterationDelta / HALF_LIFE_ITERATIONS);
  const decayedDifficultyMass = stat.difficultyMass * decay;
  const decayedAttemptMass = stat.attemptMass * decay;
  const difficulty = ((PRIOR_DIFFICULTY * PRIOR_STRENGTH) + decayedDifficultyMass)
    / (PRIOR_STRENGTH + decayedAttemptMass);
  const practicedAt = stat.lastPracticedIteration ?? -1;

  return {
    difficulty,
    decayedAttemptMass,
    stalenessIterations: practicedAt >= 0 ? Math.max(0, currentIteration - practicedAt) : currentIteration + 1,
  };
}

export async function selectCaseTargets(
  userId: string,
  deckId: string,
  count: number,
  analyticsContext?: AiAnalyticsContext,
): Promise<GrammarCaseTarget[]> {
  const cases = await ensureGrammarCasesForDeck(userId, deckId, analyticsContext);
  if (cases.length === 0 || count <= 0) return [];

  const [currentIteration, stats] = await Promise.all([
    prisma.deckReview.count({ where: { deckId, eventType: 'review' } }),
    prisma.grammarCaseUserStat.findMany({
      where: { userId, grammarCaseId: { in: cases.map(c => c.id) } },
    }),
  ]);

  const statByCaseId = new Map(stats.map(s => [s.grammarCaseId, s]));
  const totalSeen = cases.reduce((sum, item) => sum + (statByCaseId.get(item.id)?.seenCount ?? 0), 0);
  const averageSeen = totalSeen / cases.length;

  const scored = cases.map((item, index) => {
    const stat = statByCaseId.get(item.id);
    const seenCount = stat?.seenCount ?? 0;
    const decayed = decayedStat(stat, currentIteration);
    const weightedTargetSeen = Math.max(1, averageSeen * item.baseWeight);
    const coverageDebt = Math.max(0, weightedTargetSeen - seenCount);
    const unseenBoost = seenCount === 0 ? 8 : 0;
    const weaknessBoost = Math.max(0, decayed.difficulty - PRIOR_DIFFICULTY) * 8;
    const stalenessBoost = Math.min(3, decayed.stalenessIterations / 2);
    const uncertaintyBoost = 1 / Math.sqrt(1 + decayed.decayedAttemptMass);
    const importanceBoost = Math.log2(1 + item.baseWeight);
    const recentRepeatPenalty = stat?.lastPracticedIteration === currentIteration ? 1.5 : 0;
    const priority = unseenBoost
      + (coverageDebt * 2)
      + weaknessBoost
      + stalenessBoost
      + uncertaintyBoost
      + importanceBoost
      - recentRepeatPenalty;

    return { item, index, priority };
  }).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.index - b.index;
  });

  const unique = scored.slice(0, Math.min(count, cases.length)).map(s => s.item);
  if (count <= cases.length) return unique;

  const targets = [...unique];
  while (targets.length < count) {
    targets.push(scored[(targets.length - unique.length) % scored.length].item);
  }
  return targets;
}

export async function getGrammarCaseSummaries(
  userId: string,
  deckId: string,
  opts: { ensure?: boolean; sort?: 'order' | 'difficulty' } = {},
): Promise<GrammarCaseSummary[]> {
  const cases = opts.ensure
    ? await ensureGrammarCasesForDeck(userId, deckId)
    : (await prisma.grammarCase.findMany({
      where: { deckId, active: true, deck: { node: { userId } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })).map(toTarget);
  if (cases.length === 0) return [];

  const [currentIteration, stats] = await Promise.all([
    prisma.deckReview.count({ where: { deckId, eventType: 'review' } }),
    prisma.grammarCaseUserStat.findMany({
      where: { userId, grammarCaseId: { in: cases.map(c => c.id) } },
    }),
  ]);
  const statByCaseId = new Map(stats.map(s => [s.grammarCaseId, s]));
  const summaries = cases.map((item) => {
    const stat = statByCaseId.get(item.id);
    return {
      ...item,
      difficulty: decayedStat(stat, currentIteration).difficulty,
      seenCount: stat?.seenCount ?? 0,
      correctFirstTryCount: stat?.correctFirstTryCount ?? 0,
      lastPracticedIteration: stat?.lastPracticedIteration ?? null,
    };
  });

  if (opts.sort === 'difficulty') {
    summaries.sort((a, b) => {
      if (b.difficulty !== a.difficulty) return b.difficulty - a.difficulty;
      return b.seenCount - a.seenCount;
    });
  }
  return summaries;
}

function evidenceFromAnswers(answers: string[] | undefined): {
  evidence: number;
  correctFirstTry: boolean;
} {
  const answerCount = Math.max(1, answers?.length ?? 1);
  const wrongAttempts = Math.max(0, answerCount - 1);
  if (wrongAttempts === 0) return { evidence: 0.05, correctFirstTry: true };
  if (wrongAttempts === 1) return { evidence: 0.65, correctFirstTry: false };
  return {
    evidence: clamp(0.65 + (0.15 * (wrongAttempts - 1)), 0, 1),
    correctFirstTry: false,
  };
}

export async function persistImportedCases(
  deckId: string,
  topic: string,
  language: string,
  explanation: string,
  rawCases: ExtractedGrammarCase[],
): Promise<void> {
  const sourceHash = sourceHashFor(topic, language, explanation);
  const cases = normalizeExtractedCases(rawCases);
  await persistCases(deckId, sourceHash, cases);
}

export async function updateCaseStatsFromReview(
  tx: GrammarCaseTx,
  userId: string,
  deckId: string,
  attempts: GrammarCaseReviewAttempt[],
  reviewIteration: number,
): Promise<void> {
  const usableAttempts = attempts.filter(a => a.grammarCaseId || a.grammarCaseKey);
  if (usableAttempts.length === 0) return;

  const caseIds = usableAttempts
    .map(a => a.grammarCaseId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const caseKeys = usableAttempts
    .map(a => a.grammarCaseKey)
    .filter((key): key is string => typeof key === 'string' && key.length > 0);

  const matchingCases = await tx.grammarCase.findMany({
    where: {
      deckId,
      OR: [
        ...(caseIds.length > 0 ? [{ id: { in: caseIds } }] : []),
        ...(caseKeys.length > 0 ? [{ caseKey: { in: caseKeys } }] : []),
      ],
    },
    select: { id: true, caseKey: true },
  });
  const idSet = new Set(matchingCases.map(c => c.id));
  const idByKey = new Map(matchingCases.map(c => [c.caseKey, c.id]));

  for (const attempt of usableAttempts) {
    const grammarCaseId = attempt.grammarCaseId && idSet.has(attempt.grammarCaseId)
      ? attempt.grammarCaseId
      : attempt.grammarCaseKey
        ? idByKey.get(attempt.grammarCaseKey)
        : undefined;
    if (!grammarCaseId) continue;

    const existing = await tx.grammarCaseUserStat.findUnique({
      where: { userId_grammarCaseId: { userId, grammarCaseId } },
    });
    const updatedAt = existing?.lastUpdatedIteration ?? reviewIteration;
    const iterationDelta = Math.max(0, reviewIteration - updatedAt);
    const decay = Math.pow(0.5, iterationDelta / HALF_LIFE_ITERATIONS);
    const { evidence, correctFirstTry } = evidenceFromAnswers(attempt.answers);

    await tx.grammarCaseUserStat.upsert({
      where: { userId_grammarCaseId: { userId, grammarCaseId } },
      update: {
        seenCount: { increment: 1 },
        correctFirstTryCount: { increment: correctFirstTry ? 1 : 0 },
        difficultyMass: ((existing?.difficultyMass ?? 0) * decay) + evidence,
        attemptMass: ((existing?.attemptMass ?? 0) * decay) + 1,
        lastPracticedIteration: reviewIteration,
        lastUpdatedIteration: reviewIteration,
      },
      create: {
        userId,
        grammarCaseId,
        seenCount: 1,
        correctFirstTryCount: correctFirstTry ? 1 : 0,
        difficultyMass: evidence,
        attemptMass: 1,
        lastPracticedIteration: reviewIteration,
        lastUpdatedIteration: reviewIteration,
      },
    });
  }
}
