import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { createDeckFromPath, getDeck, updateDeck, deleteNode, setLastStudied, saveDeckReview, updateDeckSchedule, getDeckReviews } from '../services/deck.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { enqueueExplanation } from '../services/scheduler.service.js';
import { capture } from '../services/analytics.service.js';
import { getNodePath } from '../services/tree.service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const CSV_MAX_DATA_ROWS = 5000;

export const decksRouter = Router();

decksRouter.use(requireAuth);

decksRouter.post('/', async (req, res, next) => {
  try {
    const { path, topic, clarification, language, cardCount, explanation } = req.body;
    if (!path || !topic || !language) {
      throw new AppError(400, 'MISSING_FIELDS', 'path, topic, and language are required.');
    }
    const existingExplanation = typeof explanation === 'string' && explanation.trim().length > 0
      ? explanation
      : undefined;
    const deckClarification = typeof clarification === 'string' && clarification.trim().length > 0
      ? clarification
      : undefined;
    const nodeId = await createDeckFromPath(req.userId!, path, topic, language, cardCount, deckClarification, existingExplanation);

    if (existingExplanation === undefined) {
      enqueueExplanation(req.userId!, nodeId);
    }

    capture(req.userId!, 'deck_created', {
      deck_id: nodeId,
      deck_name: String(path).split('::').pop()?.trim() ?? String(path),
      deck_topic: String(topic),
      app_session_id: req.appSessionId,
      collection_path: String(path).split('::').slice(0, -1).join('::') || undefined,
      language: String(language),
      card_count: Number(cardCount ?? 0),
      has_clarification: deckClarification !== undefined,
      has_existing_explanation: existingExplanation !== undefined,
      creation_source: existingExplanation !== undefined ? 'quick_study_save' : 'manual',
    });

    res.status(201).json({ nodeId });
  } catch (e) { next(e); }
});

// ─── CSV Import ──────────────────────────────────────────────────────────────

interface CsvRow {
  deckName: string;
  topic: string;
  clarification: string;
  explanation: string;
  lineNumber: number;
  rawLine: string;
}

interface CsvSkip {
  lineNumber: number;
  rawLine: string;
  reason: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

const HEADER_VARIANTS: Record<string, string[]> = {
  topic:       ['topic'],
  deckname:    ['deckname', 'name', 'deck'],
  clarification: ['clarification', 'description', 'details', 'notes'],
  explanation: ['explanation'],
};

function matchHeader(field: string): string | null {
  const n = normalize(field);
  for (const [canonical, variants] of Object.entries(HEADER_VARIANTS)) {
    if (variants.includes(n)) return canonical;
  }
  return null;
}

function looksLikeHeader(fields: string[]): boolean {
  return fields.some(f => matchHeader(f) === 'topic');
}

function parseCsv(raw: string): { rows: CsvRow[]; skipped: CsvSkip[]; dataRowCount: number } {
  const allLines = raw.split(/\r?\n/);
  const lineEntries: Array<{ lineNumber: number; text: string }> = [];
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].trim().length > 0) {
      lineEntries.push({ lineNumber: i + 1, text: allLines[i] });
    }
  }
  if (lineEntries.length === 0) return { rows: [], skipped: [], dataRowCount: 0 };

  const firstFields = lineEntries[0].text.split('\t');
  const hasHeader = looksLikeHeader(firstFields);

  let topicIdx = 1;
  let nameIdx = 0;
  let clarificationIdx = 2;
  let explIdx = 3;
  let dataStart = 0;

  if (hasHeader) {
    dataStart = 1;
    topicIdx = -1;
    nameIdx = -1;
    clarificationIdx = -1;
    explIdx = -1;
    for (let i = 0; i < firstFields.length; i++) {
      const match = matchHeader(firstFields[i]);
      if (match === 'topic') topicIdx = i;
      else if (match === 'deckname') nameIdx = i;
      else if (match === 'clarification') clarificationIdx = i;
      else if (match === 'explanation') explIdx = i;
    }
    if (topicIdx === -1) {
      throw new AppError(400, 'INVALID_CSV', 'Header row detected but no "Topic" column found.');
    }
  }

  const dataRowCount = lineEntries.length - dataStart;
  const rows: CsvRow[] = [];
  const skipped: CsvSkip[] = [];

  for (let i = dataStart; i < lineEntries.length; i++) {
    const { lineNumber, text } = lineEntries[i];
    const fields = text.split('\t');
    const unescape = (s: string) => s.replace(/\\n/g, '\n');
    const topic = unescape((fields[topicIdx] ?? '').trim());
    if (!topic) {
      skipped.push({ lineNumber, rawLine: text, reason: 'Missing topic' });
      continue;
    }
    const deckName = unescape((nameIdx >= 0 ? fields[nameIdx] ?? '' : '').trim() || topic);
    const clarification = unescape((clarificationIdx >= 0 ? fields[clarificationIdx] ?? '' : '').trim());
    const explanation = unescape((explIdx >= 0 ? fields[explIdx] ?? '' : '').trim());
    rows.push({ deckName, topic, clarification, explanation, lineNumber, rawLine: text });
  }

  return { rows, skipped, dataRowCount };
}

decksRouter.post('/import-csv', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) throw new AppError(400, 'MISSING_FILE', 'No CSV file uploaded.');

    const { language, cardCount: cardCountStr, collectionPath } = req.body;
    if (!language) throw new AppError(400, 'MISSING_FIELDS', 'language is required.');

    const cardCount = cardCountStr ? parseInt(cardCountStr, 10) : 0;
    const csvText = file.buffer.toString('utf-8');
    const { rows, skipped, dataRowCount } = parseCsv(csvText);

    if (dataRowCount > CSV_MAX_DATA_ROWS) {
      throw new AppError(400, 'CSV_TOO_LARGE', `File has ${dataRowCount} data rows, but the maximum is ${CSV_MAX_DATA_ROWS}.`);
    }

    const basePath = (collectionPath ?? '').trim();
    const userId = req.userId!;
    let createdCount = 0;
    let queuedCount = 0;
    const failures: Array<{ line: number; context: string; error: string }> = [];

    for (const skip of skipped) {
      failures.push({
        line: skip.lineNumber,
        context: skip.rawLine.length > 120 ? skip.rawLine.slice(0, 120) + '…' : skip.rawLine,
        error: skip.reason,
      });
    }

    for (const row of rows) {
      const deckPath = basePath ? `${basePath}::${row.deckName}` : row.deckName;
      const clarification = row.clarification.trim().length > 0 ? row.clarification : undefined;
      const existingExplanation = row.explanation.trim().length > 0 ? row.explanation : undefined;

      try {
        const nodeId = await createDeckFromPath(userId, deckPath, row.topic, language, cardCount, clarification, existingExplanation);
        createdCount++;
        if (existingExplanation === undefined) {
          enqueueExplanation(userId, nodeId);
          queuedCount++;
        }
      } catch (e) {
        failures.push({
          line: row.lineNumber,
          context: row.deckName,
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const failedCount = failures.length;
    failures.sort((a, b) => a.line - b.line);

    capture(req.userId!, failedCount > 0 ? 'import_failed' : 'deck_import_completed', {
      collection_path: basePath || undefined,
      app_session_id: req.appSessionId,
      language: String(language),
      card_count: cardCount,
      import_rows: dataRowCount,
      created_count: createdCount,
      queued_count: queuedCount,
      failed_count: failedCount,
    });

    res.status(201).json({ createdCount, queuedCount, failedCount, failures });
  } catch (e) { next(e); }
});

decksRouter.get('/:nodeId', async (req, res, next) => {
  try {
    const deck = await getDeck(req.userId!, req.params.nodeId);
    if (!deck) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deck not found.' } }); return; }
    res.json(deck);
  } catch (e) { next(e); }
});

decksRouter.patch('/:nodeId', async (req, res, next) => {
  try {
    const { name, topic, clarification, language, cardCount, explanation } = req.body;
    const result = await updateDeck(req.userId!, req.params.nodeId, { name, topic, clarification, language, cardCount, explanation });

    if (result.regenerateExplanation) {
      enqueueExplanation(req.userId!, req.params.nodeId);
    }

    capture(req.userId!, 'deck_updated', {
      deck_id: req.params.nodeId,
      app_session_id: req.appSessionId,
      deck_name: typeof name === 'string' ? name : undefined,
      deck_topic: typeof topic === 'string' ? topic : undefined,
      language: typeof language === 'string' ? language : undefined,
      card_count: cardCount !== undefined ? Number(cardCount) : undefined,
      has_clarification: typeof clarification === 'string' ? clarification.trim().length > 0 : undefined,
      regenerated_explanation: result.regenerateExplanation,
      updated_fields: ['name', 'topic', 'clarification', 'language', 'cardCount', 'explanation']
        .filter(field => req.body[field] !== undefined),
    });

    res.json(result);
  } catch (e) { next(e); }
});

decksRouter.patch('/:nodeId/schedule', async (req, res, next) => {
  try {
    const { action, dueDate, clientTimezone } = req.body;
    const before = await getDeck(req.userId!, req.params.nodeId);
    if (action === 'reset_never_studied') {
      await updateDeckSchedule(req.userId!, req.params.nodeId, { action: 'reset_never_studied' });
      capture(req.userId!, 'deck_schedule_updated', {
        deck_id: req.params.nodeId,
        app_session_id: req.appSessionId,
        deck_topic: before?.topic,
        language: before?.language,
        action: 'reset_never_studied',
        previous_due_at: before?.dueAt,
        previous_interval_days: before?.intervalDays,
      });
      res.json({ success: true });
      return;
    }
    if (action === 'set_due_date') {
      if (!dueDate) throw new AppError(400, 'MISSING_FIELDS', 'dueDate is required for set_due_date.');
      await updateDeckSchedule(req.userId!, req.params.nodeId, {
        action: 'set_due_date',
        dueDate: String(dueDate),
        clientTimezone: clientTimezone ? String(clientTimezone) : undefined,
      });
      const after = await getDeck(req.userId!, req.params.nodeId);
      capture(req.userId!, 'deck_schedule_updated', {
        deck_id: req.params.nodeId,
        app_session_id: req.appSessionId,
        deck_topic: after?.topic ?? before?.topic,
        language: after?.language ?? before?.language,
        action: 'set_due_date',
        due_date: String(dueDate),
        client_timezone: clientTimezone ? String(clientTimezone) : undefined,
        previous_due_at: before?.dueAt,
        next_due_at: after?.dueAt,
        previous_interval_days: before?.intervalDays,
        next_interval_days: after?.intervalDays,
      });
      res.json({ success: true });
      return;
    }
    throw new AppError(400, 'INVALID_ACTION', 'action must be reset_never_studied or set_due_date.');
  } catch (e) { next(e); }
});

decksRouter.post('/:nodeId/generate-explanation', async (req, res, next) => {
  try {
    // Manual re-trigger — streams SSE back to client
    const { streamExplanation } = await import('../services/claude.service.js');
    await streamExplanation(req, res, req.userId!, req.params.nodeId);
  } catch (e) { next(e); }
});

decksRouter.post('/:nodeId/mark-studied', async (req, res, next) => {
  try {
    await setLastStudied(req.params.nodeId);
    res.json({ success: true });
  } catch (e) { next(e); }
});

decksRouter.post('/:nodeId/review', async (req, res, next) => {
  try {
    const { userStars, aiStars, aiRecap, studyMode, studySessionId, correctCount, totalCount } = req.body;
    if (!userStars || aiStars === undefined || aiRecap === undefined || aiRecap === null) {
      throw new AppError(400, 'MISSING_FIELDS', 'userStars, aiStars, and aiRecap are required.');
    }
    const resolvedStudyMode = studyMode === 'early' ? 'early' : 'scheduled';
    const stars = Math.max(1, Math.min(5, Math.round(Number(userStars)))) as 1 | 2 | 3 | 4 | 5;
    const deck = await getDeck(req.userId!, req.params.nodeId);
    const dueAgeHours = deck?.dueAt ? Math.max(0, Date.now() - deck.dueAt) / 36e5 : null;
    const parsedCorrectCount = correctCount != null ? Math.max(0, Math.round(Number(correctCount))) : undefined;
    const parsedTotalCount = totalCount != null ? Math.max(0, Math.round(Number(totalCount))) : undefined;
    const result = await saveDeckReview(req.userId!, req.params.nodeId, stars, Number(aiStars), String(aiRecap), resolvedStudyMode, parsedCorrectCount, parsedTotalCount);
    capture(req.userId!, 'deck_review_submitted', {
      deck_id: req.params.nodeId,
      app_session_id: req.appSessionId,
      study_session_id: typeof studySessionId === 'string' ? studySessionId : undefined,
      deck_topic: deck?.topic,
      language: deck?.language,
      study_mode: resolvedStudyMode,
      ai_stars: Number(aiStars),
      user_stars: stars,
      stars_delta: stars - Number(aiStars),
      user_overrode_ai_rating: stars !== Number(aiStars),
      interval_before_days: deck?.intervalDays,
      interval_after_days: result.nextIntervalDays,
      was_due_when_studied: deck?.isDue,
      due_age_hours: dueAgeHours,
      due_bucket: dueAgeHours === null ? 'not_started' : dueAgeHours >= 24 * 7 ? 'week_plus' : dueAgeHours >= 24 ? 'day_plus' : dueAgeHours > 0 ? 'same_day' : 'not_due',
    });
    res.json(result);
  } catch (e) { next(e); }
});

decksRouter.get('/:nodeId/reviews', async (req, res, next) => {
  try {
    const reviews = await getDeckReviews(req.userId!, req.params.nodeId);
    res.json({ reviews });
  } catch (e) { next(e); }
});

decksRouter.delete('/:nodeId', async (req, res, next) => {
  try {
    const [deck, path] = await Promise.all([
      getDeck(req.userId!, req.params.nodeId).catch(() => null),
      getNodePath(req.userId!, req.params.nodeId).catch(() => null),
    ]);
    await deleteNode(req.userId!, req.params.nodeId);
    capture(req.userId!, 'deck_deleted', {
      deck_id: req.params.nodeId,
      app_session_id: req.appSessionId,
      deck_name: path?.split('::').pop(),
      deck_topic: deck?.topic,
      language: deck?.language,
      collection_path: path?.split('::').slice(0, -1).join('::') || undefined,
    });
    res.json({ success: true });
  } catch (e) { next(e); }
});
