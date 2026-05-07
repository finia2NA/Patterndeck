# PatternDeck

PatternDeck is an AI-assisted grammar study app designed for language learners. The system was built to make grammar study feel native to the product rather than bolted onto flashcards.

Using a system like Anki for grammar, the learner has to write comprehensive explanations themselves, and the knowledge contained in the flashcards they create might not generalize to the topic itself. Judging cards too can be a difficult and time consuming.

Patterndeck and goes beyond traditional Flashcard apps by fully generating structured lessons, turning them into adaptive practice, evaluating free-text answers and using this to schedule review sessions.

---

## What It Does

- Generates grammar explanations with examples, tables, and contextual coverage  
- Converts explanations into dynamic practice cards, different every study session
- Evaluates free-text answers with AI and provides feedback  
- Supports in-session chat and word-level hints  
- Organizes decks in a hierarchical collection system  
- Uses spaced repetition with AI + user feedback  
- Supports both quick sessions and long-term study  
- Imports decks via JSON with optional prewritten content  
- Exports decks as JSON to preserve work-in-progress grammar collections  

---

## Engineering Highlights

PatternDeck is built to keep study sessions responsive and continuous, even when generating large amounts of AI-driven content.
- Explanations are streamed into the app as they’re generated, so users can start reading immediately instead of waiting for a full response. When creating decks that require longer processing, generation runs in the background, allowing the interface to stay fast and usable.
- Localization using i18n allows for studying from different native languages.
- Because the system relies heavily on AI, usage is tracked and controlled centrally. The app manages both per-user and global limits to keep costs predictable while still allowing flexible usage patterns.
- Study content and progress are organized around a hierarchical collection system in the familiar Anki format, with scheduling logic built directly into the data model to support spaced repetition over time.
- Throughout the app, analytics are used to understand how sessions unfold, how AI features are used, and where failures occur. This makes it possible to iterate on both the learning experience and the underlying system.
- Sensitive data, such as user API keys, is handled securely and never exposed to the client.

---

## System Architecture

### Monorepo Structure

client/   React Native / Expo app (iOS, Android, web) server/   Express + Prisma API shared/   Shared types and constants

---

### High-Level Design

1. Client handles UI: onboarding, study sessions, deck management, settings  
2. All AI requests are routed through the server  
3. Decks are stored in a hierarchical tree with review history and scheduling  
4. Long-running AI tasks are processed asynchronously  
5. Analytics and usage tracking are instrumented across client and server  

---

### Core Systems

#### Client
- Expo Router-based React Native app  
- Study session UI with streaming explanations and answer evaluation  
- Lightweight localization layer with English and German UI support  
- Deck tree interface for nested organization  
- Notification and scheduling controls  
- Integrated analytics and error tracking  

#### Server
- Express API for auth, decks, AI, and notifications  
- Prisma ORM for persistence  
- Background job handling for deck generation  
- API key encryption and secure storage  
- AI proxy layer with usage tracking  

---

### AI Pipeline

- Sonnet: explanations, grammar-case extraction, chat, feedback  
- Haiku: card generation, answer evaluation  
- Saved deck explanations are split into grammar subcases asynchronously so future card generation can balance coverage and learner difficulty  
- Case-aware generation can be disabled in settings, and extracted cases can be reviewed or regenerated from deck editing  
- Prompts distinguish UI response language from the language being studied  
- Streaming responses via SSE  
- Each request logs:
  - token usage  
  - latency  
  - estimated cost  
  - success/failure  

---

## Key Engineering Decisions

### Server-Side AI Routing
- Prevents API key exposure  
- Enables centralized cost tracking and budget enforcement  
- Tradeoff: added latency vs direct client calls  

---

### Streaming via SSE
- Simpler than WebSockets for unidirectional AI output  
- Reduces perceived latency during explanation generation  
- Tradeoff: limited bidirectional flexibility  

---

### Asynchronous Deck Generation
- Keeps UI responsive during heavy AI tasks  
- Background explanation and grammar-case extraction jobs share a scheduler capped at 5 concurrent jobs  
- Improves user experience for large collections  
- Tradeoff: requires job tracking and failure handling  

---

### Model Separation (Sonnet vs Haiku)
- Haiku used for high-volume, low-cost tasks  
- Sonnet used for quality-sensitive outputs, including grammar-case extraction  
- Balances cost vs output quality  

---

## Failure Handling & Edge Cases

- AI responses may be inconsistent → validation + fallback prompts  
- Budget limits exceeded → requests rejected
- Background job failures → retry + logging system  
- Network/API failures → tracked via analytics for debugging  

---

## Data Model Overview

- User: auth, settings, encrypted API key, usage  
- Node: hierarchical collection structure  
- Deck: topic, explanation, scheduling data  
- DeckReview: session results and interval updates  
- GrammarCase / GrammarCaseUserStat: saved-deck subcase coverage and per-learner mastery estimates  
- UsageLedger: AI cost tracking and enforcement  
- NotificationSchedule / PushDevice: reminders  

---

## Tech Stack

### Client
- React Native (Expo)
- Expo Router
- NativeWind
- PostHog analytics

### Server
- Node.js + TypeScript
- Express
- Prisma ORM
- SQLite (dev)

### Infrastructure
- Anthropic API (Sonnet + Haiku)
- PostHog (analytics + observability)

---

## Observability

- Client: screen tracking, session events, error capture  
- Server: AI metrics, latency, cost tracking  
- Events include:
  - generation time  
  - token usage  
  - failure rates  

---

## Local Development

### Setup

`pnpm install cp server/.env.example server/.env cp client/.env.example client/.env pnpm db:migrate`

Client `.env`:

```env
DEV_SERVER_HOST=localhost
DEV_SERVER_PORT=3001
EXPO_PUBLIC_API_URL=https://patterndeck.richardhanss.de/api/v1
ANDROID_GOOGLE_SERVICES_FILE=
ANDROID_UPLOAD_STORE_FILE=
ANDROID_UPLOAD_STORE_PASSWORD=
ANDROID_UPLOAD_KEY_ALIAS=
ANDROID_UPLOAD_KEY_PASSWORD=
EXPO_PUBLIC_EXPO_PROJECT_ID=156c0c3e-7336-42b4-9805-a98c8fd83832
EXPO_PUBLIC_POSTHOG_KEY=
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
EXPO_PUBLIC_ANALYTICS_ENABLED=0
```

### Run

`pnpm backend`
`pnpm start`

iOS native builds use `expo-build-properties` to build React Native from source and enable ccache. Install ccache locally with `brew install ccache` before repeated iOS builds for faster rebuilds.

### Check

`pnpm lint`

---

## Deployment

Deployment is handled via SSH-based scripts in deploy/.

`./deploy/deploy.sh`

The web export runs with Expo's `--clear` flag so NativeWind/Tailwind config changes are not served from Metro's stale CSS cache.

Android internal testing is built locally and submitted with EAS Submit:

`pnpm ship:android`

Set `ANDROID_SUBMIT_PROFILE=android-production` to submit the local AAB to the production track as a draft.

---

## Project Focus

This project explores:

- AI-assisted learning systems  
- Cost-aware LLM infrastructure  
- Real-time feedback loops  
- Multilingual UX for AI-generated educational content  
- Cross-platform product architecture  

---

## Notes

For more info, including how to get started, check out `Architecture.md`.
