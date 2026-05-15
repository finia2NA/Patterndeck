import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, useColors } from '@/constants/theme';
import { createDeckFromPath, getDeck } from '@/lib/api';
import type { AnalyticsContext, Card, DeckCard, LoadPhase } from '@/lib/types';
import type { CardCount } from '@/constants/session';
import { useSessionLoader } from '@/hooks/useSessionLoader';
import { useMultiDeckSession } from '@/hooks/useMultiDeckSession';
import type { DeckInfo } from '@/hooks/useMultiDeckSession';
import type { OverlayDeck } from '@/components/session';
import { DeckModal, type DeckFormData } from '@/components/home/DeckModal';
import { ErrorPopup } from '@/components/ErrorPopup';
import { useSessionCards } from '@/hooks/useSessionCards';
import { useErrorPopup } from '@/hooks/useErrorPopup';
import { formatCost } from '@/lib/format';

import {
  SidePanel,
  BottomSheet,
  ExplanationOverlay,
  FlashcardDeck,
  SessionCompleteScreen,
  PEEK_HEIGHT,
} from '@/components/session';
import { SessionTopBar, TOPBAR_HEIGHT } from '@/components/session/SessionTopBar';
import { useScreenSize } from '@/hooks/useScreenSize';
import { analytics, appSessionId } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

const SIDEBAR_INITIAL_WIDTH = 320;

function createStudySessionId() {
  return `study_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Route entry point ──────────────────────────────────────────────────────

export default function Session() {
  const params = useLocalSearchParams<{
    topic?: string; language?: string; count?: string; nodeId?: string; studyMode?: 'scheduled' | 'early'; deckIds?: string; explainOnly?: string;
  }>();

  if (params.nodeId) {
    const selectedDeckIds = params.deckIds
      ? String(params.deckIds).split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    const studyMode = params.studyMode === 'early' ? 'early' : 'scheduled';
    const explainOnly = params.explainOnly === 'true';

    if (explainOnly) {
      return <ExplainOnlyView nodeId={params.nodeId} />;
    }

    return <DeckSession nodeId={params.nodeId} selectedDeckIds={selectedDeckIds} studyMode={studyMode} />;
  }

  return (
    <QuickSession
      topic={params.topic!}
      language={params.language!}
      cardCount={parseInt(params.count ?? '0', 10)}
    />
  );
}

// ─── Quick study (one-off, old flow) ────────────────────────────────────────

function QuickSession({ topic, language, cardCount }: { topic: string; language: string; cardCount: number }) {
  const studySessionId = useRef(createStudySessionId()).current;
  const analyticsContext = useRef<AnalyticsContext>({
    studySessionId,
    appSessionId,
    deckTopic: topic,
    language,
    studyMode: 'quick',
  }).current;
  const loader = useSessionLoader({ topic, language, cardCount, analyticsContext });

  return (
    <SessionUI
      studySessionId={studySessionId}
      loading={loader.loading}
      loadPhase={loader.loadPhase}
      loadError={loader.loadError}
      cards={loader.cards}
      setCards={loader.setCards}
      totalCost={loader.totalCost}
      addCost={loader.addCost}
      explanation={loader.explanation}
      wasTruncated={loader.explanationTruncated}
      topic={topic}
      language={language}
      showExplanationOverlay
      markStudied={async () => {}}
      quickStudyCardCount={cardCount}
      analyticsBase={analyticsContext}
    />
  );
}

// ─── Deck / collection study ────────────────────────────────────────────────

function DeckSession({
  nodeId,
  selectedDeckIds,
  studyMode,
}: {
  nodeId: string;
  selectedDeckIds?: string[];
  studyMode: 'scheduled' | 'early';
}) {
  const studySessionId = useRef(createStudySessionId()).current;
  const multi = useMultiDeckSession({ nodeId, selectedDeckIds, studySessionId, studyMode });
  const [language, setLanguage] = useState('');

  useEffect(() => {
    if (multi.decks.size > 0 && !language) {
      const firstId = multi.decks.keys().next().value;
      if (firstId) {
        import('@/lib/api').then(({ getDeck }) => {
          getDeck(firstId).then(d => { if (d) setLanguage(d.language); });
        });
      }
    }
  }, [multi.decks, language]);

  const currentDeckId = multi.cards.length > 0 ? multi.cards[0].deckId : null;
  const currentDeck: DeckInfo | undefined = currentDeckId ? multi.decks.get(currentDeckId) : undefined;
  const firstDeck: DeckInfo | undefined = multi.decks.size > 0
    ? multi.decks.values().next().value
    : undefined;
  const displayDeck = currentDeck ?? firstDeck;

  const overlayDecks: OverlayDeck[] = Array.from(multi.decks.entries()).map(([, info]) => ({
    topic: info.topic,
    clarification: info.clarification,
    deckName: info.deckName,
    explanation: info.explanation,
    wasTruncated: info.wasTruncated,
  }));

  return (
    <SessionUI
      studySessionId={studySessionId}
      loading={multi.loading}
      loadPhase="cards"
      loadError={multi.loadError}
      cards={multi.cards}
      setCards={multi.setCards}
      totalCost={multi.totalCost}
      addCost={multi.addCost}
      explanation={displayDeck?.explanation ?? ''}
      wasTruncated={displayDeck?.wasTruncated ?? false}
      topic={displayDeck?.topic ?? ''}
      clarification={displayDeck?.clarification ?? null}
      language={language}
      showExplanationOverlay
      markStudied={multi.markStudied}
      deckName={displayDeck?.deckName}
      overlayDecks={overlayDecks}
      decks={multi.decks}
      studyMode={studyMode}
      analyticsBase={{ studySessionId, appSessionId, studyMode }}
    />
  );
}

// ─── Explain-only view (from home screen "view" button) ───────────────

function ExplainOnlyView({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState('');
  const [clarification, setClarification] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');

  useEffect(() => {
    let cancelled = false;
    getDeck(nodeId).then((deck: any) => {
      if (cancelled || !deck) return;
      if (deck.explanationStatus !== 'ready' || deck.grammarCaseStatus !== 'ready') {
        router.replace('/home');
        return;
      }
      setTopic(deck.topic ?? '');
      setClarification(deck.clarification ?? null);
      setExplanation(deck.explanation ?? '');
    }).catch((err: any) => {
      console.error('Failed to load deck for viewing:', err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [nodeId, router]);

  return (
    <ExplanationOverlay
      topic={topic}
      clarification={clarification}
      explanation={explanation}
      wasTruncated={false}
      loading={loading}
      loadPhase="fetching"
      onBack={() => router.replace('/home')}
      insets={insets}
    />
  );
}

// ─── Shared session UI ──────────────────────────────────────────────────────

interface SessionUIProps {
  studySessionId: string;
  loading: boolean;
  loadPhase: LoadPhase;
  loadError: string | null;
  cards: (Card | DeckCard)[];
  setCards: (fn: any) => void;
  totalCost: number;
  addCost: (usd: number) => void;
  explanation: string;
  wasTruncated: boolean;
  topic: string;
  clarification?: string | null;
  language: string;
  showExplanationOverlay: boolean;
  markStudied: () => Promise<void>;
  deckName?: string;
  overlayDecks?: OverlayDeck[];
  decks?: Map<string, DeckInfo>;
  studyMode?: 'scheduled' | 'early';
  quickStudyCardCount?: number;
  analyticsBase: AnalyticsContext;
}

function SessionUI({
  studySessionId,
  loading, loadPhase, loadError,
  cards, setCards, totalCost, addCost,
  explanation, wasTruncated, topic, clarification, language,
  showExplanationOverlay, markStudied, deckName, overlayDecks, decks, studyMode = 'scheduled',
  quickStudyCardCount, analyticsBase,
}: SessionUIProps) {
  const router = useRouter();
  const { isSmallScreen } = useScreenSize();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useI18n();

  const [showOverlay, setShowOverlay] = useState(showExplanationOverlay);
  const [panelNarrowed, setPanelNarrowed] = useState(false);
  const [hasContentBelow, setHasContentBelow] = useState(false);
  const { errorPopup, showError, dismissError } = useErrorPopup();
  const studiedRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  const startedTrackedRef = useRef(false);
  const loadedTrackedRef = useRef(false);
  const completedTrackedRef = useRef(false);
  const exitedTrackedRef = useRef(false);
  const latestExitStateRef = useRef({ cardsRemaining: 0, cardsCompleted: 0, totalCost: 0, studyMode: 'quick' });
  const [quickDeckModalVisible, setQuickDeckModalVisible] = useState(false);
  const [quickDeckCreated, setQuickDeckCreated] = useState(false);

  const session = useSessionCards({
    cards, setCards, language, explanation, addCost, showErrorPopup: showError, showOverlay,
    analyticsContext: analyticsBase,
    deckInfoById: decks,
  });

  const deckSummary = useCallback(() => {
    const deckList = decks ? Array.from(decks.values()) : [];
    const dueAges = deckList
      .map(deck => deck.dueAt ? Math.max(0, Date.now() - deck.dueAt) / 36e5 : null)
      .filter((value): value is number => value !== null);
    const maxDueAge = dueAges.length ? Math.max(...dueAges) : 0;
    return {
      deck_count: deckList.length,
      due_deck_count: deckList.filter(deck => deck.isDue).length,
      early_deck_count: deckList.filter(deck => !deck.isDue).length,
      avg_due_age_hours: dueAges.length ? dueAges.reduce((sum, value) => sum + value, 0) / dueAges.length : 0,
      max_due_age_hours: maxDueAge,
      due_bucket: maxDueAge >= 24 * 7 ? 'week_plus' : maxDueAge >= 24 ? 'day_plus' : maxDueAge > 0 ? 'same_day' : 'not_due',
    };
  }, [decks]);

  useEffect(() => {
    if (startedTrackedRef.current) return;
    if (decks && decks.size === 0 && loading) return;
    startedTrackedRef.current = true;
    analytics.track('study_session_started', {
      study_session_id: studySessionId,
      study_mode: decks && decks.size > 0 ? studyMode : 'quick',
      planned_card_count: quickStudyCardCount,
      language,
      deck_topic: topic,
      deck_name: deckName,
      ...deckSummary(),
    });
  }, [deckName, deckSummary, decks, language, loading, quickStudyCardCount, studyMode, studySessionId, topic]);

  useEffect(() => {
    if (loadedTrackedRef.current || loading || cards.length === 0) return;
    loadedTrackedRef.current = true;
    analytics.track('study_session_cards_loaded', {
      study_session_id: studySessionId,
      study_mode: decks && decks.size > 0 ? studyMode : 'quick',
      loaded_card_count: cards.length,
      total_ai_cost_usd: totalCost,
      language,
      deck_topic: topic,
      deck_name: deckName,
      ...deckSummary(),
    });
  }, [cards.length, deckName, deckSummary, decks, language, loading, studyMode, studySessionId, topic, totalCost]);

  useEffect(() => {
    if (completedTrackedRef.current || loading || cards.length !== 0 || session.completedCards.length === 0) return;
    completedTrackedRef.current = true;
    const totalCards = session.completedCards.length;
    const firstTryCorrect = session.completedCards.filter(a => a.answers.length === 1).length;
    const totalWrongAttempts = session.completedCards.reduce((sum, attempt) => sum + Math.max(0, attempt.answers.length - 1), 0);
    analytics.track('study_session_completed', {
      study_session_id: studySessionId,
      study_mode: decks && decks.size > 0 ? studyMode : 'quick',
      cards_completed: totalCards,
      first_try_correct_count: firstTryCorrect,
      first_try_correct_rate: totalCards > 0 ? firstTryCorrect / totalCards : 0,
      total_wrong_attempts: totalWrongAttempts,
      cards_with_chat: session.metricsRef.current.chatCardsCount,
      chat_message_count: session.metricsRef.current.chatMessageCount,
      hint_cards_count: session.metricsRef.current.hintCardsCount,
      word_hint_count: session.metricsRef.current.wordHintCount,
      duration_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
      total_ai_cost_usd: totalCost,
      language,
      deck_topic: topic,
      deck_name: deckName,
      ...deckSummary(),
    });
  }, [cards.length, deckName, deckSummary, decks, language, loading, session.completedCards, session.metricsRef, studyMode, studySessionId, topic, totalCost]);

  useEffect(() => {
    latestExitStateRef.current = {
      cardsRemaining: cards.length,
      cardsCompleted: session.completedCards.length,
      totalCost,
      studyMode: decks && decks.size > 0 ? studyMode : 'quick',
    };
  }, [cards.length, decks, session.completedCards.length, studyMode, totalCost]);

  useEffect(() => () => {
    if (completedTrackedRef.current || exitedTrackedRef.current) return;
    exitedTrackedRef.current = true;
    analytics.track('study_session_exited', {
      study_session_id: studySessionId,
      study_mode: latestExitStateRef.current.studyMode,
      cards_remaining: latestExitStateRef.current.cardsRemaining,
      cards_completed: latestExitStateRef.current.cardsCompleted,
      duration_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
      total_ai_cost_usd: latestExitStateRef.current.totalCost,
    });
  }, [studySessionId]);

  useEffect(() => {
    if (!loadError) return;
    analytics.track('session_load_failed', {
      study_session_id: studySessionId,
      study_mode: decks && decks.size > 0 ? studyMode : 'quick',
      error_message: loadError,
      language,
      deck_topic: topic,
      deck_name: deckName,
    });
  }, [deckName, decks, language, loadError, studyMode, studySessionId, topic]);

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/home');
  }

  function handleStartPractising() {
    setPanelNarrowed(true);
    setTimeout(() => {
      setShowOverlay(false);
    }, 420);
  }

  // ── Render: error ──────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8 gap-4" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <Text className="text-error text-base text-center">{loadError}</Text>
        <TouchableOpacity className="bg-surface rounded-xl px-6 py-3" onPress={handleBack}>
          <Text className="text-foreground font-semibold">{t('session.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render: loading (deck/collection mode, no overlay) ─────────────────────

  if (loading && !showOverlay) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8 gap-4" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text className="text-foreground-secondary text-base">{t('session.generatingCards')}</Text>
      </View>
    );
  }

  // ── Render: done ───────────────────────────────────────────────────────────

  if (!loading && cards.length === 0) {
    if (!studiedRef.current) {
      studiedRef.current = true;
      if (!decks || decks.size === 0) markStudied();
    }

    const isQuickSession = !decks || decks.size === 0;
    const quickDeckInitialData = {
      path: '',
      topic,
      clarification: '',
      language,
      cardCount: (quickStudyCardCount ?? 0) as CardCount,
      dueDate: '',
      explanation,
    };

    return (
      <>
        <SessionCompleteScreen
          completedCards={session.completedCards}
          decks={decks ?? new Map()}
          studyMode={studyMode}
          studySessionId={studySessionId}
          onDone={() => router.replace('/home')}
          onMakeDeck={isQuickSession ? () => setQuickDeckModalVisible(true) : undefined}
          quickDeckCreated={quickDeckCreated}
        />
        {isQuickSession && (
          <DeckModal
            visible={quickDeckModalVisible}
            onClose={() => setQuickDeckModalVisible(false)}
            onSubmit={async (data: DeckFormData) => {
              await createDeckFromPath(data.path, data.topic, data.language, data.cardCount, data.clarification, data.explanation);
              setQuickDeckCreated(true);
              setQuickDeckModalVisible(false);
            }}
            initialData={quickDeckInitialData}
          />
        )}
      </>
    );
  }

  // ── Shared flashcard deck props ────────────────────────────────────────────

  const computedTotalSpend = session.beginningTotalSpend !== null
    ? totalCost + session.beginningTotalSpend - (session.beginningSessionCostRef.current ?? 0)
    : null;

    const deckProps = {
    cards, language,
    cardPhase: session.cardPhase,
    answer: session.answer,
    onChangeAnswer: session.setAnswer,
    submittedAnswer: session.submittedAnswer,
    feedback: session.feedback,
    wrongExplanation: session.wrongExplanation,
    wasSkipped: session.wasSkipped,
    showHint: session.showHint,
    onToggleHint: session.toggleHint,
    onSubmitAnswer: session.handleSubmitAnswer,
    onConfirmCorrect: session.handleConfirmCorrect,
    onConfirmWrong: session.handleConfirmWrong,
    onOverrideWrong: session.handleOverrideWrong,
    inputRef: session.inputRef,
    chatMessages: session.chatMessages,
    chatStreaming: session.chatStreaming,
    onChatSend: session.handleChatSend,
    deckName,
    hintCache: session.hintCache,
    addCost,
    vocabHintDismissSignal: session.vocabHintDismissSignal,
    analyticsContext: analyticsBase,
    onWordHint: session.recordWordHint,
  };

  // ── Render: session ────────────────────────────────────────────────────────

  return (
    <View className="flex-1 bg-background">
      {isSmallScreen ? (
        showOverlay ? (
          <ExplanationOverlay
            topic={topic} clarification={clarification} explanation={explanation} wasTruncated={wasTruncated}
            loading={loading} loadPhase={loadPhase}
            onStart={() => setShowOverlay(false)} onBack={handleBack} insets={insets}
            allDecks={overlayDecks}
          />
        ) : (
          <KeyboardAvoidingView
            className="flex-1"
            behavior="height"
            enabled={Platform.OS !== 'ios'}
            onTouchStart={() => session.setVocabHintDismissSignal(prev => prev + 1)}
          >
            <SessionTopBar
              cardsRemaining={cards.length}
              totalCost={totalCost}
              totalSpend={computedTotalSpend}
              onBack={handleBack}
              hasContentBelow={hasContentBelow}
              insetTop={insets.top}
            />
            <ScrollView
              className="flex-1"
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              onScroll={e => {
                const y = e.nativeEvent.contentOffset.y;
                const next = y > 4;
                if (next !== hasContentBelow) setHasContentBelow(next);
              }}
              contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: insets.top + TOPBAR_HEIGHT + 16, paddingBottom: PEEK_HEIGHT + insets.bottom + 32 }}
            >
              <FlashcardDeck {...deckProps} />
            </ScrollView>
          </KeyboardAvoidingView>
        )
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View className="flex-1 flex-row bg-background">
            {!showOverlay ? (
                <SidePanel topic={topic} clarification={clarification} explanation={explanation} wasTruncated={wasTruncated} />
            ) : (
              <View style={[
                { overflow: 'hidden' as const },
                Platform.OS === 'web'
                  ? { transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)', width: panelNarrowed ? SIDEBAR_INITIAL_WIDTH : '100%' } as any
                  : { width: panelNarrowed ? SIDEBAR_INITIAL_WIDTH : '100%' },
              ]}>
                <ExplanationOverlay
                  topic={topic} clarification={clarification} explanation={explanation} wasTruncated={wasTruncated}
                  loading={loading} loadPhase={loadPhase}
                  onStart={handleStartPractising} onBack={handleBack} insets={insets}
                  allDecks={overlayDecks}
                />
              </View>
            )}

            {(panelNarrowed || !showOverlay) && (
              <View style={[
                { flex: 1 },
                Platform.OS === 'web'
                  ? { opacity: showOverlay ? 0 : 1, transition: 'opacity 0.3s ease', pointerEvents: showOverlay ? 'none' : 'auto' } as any
                  : {},
              ]}>
                <ScrollView className="flex-1" contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', flexGrow: 1, paddingHorizontal: 32, paddingVertical: 40 }}>
                  <FlashcardDeck {...deckProps} />
                </ScrollView>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
      {isSmallScreen && !showOverlay && (
        <BottomSheet topic={topic} clarification={clarification} explanation={explanation} wasTruncated={wasTruncated} />
      )}

      {/* Back button + info strip (wide screens only) */}
      {!isSmallScreen && !showOverlay && (
        <>
          <TouchableOpacity
            onPress={handleBack}
            style={{ position: 'absolute', top: insets.top + 8, left: 16, zIndex: 50, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9999, backgroundColor: colors.surface + 'CC' }}
            activeOpacity={0.7}
          >
            <Text className="text-foreground text-base font-semibold">←</Text>
          </TouchableOpacity>
          <View style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 50, alignItems: 'flex-end', gap: 2 }}>
            <Text className="text-foreground-secondary text-sm">
              {cards.length} card{cards.length !== 1 ? 's' : ''} remaining
            </Text>
            <Text className="text-foreground-subtle text-xs font-mono">
              {formatCost(totalCost)}{computedTotalSpend !== null ? ` (${formatCost(computedTotalSpend)} total)` : ''}
            </Text>
          </View>
        </>
      )}
      <ErrorPopup
        visible={errorPopup.visible}
        errorName={errorPopup.errorName}
        message={errorPopup.message}
        onDismiss={dismissError}
      />
    </View>
  );
}
