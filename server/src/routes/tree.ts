import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getTree, getNode, getNodePath, getDescendantDeckIds, getExportRows, getCollectionReviews } from '../services/tree.service.js';
import { getNewDecksStartedToday } from '../services/deck.service.js';
import { createHash } from 'crypto';

export const treeRouter = Router();

treeRouter.use(requireAuth);

treeRouter.get('/', async (req, res, next) => {
  try {
    const hashOnly = req.query.hashOnly === 'true';
    const [tree, newDecksStartedToday] = await Promise.all([
      getTree(req.userId!),
      getNewDecksStartedToday(req.userId!),
    ]);
    if (hashOnly) {
      const hash = createHash('sha256').update(JSON.stringify({ tree, newDecksStartedToday })).digest('hex');
      res.json({ hash });
    } else {
      res.json({ tree, newDecksStartedToday });
    }
  } catch (e) { next(e); }
});

treeRouter.get('/:id', async (req, res, next) => {
  try {
    const node = await getNode(req.userId!, req.params.id);
    if (!node) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found.' } }); return; }
    res.json(node);
  } catch (e) { next(e); }
});

treeRouter.get('/:id/path', async (req, res, next) => {
  try {
    const path = await getNodePath(req.userId!, req.params.id);
    res.json({ path });
  } catch (e) { next(e); }
});

treeRouter.get('/:id/descendant-deck-ids', async (req, res, next) => {
  try {
    const deckIds = await getDescendantDeckIds(req.userId!, req.params.id);
    res.json({ deckIds });
  } catch (e) { next(e); }
});

treeRouter.get('/:id/reviews', async (req, res, next) => {
  try {
    const result = await getCollectionReviews(req.userId!, req.params.id);
    res.json(result);
  } catch (e) { next(e); }
});

treeRouter.get('/:id/export-csv', async (req, res, next) => {
  try {
    const { filename, rows } = await getExportRows(req.userId!, req.params.id);
    const escape = (s: string) => s.replace(/\r\n|\r|\n/g, '\\n');
    const lines = ['DeckName\tTopic\tClarification\tExplanation\tCases'];
    for (const row of rows) {
      lines.push(`${escape(row.deckName)}\t${escape(row.topic)}\t${escape(row.clarification)}\t${escape(row.explanation)}\t${row.cases}`);
    }
    res.json({ filename, csv: lines.join('\n') });
  } catch (e) { next(e); }
});
