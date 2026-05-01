import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { DeckData } from '../types/index.js';
import { getSetting } from './settings.service.js';
import {
  buildSrsConfig,
  calculateNextReview,
  computeIntervalDaysForDueDate,
  dueDateStringToDueAt,
  isDueNow,
  resolveDueAt,
  type StudyMode,
} from './srs.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findChildByName(userId: string, parentId: string | null, name: string) {
  return prisma.node.findFirst({
    where: { userId, parentId, name },
  });
}

async function getNextSortOrder(userId: string, parentId: string | null): Promise<number> {
  const max = await prisma.node.aggregate({
    where: { userId, parentId },
    _max: { sortOrder: true },
  });
  return (max._max.sortOrder ?? -1) + 1;
}

function mapDeckRow(deck: {
  nodeId: string; topic: string; clarification: string | null; language: string;
  explanation: string | null; explanationStatus: string;
  cardCount: number; lastStudiedAt: Date | null;
  dueAt: Date | null; intervalDays: number;
}, srsConfig: { dailyDueTime: string; reviewTimezone: string }): DeckData {
  const resolvedDueAt = resolveDueAt(deck.dueAt);
  return {
    nodeId: deck.nodeId,
    topic: deck.topic,
    clarification: deck.clarification,
    language: deck.language,
    explanation: deck.explanation,
    explanationStatus: deck.explanationStatus as DeckData['explanationStatus'],
    cardCount: deck.cardCount,
    lastStudiedAt: deck.lastStudiedAt?.toISOString() ?? null,
    dueAt: resolvedDueAt,
    isDue: isDueNow(resolvedDueAt, srsConfig),
    intervalDays: deck.intervalDays,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createDeckFromPath(
  userId: string,
  path: string,
  topic: string,
  language: string,
  cardCount = 0,
  clarification?: string,
  explanation?: string,
): Promise<string> {
  const segments = path.split('::').map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) throw new AppError(400, 'INVALID_PATH', 'Path cannot be empty.');

  let parentId: string | null = null;

  // Walk/create collection nodes for all segments except last
  for (let i = 0; i < segments.length - 1; i++) {
    const name = segments[i];
    const existing = await findChildByName(userId, parentId, name);
    if (existing) {
      parentId = existing.id;
    } else {
      const nextOrder = await getNextSortOrder(userId, parentId);
      const created: { id: string } = await prisma.node.create({
        data: { userId, parentId, name, sortOrder: nextOrder },
      });
      parentId = created.id;
    }
  }

  // Create the deck node
  const deckName = segments[segments.length - 1];
  const existingSibling = await findChildByName(userId, parentId, deckName);
  if (existingSibling) {
    const deck = await prisma.deck.findUnique({ where: { nodeId: existingSibling.id } });
    if (deck) throw new AppError(409, 'DUPLICATE', `A deck at "${path}" already exists.`);
    throw new AppError(409, 'DUPLICATE', `A collection named "${deckName}" already exists at this location.`);
  }

  const nextOrder = await getNextSortOrder(userId, parentId);
  const created: { id: string } = await prisma.node.create({
    data: {
      userId, parentId, name: deckName, sortOrder: nextOrder,
      deck: {
        create: {
          topic,
          clarification: clarification?.trim() ? clarification : null,
          language,
          cardCount,
          ...(explanation !== undefined ? { explanation, explanationStatus: 'ready' } : {}),
        },
      },
    },
    include: { deck: true },
  });

  return created.id;
}

export async function getDeck(userId: string, nodeId: string): Promise<DeckData | null> {
  const [node, dailyDueTime, reviewTimezone] = await Promise.all([
    prisma.node.findFirst({
      where: { id: nodeId, userId },
      include: { deck: true },
    }),
    getSetting(userId, 'daily_due_time'),
    getSetting(userId, 'review_timezone'),
  ]);
  if (!node?.deck) return null;
  return mapDeckRow(node.deck, buildSrsConfig(dailyDueTime, reviewTimezone));
}

export async function updateDeck(
  userId: string,
  nodeId: string,
  updates: { name?: string; topic?: string; clarification?: string | null; language?: string; cardCount?: number; explanation?: string },
): Promise<{ regenerateExplanation: boolean }> {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, userId },
    include: { deck: true },
  });
  if (!node?.deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');

  let regenerate = false;

  if (updates.name !== undefined) {
    await prisma.node.update({ where: { id: nodeId }, data: { name: updates.name } });
  }

  if (
    updates.topic !== undefined ||
    updates.clarification !== undefined ||
    updates.language !== undefined ||
    updates.cardCount !== undefined
  ) {
    const newTopic = updates.topic ?? node.deck.topic;
    const newClarification = updates.clarification !== undefined
      ? (updates.clarification?.trim() ? updates.clarification : null)
      : node.deck.clarification;
    const newLang = updates.language ?? node.deck.language;
    const newCount = updates.cardCount ?? node.deck.cardCount;
    regenerate = newTopic !== node.deck.topic || newClarification !== node.deck.clarification || newLang !== node.deck.language;

    await prisma.deck.update({
      where: { nodeId },
      data: {
        topic: newTopic,
        clarification: newClarification,
        language: newLang,
        cardCount: newCount,
        ...(regenerate
          ? { explanationStatus: 'pending', explanation: null }
          : updates.explanation !== undefined
            ? { explanation: updates.explanation, explanationStatus: 'ready' }
            : {}),
      },
    });
  } else if (updates.explanation !== undefined) {
    await prisma.deck.update({
      where: { nodeId },
      data: { explanation: updates.explanation, explanationStatus: 'ready' },
    });
  }

  return { regenerateExplanation: regenerate };
}

export async function renameCollection(userId: string, nodeId: string, newName: string): Promise<void> {
  const node = await prisma.node.findFirst({ where: { id: nodeId, userId } });
  if (!node) throw new AppError(404, 'NOT_FOUND', 'Node not found.');
  await prisma.node.update({ where: { id: nodeId }, data: { name: newName } });
}

export async function moveNode(userId: string, nodeId: string, newPath: string): Promise<void> {
  const segments = newPath.split('::').map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) throw new AppError(400, 'INVALID_PATH', 'Path cannot be empty.');

  const newName = segments[segments.length - 1];
  let newParentId: string | null = null;

  // Walk/create parent collection nodes
  for (let i = 0; i < segments.length - 1; i++) {
    const name = segments[i];
    const existing = await findChildByName(userId, newParentId, name);
    if (existing) {
      newParentId = existing.id;
    } else {
      const nextOrder = await getNextSortOrder(userId, newParentId);
      const created: { id: string } = await prisma.node.create({
        data: { userId, parentId: newParentId, name, sortOrder: nextOrder },
      });
      newParentId = created.id;
    }
  }

  // Get old parent
  const oldNode = await prisma.node.findFirst({ where: { id: nodeId, userId } });
  if (!oldNode) throw new AppError(404, 'NOT_FOUND', 'Node not found.');
  const oldParentId = oldNode.parentId;

  // Check for conflicts
  const existingSibling = await findChildByName(userId, newParentId, newName);
  if (existingSibling && existingSibling.id !== nodeId) {
    const movingIsDeck = await prisma.deck.findUnique({ where: { nodeId } });
    if (movingIsDeck) {
      throw new AppError(409, 'CONFLICT', `A node named "${newName}" already exists at this location.`);
    }

    const targetIsDeck = await prisma.deck.findUnique({ where: { nodeId: existingSibling.id } });
    if (targetIsDeck) {
      throw new AppError(409, 'CONFLICT', `Cannot merge collection into deck "${newName}".`);
    }

    // Both collections — merge
    await prisma.node.updateMany({
      where: { parentId: nodeId },
      data: { parentId: existingSibling.id },
    });
    await prisma.node.delete({ where: { id: nodeId } });

    if (oldParentId !== newParentId) {
      await cleanupEmptyAncestors(userId, oldParentId);
    }
    return;
  }

  // Simple move
  const nextOrder = await getNextSortOrder(userId, newParentId);
  await prisma.node.update({
    where: { id: nodeId },
    data: { name: newName, parentId: newParentId, sortOrder: nextOrder },
  });

  if (oldParentId !== newParentId) {
    await cleanupEmptyAncestors(userId, oldParentId);
  }
}

async function cleanupEmptyAncestors(userId: string, parentId: string | null): Promise<void> {
  let currentId = parentId;
  while (currentId) {
    const childCount = await prisma.node.count({ where: { parentId: currentId } });
    if (childCount > 0) break;

    const isDeck = await prisma.deck.findUnique({ where: { nodeId: currentId } });
    if (isDeck) break;

    const node = await prisma.node.findFirst({
      where: { id: currentId, userId },
      select: { parentId: true },
    });
    const nextParent = node?.parentId ?? null;
    await prisma.node.delete({ where: { id: currentId } });
    currentId = nextParent;
  }
}

export async function deleteNode(userId: string, nodeId: string): Promise<void> {
  const node = await prisma.node.findFirst({ where: { id: nodeId, userId } });
  if (!node) throw new AppError(404, 'NOT_FOUND', 'Node not found.');
  await prisma.node.delete({ where: { id: nodeId } });
}

export async function setExplanation(nodeId: string, explanation: string): Promise<void> {
  await prisma.deck.update({
    where: { nodeId },
    data: { explanation, explanationStatus: 'ready' },
  });
}

export async function setExplanationError(nodeId: string): Promise<void> {
  await prisma.deck.update({
    where: { nodeId },
    data: { explanationStatus: 'error' },
  });
}

export async function setExplanationGenerating(nodeId: string): Promise<void> {
  await prisma.deck.update({
    where: { nodeId },
    data: { explanationStatus: 'generating' },
  });
}

export async function setLastStudied(nodeId: string): Promise<void> {
  await prisma.deck.update({
    where: { nodeId },
    data: { lastStudiedAt: new Date() },
  });
}

export async function updateDeckSchedule(
  userId: string,
  nodeId: string,
  action:
    | { action: 'reset_never_studied' }
    | { action: 'set_due_date'; dueDate: string; clientTimezone?: string },
): Promise<void> {
  const node = await prisma.node.findFirst({
    where: { id: nodeId, userId },
    include: { deck: true },
  });
  if (!node?.deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');

  if (action.action === 'reset_never_studied') {
    await prisma.deck.update({
      where: { nodeId },
      data: { dueAt: null, intervalDays: 1 },
    });
    return;
  }

  const dueDate = action.dueDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new AppError(400, 'INVALID_DUE_DATE', 'dueDate must be YYYY-MM-DD.');
  }

  const dailyDueTime = await getSetting(userId, 'daily_due_time');
  const reviewTimezone = action.clientTimezone ?? await getSetting(userId, 'review_timezone');
  const config = buildSrsConfig(dailyDueTime, reviewTimezone);
  const dueAt = dueDateStringToDueAt(dueDate, config);
  if (!dueAt) {
    throw new AppError(400, 'INVALID_DUE_DATE', 'Unable to parse dueDate.');
  }

  const intervalDays = computeIntervalDaysForDueDate(dueDate, config);
  await prisma.$transaction(async (tx) => {
    if (action.clientTimezone && action.clientTimezone.trim().length > 0) {
      await tx.setting.upsert({
        where: { userId_key: { userId, key: 'review_timezone' } },
        update: { value: config.reviewTimezone },
        create: { userId, key: 'review_timezone', value: config.reviewTimezone },
      });
    }
    await tx.deck.update({
      where: { nodeId },
      data: { dueAt, intervalDays },
    });
  });
}

export async function saveDeckReview(
  userId: string,
  nodeId: string,
  userStars: 1 | 2 | 3 | 4 | 5,
  aiStars: number,
  aiRecap: string,
  studyMode: StudyMode,
): Promise<{ dueAt: number; nextIntervalDays: number }> {
  const deck = await prisma.deck.findFirst({
    where: { nodeId, node: { userId } },
    select: { intervalDays: true, dueAt: true },
  });
  if (!deck) throw new AppError(404, 'NOT_FOUND', 'Deck not found.');

  const now = new Date();
  const [dailyDueTime, reviewTimezone] = await Promise.all([
    getSetting(userId, 'daily_due_time'),
    getSetting(userId, 'review_timezone'),
  ]);
  const config = buildSrsConfig(dailyDueTime, reviewTimezone);
  const resolvedDueAt = resolveDueAt(deck.dueAt);
  const currentlyDue = isDueNow(resolvedDueAt, config, now);

  const { nextIntervalDays, dueAt } = calculateNextReview(userStars, deck.intervalDays, {
    studyMode,
    config,
    now,
    // Defensive cap: never allow early-study growth, even if caller sends scheduled.
    forceEarlyMultipliers: !currentlyDue,
  });

  await prisma.$transaction([
    prisma.deck.update({
      where: { nodeId },
      data: { lastStudiedAt: now, dueAt, intervalDays: nextIntervalDays },
    }),
    prisma.deckReview.create({
      data: {
        deckId: nodeId,
        aiStars,
        userStars,
        aiRecap,
        intervalApplied: nextIntervalDays,
      },
    }),
  ]);

  return { dueAt: dueAt.getTime(), nextIntervalDays };
}
