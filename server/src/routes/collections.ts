import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { renameCollection, moveNode, deleteNode, getDeck } from '../services/deck.service.js';
import { getDescendantDeckIds, getNodePath } from '../services/tree.service.js';
import { capture } from '../services/analytics.service.js';

export const collectionsRouter = Router();

collectionsRouter.use(requireAuth);

collectionsRouter.patch('/:nodeId', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (name) await renameCollection(req.userId!, req.params.nodeId, name);
    res.json({ success: true });
  } catch (e) { next(e); }
});

collectionsRouter.post('/:id/move', async (req, res, next) => {
  try {
    const { newPath } = req.body;
    await moveNode(req.userId!, req.params.id, newPath);
    res.json({ success: true });
  } catch (e) { next(e); }
});

collectionsRouter.delete('/:id', async (req, res, next) => {
  try {
    const [deck, path] = await Promise.all([
      getDeck(req.userId!, req.params.id).catch(() => null),
      getNodePath(req.userId!, req.params.id).catch(() => null),
    ]);
    await deleteNode(req.userId!, req.params.id);
    capture(req.userId!, deck ? 'deck_deleted' : 'collection_deleted', {
      deck_id: deck ? req.params.id : undefined,
      app_session_id: req.appSessionId,
      deck_name: path?.split('::').pop(),
      deck_topic: deck?.topic,
      language: deck?.language,
      collection_path: path?.split('::').slice(0, -1).join('::') || undefined,
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});

collectionsRouter.get('/:id/descendant-deck-ids', async (req, res, next) => {
  try {
    const deckIds = await getDescendantDeckIds(req.userId!, req.params.id);
    res.json({ deckIds });
  } catch (e) { next(e); }
});
