import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getTree, getNode, getNodePath, getDescendantDeckIds, getExportRows } from '../services/tree.service.js';

export const treeRouter = Router();

treeRouter.use(requireAuth);

treeRouter.get('/', async (req, res, next) => {
  try {
    const tree = await getTree(req.userId!);
    res.json(tree);
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

treeRouter.get('/:id/export-csv', async (req, res, next) => {
  try {
    const { filename, rows } = await getExportRows(req.userId!, req.params.id);
    const escape = (s: string) => s.replace(/\r\n|\r|\n/g, '\\n');
    const lines = ['DeckName\tTopic\tClarification\tExplanation'];
    for (const row of rows) {
      lines.push(`${escape(row.deckName)}\t${escape(row.topic)}\t${escape(row.clarification)}\t${escape(row.explanation)}`);
    }
    res.json({ filename, csv: lines.join('\n') });
  } catch (e) { next(e); }
});
