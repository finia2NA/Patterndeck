# Architecture

Technical companion to the main [README](README.md). This file keeps the implementation, setup, and deployment details in one place.

## Monorepo Layout

```text
GrammarCrammer/
  client/   React Native / Expo app for iOS, Android, and web
  server/   Express + Prisma API server
  shared/   Shared constants and types consumed by both packages
```

Helpful reference docs:

- [client/STRUCTURE.md](client/STRUCTURE.md)
- [server/STRUCTURE.md](server/STRUCTURE.md)
- [.codesight/CODESIGHT.md](.codesight/CODESIGHT.md)

## High-Level System Design

1. The client handles onboarding, deck management, study sessions, settings, and notifications UI.
2. All AI requests go through the server rather than calling Anthropic directly from the app.
3. Saved decks are stored as nodes in a hierarchical collection tree, with review history and due dates persisted in the database.
4. Long-form explanation generation is queued in the background for saved decks so creation can return quickly.
5. Study activity, AI usage, and failures are instrumented with PostHog on both the client and server.

## Core Product Systems

### Client

- Expo Router app with screens for onboarding, home, session, and password reset.
- Deck tree UI for nested collections and deck management.
- Study session UI with streamed explanations, answer judging, chat, word hints, and completion flow.
- Settings for card ordering, feedback style, default card counts, due-time control, notifications, API-key preference, and enabled languages.
- PostHog route/screen tracking plus app-level error boundary integration.

### Server

- Express 5 API for auth, tree management, decks, settings, notifications, and AI proxy endpoints.
- Prisma-backed persistence for users, decks, reviews, notification devices, schedules, and AI usage ledgers.
- AES-256-GCM encryption for stored user API keys.
- Background explanation queue for deck generation work.
- Central API-key usage controls with per-user and global monthly limits.

### AI Flow

- Anthropic Sonnet 4.6 powers streamed grammar explanations, rejection explanations, and in-session chat.
- Anthropic Haiku 4.5 powers flashcard generation and answer judging.
- Streaming responses are delivered over SSE to the client.
- Every server-side AI request records token usage, estimated cost, latency, and success/failure metadata.

## Data Model Summary

- `User`: authentication identity plus encrypted API key, settings, notification devices, and usage records.
- `Node`: hierarchical collection/deck tree structure.
- `Deck`: topic, language, explanation, explanation status, due date, and interval state.
- `DeckReview`: post-session review record storing AI rating, user rating, recap, and applied interval.
- `PushDevice` and `NotificationSchedule`: mobile reminder delivery and per-user reminder timing.
- `UsageLedger` and `MonthlyUsageSummary`: central-key spend tracking and budget enforcement.

For the full schema, see [server/STRUCTURE.md](server/STRUCTURE.md).

## Stack

### Client

- Expo `~55.0.17`
- React `19.2.0`
- React Native `0.83.6`
- Expo Router `~55.0.13`
- NativeWind `^4.1.23`
- PostHog React Native `^4.43.13`
- Expo Notifications for push reminders

### Server

- Node.js + TypeScript
- Express `^5.1.0`
- Prisma `^6.19.2`
- SQLite in local development via `DATABASE_URL="file:./dev.db"`
- `posthog-node` for server analytics
- Resend for password-reset email

## Analytics And Observability

- Client analytics use PostHog with screen tracking, study-session events, and exception capture.
- Server analytics use PostHog for product events and `$ai_generation` events with model, token, cost, latency, and success metadata.
- Analytics can be enabled or disabled independently on client and server through environment variables.

## Environment Variables

### `server/.env`

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Prisma database connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `ENCRYPTION_KEY` | Yes | AES key used to encrypt stored user API keys |
| `PORT` | No | API port, defaults to `3001` |
| `APPLE_CLIENT_ID` | No | Apple Sign In configuration |
| `GOOGLE_CLIENT_ID` | No | Google Sign-In configuration |
| `CENTRAL_API_KEY` | No | Shared Anthropic key for users without their own key |
| `CENTRAL_KEY_USER_MONTHLY_LIMIT` | No | Per-user monthly spend cap for the shared key |
| `CENTRAL_KEY_GLOBAL_MONTHLY_LIMIT` | No | Global monthly spend cap for the shared key |
| `RESEND_API_KEY` | No | Resend API key for password-reset email delivery |
| `APP_URL` | No | Public app URL used in server-generated links |
| `EMAIL_FROM` | No | From-address for transactional email |
| `POSTHOG_PROJECT_API_KEY` | No | Server-side PostHog project key |
| `POSTHOG_HOST` | No | PostHog host, defaults to `https://us.i.posthog.com` |
| `POSTHOG_ENABLED` | No | Set to `0` to disable server analytics |

### `client/.env`

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEV_SERVER_HOST` | No | API host for development; use your machine IP for physical devices |
| `DEV_SERVER_PORT` | No | API port for development, defaults to `3001` |
| `EXPO_PUBLIC_API_URL` | No | Production backend base URL for web/native builds |
| `BACKEND_DEBUG_UI` | No | Enables extra backend debug controls in onboarding |
| `ANDROID_GOOGLE_SERVICES_FILE` | No | Path to the Android Firebase config file |
| `EXPO_PUBLIC_POSTHOG_KEY` | No | Client-side PostHog key |
| `EXPO_PUBLIC_POSTHOG_HOST` | No | Client-side PostHog host |
| `EXPO_PUBLIC_ANALYTICS_ENABLED` | No | Set to `0` to disable client analytics |

## Local Development

### Prerequisites

- `pnpm`
- An Anthropic API key, unless you configure `CENTRAL_API_KEY` on the server

### Setup

```bash
pnpm install
cp server/.env.example server/.env
cp client/.env.example client/.env
pnpm db:migrate
```

### Run

```bash
pnpm dev
```

Other useful commands:

- `pnpm dev:web`
- `pnpm dev:ios`
- `pnpm dev:android`
- `pnpm ios:phone`
- `pnpm android:phone`
- `pnpm lint`

## Deployment

The repo includes SSH-oriented deployment scripts in `deploy/`.

- `pnpm setup:server`: one-time Linux server bootstrap
- `pnpm ship`: build and deploy the client and server

Deployment details are intentionally light here because the scripts in `deploy/` are the source of truth.
