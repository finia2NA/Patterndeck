import { prisma } from '../lib/prisma.js';
import type { TreeNode, DeckData } from '../types/index.js';
import { getSetting } from './settings.service.js';
import { buildSrsConfig, isDueNow, resolveDueAt } from './srs.service.js';

// Deck select used by tree queries — omits explanation to keep responses small.
const DECK_TREE_SELECT = {
  nodeId: true, topic: true, clarification: true, language: true,
  explanationStatus: true, grammarCaseStatus: true, cardCount: true,
  lastStudiedAt: true, dueAt: true, intervalDays: true,
} as const;

type DeckTreeRow = {
  nodeId: string; topic: string; clarification: string | null; language: string;
  explanationStatus: string; grammarCaseStatus: string; cardCount: number;
  lastStudiedAt: Date | null; dueAt: Date | null; intervalDays: number;
};

function mapDeckWithDue(deck: DeckTreeRow, srsConfig: { dailyDueTime: string; reviewTimezone: string }): DeckData {
  const dueAt = resolveDueAt(deck.dueAt);
  return {
    nodeId: deck.nodeId,
    topic: deck.topic,
    clarification: deck.clarification,
    language: deck.language,
    explanation: null,
    explanationStatus: deck.explanationStatus as DeckData['explanationStatus'],
    grammarCaseStatus: deck.grammarCaseStatus as DeckData['grammarCaseStatus'],
    cardCount: deck.cardCount,
    lastStudiedAt: deck.lastStudiedAt?.toISOString() ?? null,
    dueAt,
    isDue: isDueNow(dueAt, srsConfig),
    intervalDays: deck.intervalDays,
  };
}

function mapNode(node: {
  id: string; parentId: string | null; name: string; sortOrder: number;
  createdAt: Date; updatedAt: Date; deck: DeckData | null;
}, children: TreeNode[] = []): TreeNode {
  return {
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    sortOrder: node.sortOrder,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    deck: node.deck,
    children,
  };
}

export async function getTree(userId: string): Promise<TreeNode[]> {
  const [nodes, dailyDueTime, reviewTimezone] = await Promise.all([
    prisma.node.findMany({
      where: { userId },
      include: { deck: { select: DECK_TREE_SELECT } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    getSetting(userId, 'daily_due_time'),
    getSetting(userId, 'review_timezone'),
  ]);
  const srsConfig = buildSrsConfig(dailyDueTime, reviewTimezone);

  const treeMap = new Map<string, TreeNode>();
  for (const n of nodes) {
    treeMap.set(n.id, mapNode({ ...n, deck: n.deck ? mapDeckWithDue(n.deck as DeckTreeRow, srsConfig) : null }));
  }

  const roots: TreeNode[] = [];
  for (const node of treeMap.values()) {
    if (node.parentId && treeMap.has(node.parentId)) {
      treeMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function getNode(userId: string, nodeId: string): Promise<TreeNode | null> {
  const [node, dailyDueTime, reviewTimezone] = await Promise.all([
    prisma.node.findFirst({
      where: { id: nodeId, userId },
      include: {
        deck: { select: DECK_TREE_SELECT },
        children: {
          include: { deck: { select: DECK_TREE_SELECT } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    }),
    getSetting(userId, 'daily_due_time'),
    getSetting(userId, 'review_timezone'),
  ]);

  if (!node) return null;
  const srsConfig = buildSrsConfig(dailyDueTime, reviewTimezone);

  return mapNode(
    { ...node, deck: node.deck ? mapDeckWithDue(node.deck as DeckTreeRow, srsConfig) : null },
    node.children.map(c => mapNode({ ...c, deck: c.deck ? mapDeckWithDue(c.deck as DeckTreeRow, srsConfig) : null })),
  );
}

export async function getNodePath(userId: string, nodeId: string): Promise<string> {
  const parts: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId) {
    const found: { name: string; parentId: string | null } | null = await prisma.node.findFirst({
      where: { id: currentId, userId },
      select: { name: true, parentId: true },
    });
    if (!found) break;
    parts.unshift(found.name);
    currentId = found.parentId;
  }

  return parts.join('::');
}

interface ExportCase { caseKey: string; label: string; ruleSummary: string; generationHint: string; baseWeight: number; }
interface ExportRow { deckName: string; topic: string; clarification: string; explanation: string; cases: string; }

/** BFS to collect all nodes, then DFS to build export rows with relative paths. */
export async function getExportRows(
  userId: string,
  nodeId: string,
): Promise<{ filename: string; rows: ExportRow[] }> {
  const pathStr = await getNodePath(userId, nodeId);
  if (!pathStr) throw new Error('Node not found');

  const filename = pathStr.replace(/::/g, '__') + '.csv';

  const allNodes: Array<{
    id: string; parentId: string | null; name: string;
    deck: { topic: string; clarification: string | null; explanation: string | null; grammarCases: ExportCase[] } | null;
    childIds: string[];
  }> = [];

  const queue = [nodeId];
  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);
    const nodes = await prisma.node.findMany({
      where: { id: { in: batch }, userId },
      include: {
        deck: {
          select: {
            topic: true, clarification: true, explanation: true,
            grammarCases: {
              where: { active: true },
              orderBy: [{ sortOrder: 'asc' }],
              select: { caseKey: true, label: true, ruleSummary: true, generationHint: true, baseWeight: true },
            },
          },
        },
        children: { select: { id: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    for (const node of nodes) {
      allNodes.push({
        id: node.id, parentId: node.parentId, name: node.name,
        deck: node.deck ? {
          topic: node.deck.topic,
          clarification: node.deck.clarification,
          explanation: node.deck.explanation,
          grammarCases: node.deck.grammarCases as ExportCase[],
        } : null,
        childIds: node.children.map(c => c.id),
      });
      for (const child of node.children) queue.push(child.id);
    }
  }

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const startNode = nodeMap.get(nodeId);
  if (!startNode) throw new Error('Node not found');

  function getRelativePath(id: string): string {
    const parts: string[] = [];
    let cur = nodeMap.get(id);
    while (cur && cur.id !== nodeId) {
      parts.unshift(cur.name);
      cur = cur.parentId ? nodeMap.get(cur.parentId) : undefined;
    }
    return parts.join('::');
  }

  const rows: ExportRow[] = [];

  function serializeCases(cases: ExportCase[]): string {
    if (cases.length === 0) return '';
    return JSON.stringify(cases.map(c => ({
      caseKey: c.caseKey, label: c.label, ruleSummary: c.ruleSummary,
      generationHint: c.generationHint, baseWeight: c.baseWeight,
    })));
  }

  if (startNode.deck) {
    rows.push({
      deckName: startNode.name,
      topic: startNode.deck.topic,
      clarification: startNode.deck.clarification ?? '',
      explanation: startNode.deck.explanation ?? '',
      cases: serializeCases(startNode.deck.grammarCases),
    });
  } else {
    function dfs(id: string) {
      const node = nodeMap.get(id);
      if (!node) return;
      if (node.deck) {
        rows.push({
          deckName: getRelativePath(id),
          topic: node.deck.topic,
          clarification: node.deck.clarification ?? '',
          explanation: node.deck.explanation ?? '',
          cases: serializeCases(node.deck.grammarCases),
        });
      }
      for (const childId of node.childIds) dfs(childId);
    }
    for (const childId of startNode.childIds) dfs(childId);
  }

  return { filename, rows };
}

/** Iterative BFS to get all descendant deck IDs. */
export async function getDescendantDeckIds(userId: string, nodeId: string): Promise<string[]> {
  const deckIds: string[] = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const batch = queue.splice(0, queue.length);

    const nodes = await prisma.node.findMany({
      where: { id: { in: batch }, userId },
      include: { deck: true, children: { select: { id: true } } },
    });

    for (const node of nodes) {
      if (node.deck) deckIds.push(node.id);
      for (const child of node.children) {
        queue.push(child.id);
      }
    }
  }

  return deckIds;
}

export async function getCollectionReviews(userId: string, nodeId: string) {
  const deckIds = await getDescendantDeckIds(userId, nodeId);
  if (deckIds.length === 0) return { decks: [], reviews: [] };

  const [reviews, nodes] = await Promise.all([
    prisma.deckReview.findMany({
      where: { deckId: { in: deckIds } },
      orderBy: { studiedAt: 'desc' },
    }),
    prisma.node.findMany({
      where: { id: { in: deckIds }, userId },
      select: { id: true, name: true },
    }),
  ]);

  const deckMap = Object.fromEntries(nodes.map(n => [n.id, n.name]));
  return {
    decks: nodes.map(n => ({ id: n.id, name: n.name })),
    reviews: reviews.map(r => ({ ...r, deckName: deckMap[r.deckId] ?? 'Unknown' })),
  };
}
