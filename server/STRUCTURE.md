# Server Structure

Express 5 + Prisma API server. Handles auth, deck/collection storage, spaced-repetition scheduling, push notifications, and routes all AI calls on behalf of the client.

## Directory map

```
server/
├── src/
│   ├── index.ts                    ← Express entry point: CORS, body parsing, routes, error handler; binds to 127.0.0.1 in production
│   ├── config.ts                   ← Reads and validates environment variables
│   │
│   ├── middleware/
│   │   ├── auth.ts                 ← requireAuth: verifies JWT, attaches user to req
│   │   └── errorHandler.ts         ← Centralised Express error handler
│   │
│   ├── routes/
│   │   ├── admin.ts                ← /api/admin — admin-only usage, budget config, AI routing, provider model discovery
│   │   ├── auth.ts                 ← /api/auth — register, login, Apple, Google, me, validate-key, forgot/reset-password
│   │   ├── tree.ts                 ← /api/tree — full tree, single node, path, descendant-deck-ids, JSON export, delete
│   │   ├── decks.ts                ← /api/decks — CRUD, mark-studied, review submission, generate-explanation trigger, JSON import
│   │   ├── collections.ts          ← /api/collections — rename, move
│   │   ├── settings.ts             ← /api/settings — generic key/value + API key management + usage-status
│   │   ├── notifications.ts        ← /api/notifications — register/unregister push tokens
│   │   └── claude-proxy.ts         ← /api/ai — cards, judge, explain-sentence, explanation/stream, rejection/stream, chat/stream
│   │
│   ├── services/
│   │   ├── auth.service.ts         ← Registration, login, OAuth, JWT generation, password reset tokens
│   │   ├── global-config.service.ts ← DB-backed global key/value config, including per-tier budget lookup
│   │   ├── user-tier.service.ts    ← User tier helper placeholder for future RevenueCat integration
│   │   ├── deck.service.ts         ← Deck CRUD, explanation status updates, cascading deletes, review submission
│   │   ├── tree.service.ts         ← Tree queries (full tree, path, descendants)
│   │   ├── settings.service.ts     ← Generic user settings persistence; falls back to SETTING_DEFAULTS from @patterndeck/shared
│   │   ├── crypto.service.ts       ← AES-256-GCM encrypt/decrypt for API keys
│   │   ├── usage.service.ts        ← Cost tracking: ledger recording, monthly summaries, limit checks
│   │   ├── ai-routing.service.ts   ← Provider-neutral AI routing, model discovery, fallbacks, pricing/cost estimates
│   │   ├── claude.service.ts       ← Compatibility re-export for the Claude service modules
│   │   ├── claude/                 ← Public AI feature implementation, backed by ai-routing.service
│   │   │   ├── shared.ts           ← Compatibility re-exports for legacy imports
│   │   │   ├── explanations.ts     ← Deck/generic explanation generation and SSE streaming
│   │   │   ├── endpoints.ts        ← Cards, judging, rejection, chat, session rating, sentence/word hints
│   │   │   ├── edit.ts             ← Agentic explanation editor
│   │   │   └── index.ts            ← Public re-exports
│   │   ├── grammar-case.service.ts ← Grammar subcase extraction, session target selection, per-case stats
│   │   ├── scheduler.service.ts    ← Shared FIFO queue for background explanation/case extraction jobs (max 5 concurrent)
│   │   ├── srs.service.ts          ← Spaced-repetition scheduling: interval calculation from AI + user star ratings
│   │   ├── notification.service.ts ← Push notification delivery: find due decks, send via Expo, record delivery
│   │   ├── email.service.ts        ← Transactional email via Resend (password reset links)
│   │   └── analytics.service.ts    ← PostHog server-side event tracking (AI usage, errors)
│   │
│   ├── lib/
│   │   ├── prisma.ts               ← Singleton Prisma client export
│   │   └── sse.ts                  ← Helpers for writing Server-Sent Events to res
│   │
│   ├── types/
│   │   └── index.ts                ← Extended Express Request types (req.user, etc.)
│   │
│   ├── cli/
│   │   └── admin.ts                ← Promote/demote users by role from the command line
│   │
│   └── constants/
│       ├── prompts.ts              ← AI system prompts
│       └── languageInstructions.ts ← Per-language instructions injected into prompts
│
├── prisma/
│   ├── schema.prisma               ← Database models (see schema section below)
│   └── migrations/                 ← Prisma migration files
│
├── .env                            ← DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, optional keys (not in repo)
├── package.json
└── tsconfig.json
```

## Shared package (`@patterndeck/shared`)

Constants shared with the client (language lists, UI locales, setting defaults, card count options) live in `shared/` at the repo root and are imported as `@patterndeck/shared`. UI locales currently support English (`en`), German (`de`), and Japanese (`ja`). In dev, `tsx` consumes the TypeScript source directly via the `"source"` export condition — no pre-build needed. For production (`pnpm build:server`), the shared package is compiled first automatically (`pnpm build:shared && tsc`).

## Routes reference

All routes require `Authorization: Bearer <JWT>` except the auth endpoints.

### `/api/auth`

| Method | Path                    | Description                                  |
| ------ | ----------------------- | -------------------------------------------- |
| POST   | `/register`             | Email + password registration, optionally stores initial UI language, returns JWT |
| POST   | `/login`                | Email + password login, returns JWT          |
| POST   | `/apple`                | Apple Sign In, optionally stores UI language for new users, returns JWT |
| POST   | `/google`               | Google OAuth2, optionally stores UI language for new users, returns JWT |
| GET    | `/me`                   | Current user info, role, and available auth methods |
| POST   | `/validate-key`         | Test a Claude API key, returns validity flag  |
| POST   | `/forgot-password`      | Send password reset email via Resend          |
| POST   | `/reset-password`       | Consume reset token, set new password         |

### `/api/tree`

| Method | Path                           | Description                                        |
| ------ | ------------------------------ | -------------------------------------------------- |
| GET    | `/`                            | Full deck tree + newDecksStartedToday count        |
| GET    | `/:id`                         | Single node (with deck data if leaf)               |
| GET    | `/:id/path`                    | Breadcrumb path string (e.g. "JP > N5 > Conditionals") |
| GET    | `/:id/descendant-deck-ids`     | All deck node IDs under a collection               |
| GET    | `/:id/reviews`                 | Review history for all descendant decks            |
| GET    | `/:id/export-json`             | Export deck data as pretty-printed JSON (for backup/transfer) |
| DELETE | `/:id`                         | Delete node (cascades to children and deck)        |

### `/api/decks`

| Method | Path                      | Description                                                    |
| ------ | ------------------------- | -------------------------------------------------------------- |
| POST   | `/`                       | Create deck from a `::` -delimited path, triggers explanation  |
| GET    | `/:nodeId`                | Get deck data (topic, language, explanation, status, SRS fields) |
| PATCH  | `/:nodeId`                | Update deck (name, topic, language, cardCount)                 |
| GET    | `/:nodeId/grammar-cases`  | Get extracted grammar cases with per-user difficulty stats     |
| POST   | `/:nodeId/grammar-cases/regenerate` | Queue grammar-case regeneration for the deck explanation |
| POST   | `/:nodeId/mark-studied`   | Set lastStudiedAt to now                                       |
| POST   | `/:nodeId/review`         | Submit post-session review (AI + user stars, recap, correctCount, totalCount), updates SRS interval |
| GET    | `/:nodeId/reviews`        | Get all review history records for a deck          |
| POST   | `/import-json`             | Bulk-import decks from JSON (multipart, max 5000 entries)     |

### `/api/collections`

| Method | Path              | Description                         |
| ------ | ----------------- | ----------------------------------- |
| PATCH  | `/:nodeId`        | Rename collection                   |
| POST   | `/:nodeId/move`   | Move node to a new parent           |

### `/api/settings`

| Method | Path               | Description                              |
| ------ | ------------------ | ---------------------------------------- |
| GET    | `/:key`            | Get a setting value by key               |
| PUT    | `/:key`            | Set a setting value                      |
| PUT    | `/api-key`         | Store Claude API key (encrypted)         |
| DELETE | `/api-key`         | Remove Claude API key                    |
| GET    | `/api-key/status`  | Check whether a key is currently stored  |
| GET    | `/usage-status`    | Central key availability, user's monthly usage, limits |

### `/api/admin`

All routes require an authenticated user with `role = "admin"`.

| Method | Path        | Description                                      |
| ------ | ----------- | ------------------------------------------------ |
| GET    | `/users`    | List users with tier, monthly usage, budget, usage percentage; supports `tier` and `hasUsage` filters |
| GET    | `/config`   | Get all DB-backed global config values           |
| PUT    | `/config`   | Upsert DB-backed global config values            |
| GET    | `/ai-providers` | List AI providers, configured status, base URL, and model-list support |
| GET    | `/ai-providers/:provider/models` | Fetch live provider models when available, or curated fallback IDs |
| GET    | `/ai-routing` | Get current endpoint model routing, defaults, provider availability, and endpoint metadata |
| PUT    | `/ai-routing` | Save endpoint primary/fallback provider+model routing config |

### `/api/notifications`

| Method | Path          | Description                                      |
| ------ | ------------- | ------------------------------------------------ |
| POST   | `/register`   | Register an Expo push token + notification time  |
| POST   | `/unregister` | Remove a push token                              |

### `/api/ai`

| Method | Path                    | Description                                               |
| ------ | ----------------------- | --------------------------------------------------------- |
| POST   | `/cards`                | Generate flashcards for a topic; saved decks use grammar-case targets (default Haiku, structured tool response) |
| POST   | `/judge`                | Judge a user's answer (default Haiku, structured tool response) |
| POST   | `/explain-sentence`     | Explain the correct sentence when learner skips (default Haiku) |
| POST   | `/explanation/stream`   | Stream grammar explanation (default Sonnet, SSE) |
| POST   | `/explanation/edit`     | AI explanation editor: apply search/replace tool calls to Markdown (default Sonnet, tool response) |
| POST   | `/rejection/stream`     | Stream explanation of a wrong answer (default Sonnet, SSE) |
| POST   | `/chat/stream`          | Stream chat about the current card (default Sonnet, SSE) |

SSE streams emit newline-delimited JSON events:
```json
{ "type": "text", "text": "chunk..." }
{ "type": "done", "cost": 0.000123 }
```

## Key services

### `ai-routing.service.ts`
Provider-neutral AI transport and routing layer for Anthropic, OpenAI, OpenRouter, DeepSeek, Mistral, Kimi/Moonshot, and Qwen/DashScope.
- Stores admin endpoint routing in `GlobalConfig` under `ai_routing_config`; defaults keep Haiku for high-volume structured tasks and Sonnet for quality-sensitive/streaming tasks.
- Provides live provider availability and model discovery for the admin UI, without exposing secret keys.
- Supports native Anthropic tool use/streaming and OpenAI-compatible chat completions/tool calls for the other providers.
- Retries one fallback model on technical failures only; streaming fallback is allowed only before any text chunk has been sent.
- Personal Anthropic keys remain Anthropic-only and never fall back to server provider keys.
- Records analytics and usage with actual provider/model; usage ledger model values include the provider prefix for cross-provider cost tracking.

### `claude/` and `claude.service.ts`
Feature-level AI functions. `claude.service.ts` re-exports the split implementation modules for existing imports, while the transport/model choice is handled by `ai-routing.service.ts`.
- Uses server-to-server `fetch` — no client-side API key exposure.
- `generateDeckExplanation(userId, deckId)` — generates and persists explanation, updating `explanationStatus` on the Deck from `pending → generating → ready` (or `error`), then queues grammar-case extraction for saved-deck card coverage.
- `editExplanation(userId, explanation, instruction, messages, analyticsContext?)` — agentic explanation editor; sends the current Markdown document + instruction with `replace_text`, `insert_after`, and `rewrite_all` tools; applies all returned tool calls sequentially; returns `{ explanation, summary, cost }`.

### `grammar-case.service.ts`
Maintains per-deck grammar subcases used for coverage-aware card generation.
- Extracts `GrammarCase` rows from saved deck explanations using language-specific prompt instructions, with a fallback `general` case if extraction fails.
- Selects per-session card targets using coverage debt, recent learner difficulty, staleness, uncertainty, and iteration-based decay.
- Lists and regenerates extracted cases for deck editing and review-history difficulty charts.
- Updates `GrammarCaseUserStat` at deck-review submission without changing the deck-level SRS scheduler.

### `scheduler.service.ts`
Runs background AI preparation work.
- Shares one FIFO queue across explanation generation and grammar-case extraction/regeneration.
- Caps background explanation/case extraction concurrency at 5 total jobs.
- Re-enqueues decks whose explanation status is `pending` when the server starts.

### `srs.service.ts`
Spaced-repetition scheduling logic.
- Takes AI star rating and user star rating from a post-session review.
- Calculates the next review interval using a simple SM-2-style algorithm.
- Updates `dueAt` and `intervalDays` on the Deck.

### `notification.service.ts`
Push notification delivery.
- Queries users whose `NotificationSchedule.scheduledFor` is in the past.
- Finds decks due for review (where `dueAt <= now`).
- Sends batched notifications via the Expo push API.
- Records a `NotificationDelivery` row (keyed on `userId + studyDayKey`) to prevent duplicate sends.

### `email.service.ts`
Transactional email via the Resend API.
- Currently used for password reset: generates a time-limited token, stores its hash in `PasswordResetToken`, and sends the link.

### `analytics.service.ts`
Server-side PostHog event tracking. Fires events for AI usage, errors, and user actions to allow monitoring without exposing raw usage data to the client.

### `usage.service.ts`
Manages cost tracking and spending limits for the central API key.
- `recordUsage()` — atomically inserts a ledger row and updates the monthly summary in a transaction.
- `getUserMonthlyUsage()` — O(1) read from the summary table.
- `getGlobalCentralUsage()` — aggregates across all users for the current month.
- `canUseCentralKey()` — checks DB-backed per-tier user budgets and the global limit.

### `global-config.service.ts`
Reads and writes global key/value config stored in `GlobalConfig`.
- `getGlobalConfig()` / `setGlobalConfig()` — single-key read and upsert helpers.
- `getAllGlobalConfig()` — returns all config values as a record.
- `getUserBudget()` — resolves `free_user_budget` / `paid_user_budget`, defaulting to `$1.00` / `$5.00`.

### `user-tier.service.ts`
Central place for resolving a user's monetization tier. Currently returns `free` for all users until paid-tier state is integrated.

### `crypto.service.ts`
Encrypts and decrypts Claude API keys using AES-256-GCM with a per-user deterministic IV derived from `userId`. Keys are never stored in plaintext.

### `auth.service.ts`
Handles user creation, `bcryptjs` password hashing, JWT signing (7-day expiry), OAuth user lookup/creation (Apple + Google), and password reset token management.

### `tree.service.ts`
Manages the hierarchical Node tree. Nodes can be collections (have children) or leaves (have a Deck attached). Provides full tree retrieval (recursive nesting), breadcrumb paths, and subtree descendant queries.

## Database schema

```
User
  id            UUID PK
  email         unique (optional — OAuth-only users may have none)
  passwordHash
  appleId       unique (OAuth)
  googleId      unique (OAuth)
  role          "user" | "admin" (default "user")
  claudeApiKey  encrypted string (optional)
  nodes[]       → Node
  settings[]    → Setting
  usageLedger[] → UsageLedger
  usageSummaries[] → MonthlyUsageSummary
  passwordResetToken? → PasswordResetToken
  pushDevices[] → PushDevice
  notificationSchedule? → NotificationSchedule
  notificationDeliveries[] → NotificationDelivery
  grammarCaseStats[] → GrammarCaseUserStat

PasswordResetToken
  id            UUID PK
  userId        unique FK → User
  tokenHash     (bcrypt hash of the emailed token)
  expiresAt

Node  (tree structure, one per collection or deck)
  id            UUID PK
  userId        FK → User
  parentId      FK → Node (nullable, root nodes have no parent)
  name
  sortOrder
  children[]    → Node
  deck?         → Deck

Deck  (leaf data, attached 1-to-1 to a Node)
  nodeId        UUID PK = FK → Node
  topic
  clarification (optional freeform context for card generation)
  language
  explanation   (full Markdown, optional)
  explanationStatus  pending | generating | ready | error
  grammarCaseStatus  pending | generating | ready | error
  cardCount     (default 10)
  lastStudiedAt (optional)
  dueAt         (SRS next review date, optional)
  intervalDays  (SRS current interval, default 1)
  reviews[]     → DeckReview
  grammarCases[] → GrammarCase

DeckReview  (SRS review record per session OR schedule change)
  id              UUID PK
  deckId          FK → Deck
  studiedAt
  eventType       "review" | "schedule_change" (default "review")
  aiStars         (1–5, Claude's assessment; 0 for schedule_change)
  userStars       (1–5, self-reported; 0 for schedule_change)
  aiRecap         (brief feedback string; target YYYY-MM-DD for schedule_change)
  intervalApplied (interval set at the time of this review)
  correctCount    Int? (cards correct on first try, nullable for old records)
  totalCount      Int? (total cards in session, nullable for old records)

GrammarCase  (testable subcase of a saved deck explanation)
  id             UUID PK
  deckId         FK → Deck
  caseKey        stable lower_snake_case identifier, unique per deck
  label
  ruleSummary
  generationHint
  baseWeight     relative scheduling importance
  sourceHash     hash of topic + language + explanation
  active         currently extracted case flag
  sortOrder
  userStats[]    → GrammarCaseUserStat

GrammarCaseUserStat  (per-user mastery estimate for a grammar case)
  userId + grammarCaseId  composite PK
  seenCount
  correctFirstTryCount
  difficultyMass         decayed difficulty evidence
  attemptMass            decayed attempt evidence
  lastPracticedIteration
  lastUpdatedIteration

Grammar-case extraction replaces the deck's previous case rows and cascades their per-user stats, so a changed or regenerated explanation starts with fresh case difficulty estimates.

Setting  (arbitrary key-value per user)
  userId + key  composite PK
  value

GlobalConfig  (global admin-managed key-value config)
  key           String PK
  value         String

PushDevice
  id            UUID PK
  userId        FK → User
  expoPushToken unique
  platform      ("ios" | "android")
  disabledAt    (set when Expo reports the token as invalid)
  lastError

NotificationSchedule  (one row per user, their preferred reminder time)
  userId        PK FK → User
  scheduledFor  (next DateTime the notification should fire)
  notificationTime (HH:MM local time)
  timezone

NotificationDelivery  (audit trail, prevents duplicate sends)
  id            UUID PK
  userId        FK → User
  studyDayKey   (e.g. "2026-05-03")
  dueDeckCount
  @@unique([userId, studyDayKey])

UsageLedger  (append-only audit trail)
  id            UUID PK
  userId        FK → User
  yearMonth     "2026-04"
  source        "central" | "own"
  endpoint      "cards" | "judge" | "explanation" | "case-extraction" | "rejection" | "chat" | ...
  model         provider-prefixed model ID string, e.g. "anthropic:claude-sonnet-4-6"
  cost          Float (dollars, high precision)
  createdAt

MonthlyUsageSummary  (denormalized running totals for fast limit checks)
  userId + yearMonth + source  composite PK
  totalCost     Float
```

## Environment variables

| Variable                          | Required | Description                                      |
| --------------------------------- | -------- | ------------------------------------------------ |
| `DATABASE_URL`                    | Yes      | Prisma DB URL (e.g. `file:./dev.db`)             |
| `JWT_SECRET`                      | Yes      | Secret for signing/verifying JWTs                |
| `ENCRYPTION_KEY`                  | Yes      | 32-byte hex key for AES-256-GCM API key storage  |
| `APPLE_CLIENT_ID`                 | No       | Apple Sign In client ID                          |
| `GOOGLE_CLIENT_ID`                | No       | Google OAuth2 client ID                          |
| `ANTHROPIC_API_KEY`               | No       | Shared Anthropic API key for all users           |
| `OPENAI_API_KEY`                  | No       | OpenAI API key for admin-configured routing      |
| `OPENROUTER_API_KEY`              | No       | OpenRouter API key for admin-configured routing  |
| `DEEPSEEK_API_KEY`                | No       | DeepSeek API key for admin-configured routing    |
| `MISTRAL_API_KEY`                 | No       | Mistral API key for admin-configured routing     |
| `KIMI_API_KEY`                    | No       | Kimi/Moonshot API key for admin-configured routing |
| `QWEN_API_KEY`                    | No       | Qwen/DashScope API key for admin-configured routing |
| `OPENAI_BASE_URL`                 | No       | Override OpenAI-compatible base URL              |
| `OPENROUTER_BASE_URL`             | No       | Override OpenRouter base URL                     |
| `DEEPSEEK_BASE_URL`               | No       | Override DeepSeek base URL                       |
| `MISTRAL_BASE_URL`                | No       | Override Mistral base URL                        |
| `KIMI_BASE_URL`                   | No       | Override Kimi/Moonshot base URL                  |
| `QWEN_BASE_URL`                   | No       | Override Qwen/DashScope base URL                 |
| `CENTRAL_KEY_GLOBAL_MONTHLY_LIMIT`| No       | Global monthly spend limit in USD (default 0)    |
| `RESEND_API_KEY`                  | No       | Resend API key for password reset emails         |
| `APP_URL`                         | No       | Public app URL used in password reset links      |
| `EMAIL_FROM`                      | No       | Sender address for transactional emails          |
| `POSTHOG_PROJECT_API_KEY`         | No       | PostHog project API key for server-side analytics|
| `POSTHOG_HOST`                    | No       | PostHog host URL (default `https://us.i.posthog.com`) |
| `POSTHOG_ENABLED`                 | No       | Set to `0` to disable server-side analytics      |
| `PORT`                            | No       | HTTP port (default 3001)                         |

## CLI commands

- `bash scripts/admin.sh add <userId>` — promote a user to admin in local/dev.
- `bash scripts/admin.sh remove <userId>` — demote an admin back to a regular user in local/dev.
- `sudo -u patterndeck bash scripts/admin.sh add|remove <userId>` from `/home/patterndeck/app` — run the same wrapper after deployment.
