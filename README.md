# GrammarCrammer

An AI-powered grammar flashcard app. You name a grammar topic, Claude generates a tailored explanation and a set of flashcards, then judges your answers in real time.

## Why

Anki is a truly great and extensible application. But using it for grammar studying is a drag. You need to make enough cards so that you will actually generalize to the grammar and not just learn the sentence by heart, and each card needs to be massive so that in case you get it wrong, you can read about the rule right in the card.

Wouldn't it be nice to have a flashcard-like app that generates a full explanation of whatever concept you want to study, and tests you on it in a more dynamic way, with changing sentences for you to solve and personalized breakdowns of what you can improve?

This is the problem GrammarCrammer is trying to solve.

## How it works

1. **Enter a topic** — anything from "Japanese conditional forms" to "Spanish subjunctive".
2. **Study your tailor-made explanation**: - The application generates a custom explanation of your chosen topic, covering the topic in detail, including conjugation tables and many examples.
3. **Test your knowledge** — Apply what you learned by correctly using what you learned. Each card gives you an English sentence; you type the target-language version.
4. **Get instant feedback** — Claude judges your answer. Correct answers are confirmed with a brief note. Wrong answers get a detailed Markdown explanation of what went wrong and what the correct form demonstrates. Wrong cards cycle back to the end of the stack.
5. **Finish the stack** — the session ends when every card has been answered correctly.

Cards are generated after the explanation is complete, so they cover all the grammar patterns in the reference — not just the headline topic.

You can also **save decks** to a hierarchical collection tree for later review, and study multiple decks together by selecting a parent collection.

## Architecture

GrammarCrammer is a **monorepo** with two packages:

```
GrammarCrammer/
  client/   ← React Native / Expo app (iOS, Android, Web)
  server/   ← Express + Prisma API server
```

All AI calls go through the server — the client never calls the Anthropic API directly. This keeps your API key secure (encrypted server-side) and enables server-side features like background explanation generation.

See [`client/STRUCTURE.md`](client/STRUCTURE.md) and [`server/STRUCTURE.md`](server/STRUCTURE.md) for directory-level guides.

## Setup

### Prerequisites

- [pnpm](https://pnpm.io/) (monorepo package manager)
- An [Anthropic API key](https://console.anthropic.com/) — entered during onboarding, stored encrypted on the server

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Copy the example files and fill in your values:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

**`server/.env`:**

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET=your-secret-here
ENCRYPTION_KEY=32-byte-hex-string   # used for AES-256-GCM API key encryption
PORT=3001                           # optional, defaults to 3001

# Optional: for social auth
APPLE_CLIENT_ID=""
GOOGLE_CLIENT_ID=""
```

**`client/.env`:**

```env
DEV_SERVER_HOST=localhost   # set to your machine's IP for physical device testing
DEV_SERVER_PORT=3001        # must match the server's PORT
```

Both files are gitignored.

### 3. Initialise the database

```bash
pnpm db:migrate
```

### 4. Start development

```bash
pnpm dev        # server + Expo (choose platform in terminal)
pnpm dev:web    # server + web client
pnpm dev:ios    # server + iOS simulator
```

The server runs on port **3001**; the Expo dev server on its default port.

---

## Platform setup

### Web

```bash
pnpm dev:web
```

### iOS & iPadOS

Requires macOS with Xcode installed.

```bash
pnpm dev:ios
```

To run on a physical device, run `npx expo prebuild && open ios/GrammarCrammer.xcworkspace` from the `client/` directory, then select your device in Xcode's scheme bar and hit Run.

> **Note:** after adding any new native package, re-run `pod install` from `client/ios/` before building in Xcode.

### macOS (via Mac Catalyst)

Runs the iPad layout natively on macOS. Requires macOS + Xcode.

**One-time Xcode setup:**

1. From `client/`, generate the native project:
   ```bash
   npx expo prebuild --platform ios
   ```
2. Open the workspace:
   ```bash
   open ios/GrammarCrammer.xcworkspace
   ```
3. In Xcode: select the **GrammarCrammer** target → **General** → **Supported Destinations** → **+** → add **My Mac (Designed for iPad)**
4. Select **My Mac** in the scheme bar → **Product → Run** (⌘R)

### Android

> Android is not actively supported as of right now. While the Architecture supports it, due to me not wanting to test the app on 3 platforms for every change i make, this platform may break at any point until we get to a 1.0. In fact, it might be broken right now! :D

```bash
# from client/
npx expo run:android
```

For Android push notifications, create or open the Firebase project used by the
Expo project, add an Android app with package name `com.finite.grammarcrammer`,
download `google-services.json`, and place it at `client/google-services.json`.
The private FCM v1 service-account JSON is only needed when uploading push
credentials to EAS with `eas credentials`; do not commit that private key.

---

## Deployment
In the deploy/ directory, there are some scripts that I used to deploy on my server. This is not dockerized as it is a pretty resource-limited deployment, and (as of right now) not intended for easy use by others. At the very least, you will have to change the hostname of the server to what you have in your ssh config, as well as the URL the client uses to connect to the server. When this thing is out of alpha, I may put a bit more effort into making deployment easier for others.

When you have set up the scripts so they work for you, run

```bash
pnpm setup:server   # one-time: installs Node, pnpm, creates user, nginx, systemd, .env
pnpm ship           # builds frontend + backend, deploys both to server
```

## Tech stack

### Client

| Concern        | Choice                           |
| -------------- | -------------------------------- |
| Framework      | Expo 54 (React Native 0.81.5)    |
| Navigation     | Expo Router (file-based)         |
| Styling        | NativeWind v4 (Tailwind CSS)     |
| Auth storage   | AsyncStorage (JWT token only)    |

### Server

| Concern        | Choice                           |
| -------------- | -------------------------------- |
| Runtime        | Node.js + TypeScript             |
| HTTP           | Express 5                        |
| Database       | SQLite via Prisma (swappable)    |
| Auth           | JWT + bcryptjs                   |
| OAuth          | Apple Sign In, Google OAuth2     |
| Encryption     | AES-256-GCM (API key at rest)    |

### AI

| Task                        | Model                      |
| --------------------------- | -------------------------- |
| Explanation / rejection / chat | Claude Sonnet 4.6 (streaming SSE) |
| Card generation / judgment  | Claude Haiku 4.5           |

---
