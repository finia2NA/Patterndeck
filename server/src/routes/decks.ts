import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { createDeckFromPath, getDeck, updateDeck, deleteNode, setLastStudied, saveDeckReview, updateDeckSchedule, getDeckReviews } from '../services/deck.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { enqueueExplanation, enqueueGrammarCaseExtraction } from '../services/scheduler.service.js';
import { capture } from '../services/analytics.service.js';
import { getNodePath } from '../services/tree.service.js';
import { getGrammarCaseSummaries, persistImportedCases, type ExtractedGrammarCase } from '../services/grammar-case.service.js';
import { setGrammarCaseReady } from '../services/deck.service.js';
import { resolveApiKey } from '../services/claude/shared.js';
import { explanationSummarySourceHash, generateExplanationSummary } from '../services/claude.service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const JSON_MAX_ENTRIES = 5000;

export const decksRouter = Router();

decksRouter.use(requireAuth);

function responseLanguage(body: Record<string, unknown>): string {
  return typeof body.uiLanguage === 'string' && body.uiLanguage.trim().length > 0
    ? body.uiLanguage.trim()
    : 'English';
}

decksRouter.post('/', async (req, res, next) => {
  try {
    const { path, topic, clarification, language, cardCount, explanation, explanationSummary } = req.body;
    if (!path || !topic || !language) {
      throw new AppError(400, 'MISSING_FIELDS', 'path, topic, and language are required.');
    }
    const existingExplanation = typeof explanation === 'string' && explanation.trim().length > 0
      ? explanation
      : undefined;
    const deckClarification = typeof clarification === 'string' && clarification.trim().length > 0
      ? clarification
      : undefined;
    const summaryResponseLanguage = responseLanguage(req.body);
    let summaryForSave: string | undefined;
    let summarySourceHash: string | undefined;
    if (existingExplanation !== undefined) {
      const providedSummary = typeof explanationSummary === 'string' && explanationSummary.trim().length > 0
        ? explanationSummary.trim()
        : undefined;
      if (providedSummary) {
        summaryForSave = providedSummary;
      } else {
        const generated = await generateExplanationSummary(
          req.userId!,
          String(topic),
          String(language),
          existingExplanation,
          summaryResponseLanguage,
          {
            appSessionId: req.appSessionId,
            deckTopic: String(topic),
            language: String(language),
          },
        );
        summaryForSave = generated.explanationSummary;
      }
      summarySourceHash = explanationSummarySourceHash(String(topic), String(language), summaryResponseLanguage, existingExplanation);
    }
    const nodeId = await createDeckFromPath(
      req.userId!,
      path,
      topic,
      language,
      cardCount,
      deckClarification,
      existingExplanation,
      summaryForSave,
      summarySourceHash,
    );

    if (existingExplanation === undefined) {
      enqueueExplanation(req.userId!, nodeId);
    } else {
      await enqueueGrammarCaseExtraction(req.userId!, nodeId, {
        analyticsContext: {
          appSessionId: req.appSessionId,
          deckId: nodeId,
          deckTopic: String(topic),
          language: String(language),
          traceId: `case_extraction:${nodeId}`,
        },
      });
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
      grammar_case_queued: existingExplanation !== undefined,
      creation_source: existingExplanation !== undefined ? 'quick_study_save' : 'manual',
    });

    res.status(201).json({ nodeId, grammarCaseQueued: existingExplanation !== undefined });
  } catch (e) { next(e); }
});

// ─── JSON Import ─────────────────────────────────────────────────────────────

interface ImportEntry {
  deckName: string;
  topic: string;
  clarification?: string | null;
  explanation?: string | null;
  cases?: unknown[] | null;
}

function parseImportJson(raw: string): { entries: ImportEntry[]; entryCount: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Imported file must contain valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new AppError(400, 'INVALID_JSON', 'Imported file must be a JSON array.');
  }
  const entries: ImportEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const topic = typeof item.topic === 'string' ? item.topic.trim() : '';
    if (!topic) continue;
    const deckName = typeof item.deckName === 'string' ? item.deckName.trim() : topic;
    entries.push({
      deckName: deckName || topic,
      topic,
      clarification: typeof item.clarification === 'string' ? item.clarification : null,
      explanation: typeof item.explanation === 'string' ? item.explanation : null,
      cases: Array.isArray(item.cases) ? item.cases : null,
    });
  }
  return { entries, entryCount: parsed.length };
}

function validateCases(cases: unknown[]): ExtractedGrammarCase[] {
  return cases.filter((item): item is ExtractedGrammarCase => {
    if (typeof item !== 'object' || item === null) return false;
    return 'caseKey' in item && typeof (item as Record<string, unknown>).caseKey === 'string';
  });
}

decksRouter.post('/import-json', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) throw new AppError(400, 'MISSING_FILE', 'No JSON file uploaded.');

    const { language, cardCount: cardCountStr, collectionPath } = req.body;
    if (!language) throw new AppError(400, 'MISSING_FIELDS', 'language is required.');

    const cardCount = cardCountStr ? parseInt(cardCountStr, 10) : 0;
    const jsonText = file.buffer.toString('utf-8');
    const { entries, entryCount } = parseImportJson(jsonText);

    if (entryCount > JSON_MAX_ENTRIES) {
      throw new AppError(400, 'JSON_TOO_LARGE', `File has ${entryCount} entries, but the maximum is ${JSON_MAX_ENTRIES}.`);
    }
    if (entries.length === 0) {
      throw new AppError(400, 'INVALID_JSON', 'No valid import entries found. Each entry must have a topic.');
    }

    const basePath = (collectionPath ?? '').trim();
    const userId = req.userId!;
    let createdCount = 0;
    let queuedCount = 0;
    const failures: Array<{ index: number; context: string; error: string }> = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const deckPath = basePath ? `${basePath}::${entry.deckName}` : entry.deckName;
      const trimmedClarification = entry.clarification?.trim() ?? '';
      const trimmedExplanation = entry.explanation?.trim() ?? '';
      const clarification = trimmedClarification.length > 0 ? trimmedClarification : undefined;
      const existingExplanation = trimmedExplanation.length > 0 ? trimmedExplanation : undefined;

      try {
        const nodeId = await createDeckFromPath(userId, deckPath, entry.topic, language, cardCount, clarification, existingExplanation);
        createdCount++;
        if (existingExplanation === undefined) {
          enqueueExplanation(userId, nodeId);
          queuedCount++;
        } else if (entry.cases && entry.cases.length > 0) {
          const validCases = validateCases(entry.cases);
          if (validCases.length > 0) {
            await persistImportedCases(nodeId, entry.topic, String(language), existingExplanation, validCases);
            await setGrammarCaseReady(nodeId);
          } else {
            await enqueueGrammarCaseExtraction(userId, nodeId, {
              analyticsContext: {
                appSessionId: req.appSessionId,
                deckId: nodeId,
                deckTopic: entry.topic,
                language: String(language),
                traceId: `case_extraction:${nodeId}`,
              },
            });
          }
        } else {
          await enqueueGrammarCaseExtraction(userId, nodeId, {
            analyticsContext: {
              appSessionId: req.appSessionId,
              deckId: nodeId,
              deckTopic: entry.topic,
              language: String(language),
              traceId: `case_extraction:${nodeId}`,
            },
          });
        }
      } catch (e) {
        failures.push({
          index: i,
          context: entry.deckName,
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const failedCount = failures.length;
    failures.sort((a, b) => a.index - b.index);

    capture(req.userId!, failedCount > 0 ? 'import_failed' : 'deck_import_completed', {
      collection_path: basePath || undefined,
      app_session_id: req.appSessionId,
      language: String(language),
      card_count: cardCount,
      import_entries: entryCount,
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
    const { name, topic, clarification, language, cardCount, explanation, regenerateGrammarCases } = req.body;
    const result = await updateDeck(
      req.userId!,
      req.params.nodeId,
      { name, topic, clarification, language, cardCount, explanation },
      {
        beforeRegenerateExplanation: () => resolveApiKey(req.userId!).then(() => undefined),
        responseLanguage: responseLanguage(req.body),
        analyticsContext: {
          appSessionId: req.appSessionId,
          deckId: req.params.nodeId,
          deckTopic: typeof topic === 'string' ? topic : undefined,
          language: typeof language === 'string' ? language : undefined,
          traceId: `explanation_summary:${req.params.nodeId}`,
        },
      },
    );

    if (result.regenerateExplanation) {
      enqueueExplanation(req.userId!, req.params.nodeId);
    } else if (regenerateGrammarCases === true || result.explanationChanged) {
      await enqueueGrammarCaseExtraction(req.userId!, req.params.nodeId, {
        force: true,
        analyticsContext: {
          appSessionId: req.appSessionId,
          deckId: req.params.nodeId,
          deckTopic: typeof topic === 'string' ? topic : undefined,
          language: typeof language === 'string' ? language : undefined,
          traceId: `case_extraction:${req.params.nodeId}`,
        },
      });
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
      regenerated_grammar_cases: regenerateGrammarCases === true || result.explanationChanged,
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

decksRouter.get('/:nodeId/grammar-cases', async (req, res, next) => {
  try {
    const sort = req.query.sort === 'difficulty' ? 'difficulty' : 'order';
    const ensure = req.query.ensure === '1' || req.query.ensure === 'true';
    const cases = await getGrammarCaseSummaries(req.userId!, req.params.nodeId, { ensure, sort });
    res.json({ cases });
  } catch (e) { next(e); }
});

decksRouter.post('/:nodeId/grammar-cases/regenerate', async (req, res, next) => {
  try {
    await enqueueGrammarCaseExtraction(req.userId!, req.params.nodeId, {
      force: true,
      analyticsContext: {
        appSessionId: req.appSessionId,
        deckId: req.params.nodeId,
        traceId: `case_extraction:${req.params.nodeId}`,
      },
    });
    res.json({ queued: true });
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
    const { userStars, aiStars, aiRecap, studyMode, studySessionId, correctCount, totalCount, caseAttempts } = req.body;
    if (!userStars || aiStars === undefined || aiRecap === undefined || aiRecap === null) {
      throw new AppError(400, 'MISSING_FIELDS', 'userStars, aiStars, and aiRecap are required.');
    }
    const resolvedStudyMode = studyMode === 'early' ? 'early' : 'scheduled';
    const stars = Math.max(1, Math.min(5, Math.round(Number(userStars)))) as 1 | 2 | 3 | 4 | 5;
    const deck = await getDeck(req.userId!, req.params.nodeId);
    const dueAgeHours = deck?.dueAt ? Math.max(0, Date.now() - deck.dueAt) / 36e5 : null;
    const parsedCorrectCount = correctCount != null ? Math.max(0, Math.round(Number(correctCount))) : undefined;
    const parsedTotalCount = totalCount != null ? Math.max(0, Math.round(Number(totalCount))) : undefined;
    const parsedCaseAttempts = Array.isArray(caseAttempts)
      ? caseAttempts.map((attempt) => ({
        grammarCaseId: typeof attempt?.grammarCaseId === 'string' ? attempt.grammarCaseId : undefined,
        grammarCaseKey: typeof attempt?.grammarCaseKey === 'string' ? attempt.grammarCaseKey : undefined,
        answers: Array.isArray(attempt?.answers) ? attempt.answers.map(String) : [],
      }))
      : [];
    const result = await saveDeckReview(
      req.userId!,
      req.params.nodeId,
      stars,
      Number(aiStars),
      String(aiRecap),
      resolvedStudyMode,
      parsedCorrectCount,
      parsedTotalCount,
      parsedCaseAttempts,
    );
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
      grammar_case_attempt_count: parsedCaseAttempts.length,
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
