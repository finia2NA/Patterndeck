# PatternDeck

PatternDeck is an AI-assisted grammar study app for language learners. You pick a grammar topic, the app generates a tailored lesson, turns it into practice cards, judges your free-text answers, and schedules the topic for review later.

The project started from a simple idea: grammar study is awkward in traditional flashcard tools because each topic needs explanation, variation, and feedback, not just memorization. PatternDeck was built to make that workflow feel native to the product instead of bolted on, with long-form explanations, adaptive practice, saved study history, notifications, analytics, and cost-aware AI infrastructure around the core loop.

## What It Does

- Generates topic-specific grammar explanations with examples, tables, and clarification-aware coverage.
- Turns those explanations into practice cards instead of relying on static prewritten decks.
- Judges learner answers in real time and gives follow-up feedback when something is wrong.
- Supports chat about the current card, plus tap-to-explore word hints during study.
- Saves decks into a nested collection tree so learners can organize topics and study whole groups together.
- Uses spaced repetition for saved decks, combining self-rating with AI feedback to schedule the next review.
- Supports both quick one-off study sessions and longer-term deck building.
- Imports large batches of decks from CSV, including optional prewritten explanations.

## Beyond The Core Loop

The app also includes the kinds of systems that make it feel like a full product rather than a single feature demo.

- Account workflows include email/password auth, Apple and Google sign-in support, password reset, persisted settings, and per-user study data.
- Anthropic keys are never used directly from the client. User keys are encrypted server-side, and the app can also run on a shared central key with per-user and global monthly budget controls.
- PostHog is integrated on both client and server for screen tracking, study-session funnels, AI generation metrics, exception capture, and cost visibility.
- Long explanations stream into the app, while saved-deck explanation generation can also run asynchronously in the background so deck creation stays responsive.
- Push notifications remind users when decks are due, and users can choose what time new due material should unlock each day.
- The app uses one Expo/React Native codebase for iOS, Android, and web, and makes targeted use ofnative iOS components in places where they provide a better feel than generic cross-platform controls.

## Tech Snapshot

- Client: Expo 55, React Native 0.83, Expo Router, NativeWind
- Server: Express 5, TypeScript, Prisma, SQLite
- AI: Anthropic Sonnet 4.6 for streamed explanations and chat, Haiku 4.5 for card generation and judging
- Observability: PostHog client/server instrumentation, AI token and cost tracking, exception capture

## Technical Details

Setup, environment variables, deployment notes, and system design now live in [Architecture.md](Architecture.md).

For directory-level navigation, see [client/STRUCTURE.md](client/STRUCTURE.md) and [server/STRUCTURE.md](server/STRUCTURE.md).
