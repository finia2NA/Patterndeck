# Client Structure

React Native / Expo app. Communicates with the server via `lib/api.ts` — no direct AI or database calls from the client.

## Directory map

```
client/
├── app/                        ← Expo Router pages (file-based routing)
│   ├── _layout.tsx             ← Root layout: global CSS, theme vars, analytics, KeyboardProvider, Stack nav
│   ├── admin.tsx               ← Admin-only budget settings and user usage monitor
│   ├── index.tsx               ← Auth guard: checks JWT → /onboarding or /home
│   ├── onboarding.tsx          ← Multi-step carousel: welcome, how-it-works, sign-up, API key
│   ├── home.tsx                ← Main screen: deck tree, quick study input, modals
│   ├── session.tsx             ← Study session: card loop, explanation overlay, chat, SRS rating
│   ├── edit-explanation.tsx    ← Dedicated Markdown editor: Monaco + live preview + AI chat (web large-screen only)
│   ├── manual.tsx              ← Static manual / help page (no auth required)
│   └── reset-password.tsx      ← Password reset flow (token from email link)
│
├── components/
│   ├── home/
│   │   ├── DeckTree.tsx                    ← Renders hierarchical collections/decks from the server tree (study, view, edit, history buttons)
│   │   ├── DeckModal.tsx                   ← Tabbed create/edit deck modal (wraps tabs below)
│   │   ├── DeckModalCreateTab.tsx          ← Manual deck creation form
│   │   ├── DeckModalJsonTab.tsx            ← JSON bulk-import tab
│   │   ├── DeckModalSharedCreationFields.tsx ← Shared form fields (topic, language, card count)
│   │   ├── JsonFileDropZone.tsx / .web.tsx  ← File upload drop zone (platform-split)
│   │   ├── SettingsModal.tsx               ← UI language, card sort order, API key management, usage, admin entrypoint
│   │   ├── AddApiKeyForm.tsx               ← Claude API key entry form
│   │   ├── UsageBar.tsx                    ← Monthly budget usage percentage visualization
│   │   ├── DueIndicator.tsx                ← SRS due-date badge on deck items
│   │   ├── LanguagePicker.tsx              ← Language selection dropdown
│   │   ├── ReviewHistoryModal.tsx           ← Review history coordinator modal
│   │   ├── review-history/
│   │   │   ├── ReviewHistoryStats.tsx       ← Due/interval/review summary stats
│   │   │   ├── ReviewHistoryCharts.tsx      ← Interval-over-time and grammar-case difficulty charts
│   │   │   ├── ReviewHistoryTable.tsx       ← Paginated review/event table
│   │   │   ├── ReviewScheduleSection.tsx    ← Due-date picker and reset-to-never-studied controls
│   │   │   └── utils.ts                      ← Review-history date/star formatting helpers
│   │   ├── SectionCard.tsx                 ← Styled section container card
│   │   └── SettingsRow.tsx                 ← Single settings row layout
│   │
│   ├── session/
│   │   ├── FlashcardDeck.tsx               ← Card-by-card UI (prompt + answer input)
│   │   ├── SessionTopBar.tsx               ← Study session header (progress, close)
│   │   ├── SessionCompleteScreen.tsx       ← Session-finished screen
│   │   ├── DeckRatingCard.tsx              ← Post-session SRS rating UI (user + AI stars)
│   │   ├── ExplanationOverlay.tsx          ← Full-screen explanation view
│   │   ├── ExplanationPanel.tsx            ← Side-panel reference during practice
│   │   ├── GrammarMarkdown.tsx             ← Renders server-streamed Markdown explanations
│   │   ├── CardChat.tsx                    ← In-session chat about the current card
│   │   ├── ClickableEnglishSentence.tsx    ← Tappable English prompt with word lookup
│   │   └── FuriganaText.tsx               ← Japanese furigana renderer
│   │
│   ├── editor/
│   │   ├── MonacoEditor.web.tsx            ← Monaco editor wrapper (web only; markdown, live AI value sync)
│   │   ├── MonacoEditor.tsx                ← Native stub (returns null)
│   │   ├── ExplanationChat.tsx             ← AI chat panel for agentic search/replace explanation edits
│   │   ├── ResizeHandle.tsx                ← Draggable vertical divider (web pointer events + native PanResponder)
│   │   └── ResizablePanels.tsx             ← N-panel flex layout with draggable dividers between each pair
│   │
│   ├── tutorial/
│   │   └── TutorialOverlay.tsx             ← Step-by-step tutorial overlay: highlights target elements, floating card with back/next/skip
│   │
│   ├── onboarding/
│   │   ├── AccountCard.tsx                 ← Account creation step (email/password or OAuth)
│   │   ├── ApiKeyCard.tsx                  ← API key entry + validation step
│   │   └── ForgotPasswordCard.tsx          ← Forgot-password flow within onboarding
│   │
│   ├── pickers/                            ← Platform-aware date/time picker subsystem
│   │   ├── DatePicker.tsx / TimePicker.tsx ← Public-facing picker components
│   │   ├── DatePickerContent.tsx / .web.tsx
│   │   ├── DatePickerTrigger.tsx / .web.tsx
│   │   ├── TimePickerContent.tsx / .web.tsx
│   │   ├── TimePickerTrigger.tsx / .web.tsx
│   │   ├── PlatformPopover.tsx / .web.tsx  ← Legacy iOS sheet fallback vs web popover
│   │   ├── dateTimePickerPlatform.ts / .ios.ts / .web.ts
│   │   ├── dateUtils.ts / timeUtils.ts     ← Formatting helpers
│   │   └── useWebPopoverPosition.ts        ← Web popover anchor positioning
│   │
│   ├── AnimatedCollapsible.tsx             ← Collapsible section with height animation
│   ├── AnimatedTabbed.tsx                  ← Animated tab switcher
│   ├── BrandLogo.tsx                       ← App logo using the in-app light mark
│   ├── Icon.tsx / Icon.ios.tsx / Icon.types.ts ← Cross-platform icon system
│   ├── NeedsConfirmationButton.tsx         ← Two-tap confirmation button
│   ├── OnboardingBackground.tsx            ← Decorative onboarding background
│   ├── PageSheetModal.tsx                  ← Bottom-sheet style modal container
│   ├── PageSheetScrollContext.ts           ← Scroll state context for sheet modals
│   ├── PlatformButton.tsx / .ios.tsx       ← Button wrapper (native UIButton on iOS, RN touchable elsewhere)
│   ├── PillDropdown.tsx / .ios.tsx / .web.tsx ← Generic pill-style dropdown (platform-split)
│   ├── PullDownCard.tsx                    ← Card with pull-down dismiss gesture
│   ├── RainbowButton.tsx                   ← Accent-gradient button
│   ├── ThemedSwitch.tsx / .web.tsx         ← Toggle switch (platform-split: CSS knob on web, RN Switch on native)
│   └── TouchTarget.tsx                     ← Minimum-size touch target wrapper
│
├── hooks/
│   ├── useDeckTree.ts          ← Fetches and caches the full deck tree from server
│   ├── useSessionLoader.ts     ← Loads explanation + cards for a quick-study session
│   ├── useSessionCards.ts      ← Card state management during an active session
│   ├── useMultiDeckSession.ts  ← Assembles a multi-deck session from a collection
│   ├── useScreenSize.ts        ← Responsive breakpoint / screen dimension hook
│   ├── useRequireAdmin.ts      ← Redirects non-admin users and gates admin-only UI rendering
│   ├── use-color-scheme.ts / .web.ts ← Platform-specific color scheme detection
│   ├── use-theme-color.ts      ← Resolves a theme token to a concrete color value
│   ├── useTutorial.ts          ← Returns tutorial visible state + onDone; persists completion in AsyncStorage
│   └── state/
│       └── persistent/
│           ├── useSettings.ts  ← Hook for reading/writing persisted user settings
│           └── settingsStore.ts ← Zustand-style settings store (UI language, study languages, sort order, etc.)
│
├── lib/
│   ├── api.ts                  ← All HTTP calls to the server (auth, tree, decks, AI)
│   ├── analytics.tsx           ← PostHog provider + event helpers
│   ├── format.ts               ← Date/number formatting utilities, including usage percent formatting
│   ├── i18n.ts                 ← UI locale detection, translations, and study-language filtering
│   ├── notifications.ts        ← Expo push token registration + permission request
│   ├── platformAlert.ts        ← Platform-aware alert (native Alert vs web confirm)
│   ├── storage.ts              ← AsyncStorage wrapper (auth token, user id/email/role, collapsed tree state, backend override)
│   └── types.ts                ← Shared TypeScript types (Card, TreeNode, DeckData, ChatMessage)
│
├── constants/
│   ├── theme.ts                ← Dark / light colour palettes
│   └── session.ts              ← Re-exports from @patterndeck/shared (languages, card count options)
│
├── modules/
│   ├── native-date-time-picker/ ← Custom iOS page-sheet date/time picker presenter
│   ├── pill-dropdown/          ← Custom native dropdown module (iOS + web implementations)
│   └── platform-button/        ← Custom native iOS UIButton module
│
├── public/
│   ├── index.html              ← SPA HTML shell with pre-JS loading screen
│   └── logo*.svg               ← Public web logo assets
│
└── assets/
    └── images/                 ← App icon, splash screen, etc.
```

## Shared package (`@patterndeck/shared`)

Constants and types shared between client and server live in `shared/` at the repo root and are imported as `@patterndeck/shared`. The client re-exports everything through `constants/session.ts` so existing import paths don't change. UI locale constants currently support English (`en`), German (`de`), and Japanese (`ja`).

`metro.config.js` has a custom `resolveRequest` hook that remaps `.js` imports to `.ts` — this is needed because TypeScript's NodeNext module resolution requires `.js` extensions in source files, but Metro takes them literally and can't find the `.ts` files otherwise. The alternative would be using `"moduleResolution": "bundler"` in shared's tsconfig (no extensions required), but that would need a separate build step for production.

## Key files to know

### `app/_layout.tsx`
Root of the app. Imports `global.css` (NativeWind), sets CSS variable theme tokens for light/dark mode, wraps everything in the PostHog analytics provider and `KeyboardProvider`, and declares the Stack navigator.

### `app/index.tsx`
Acts as the auth guard. On mount it reads the stored JWT from AsyncStorage, validates it against `GET /api/auth/me`, and redirects to `/onboarding` (no valid auth) or `/home` (authenticated).

### `app/onboarding.tsx`
Multi-step swipe carousel using individual card components from `components/onboarding/`:
1. Welcome
2. How it works
3. Account creation (`AccountCard` — email + password, or Apple/Google; includes forgot-password via `ForgotPasswordCard`)
4. Claude API key entry + validation (`ApiKeyCard`)

### `app/home.tsx`
Main hub. Contains:
- **Quick study** — topic input, language picker, card count → launches `/session`
- **Deck tree** — renders `DeckTree.tsx`, supports create / edit / delete / rename / move / view explanation
- **Settings modal** — UI language, sort order, API key status, usage bar
- **Explanation viewer** — navigates to `/session?explainOnly=true` for a read-only explanation view (no cards)

### `app/session.tsx`
Handles two modes:
- **QuickSession** — one-off topic entered on the home screen
- **DeckSession** — saved deck or collection (fetches descendant deck IDs, loads all cards)

Both modes share `SessionUI`: explanation overlay, card loop (`FlashcardDeck`), chat panel (`CardChat`), and post-session rating (`DeckRatingCard` → `SessionCompleteScreen`). Ratings feed the SRS scheduler on the server.

### `app/reset-password.tsx`
Handles the deep-link from a password reset email. Reads the token from the URL, lets the user set a new password, and redirects to onboarding on success.

### `lib/api.ts`
The single place all server communication happens. Uses environment-aware base URL: production web uses relative `/api/v1` (same origin via nginx), native production uses `extra.productionBackendBaseUrl`, and dev uses the configured host/port from `app.config.ts` → `extra` with an optional persisted backend override. Production builds ignore persisted backend overrides. Exports typed functions for every endpoint group:
- `register`, `login`, `loginWithApple`, `loginWithGoogle`, `getMe`, `validateApiKey`
- `requestPasswordReset`, `resetPassword`
- `setApiKey`, `deleteApiKey`, `getApiKeyStatus`
- `getTree`, `getNode`, `getNodePath`, `getDescendantDeckIds`, `deleteNode`
- `createDeckFromPath`, `getDeck`, `updateDeck`, `markStudied`, `submitDeckReview`
- `getSetting`, `setSetting`
- `generateExplanation` (SSE), `explainRejection` (SSE), `chatAboutCard` (SSE)
- `generateCards`, `judgeAnswer`
- `registerPushToken`, `unregisterPushToken`
- `getAdminUsers`, `updateAdminConfig`

SSE endpoints return an async generator consumed via `streamSSE()`.

### `lib/types.ts`
Core types shared across the client:
```typescript
Card            { id, english, targetLanguage, sentenceContext?, notes? }
TreeNode        { id, parentId, name, sortOrder, deck, children[] }
DeckData        { nodeId, topic, language, explanation, explanationStatus, grammarCaseStatus, cardCount, lastStudiedAt, dueAt, intervalDays }
ChatMessage     { role, content }
```

## Styling

NativeWind v4 (Tailwind CSS for React Native). Theme tokens are CSS custom properties set in `_layout.tsx`:
- `bg-background` / `text-foreground` — page background and default text
- `bg-card` — card container surfaces
- `bg-primary` / `text-primary-foreground` — primary action colour
- `bg-muted` / `text-muted-foreground` — secondary / disabled text

Both light and dark palettes are defined; the active palette follows `prefers-color-scheme`.

> **NativeWind note:** `nativewind/babel` must be in `presets` in `babel.config.js`, not `plugins`.
