import { useState, useEffect, useRef } from 'react';
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
import { createDeckFromPath } from '@/lib/api';
import type { Card, DeckCard } from '@/lib/types';
import type { CardCount } from '@/constants/session';
import { useSessionLoader } from '@/hooks/useSessionLoader';
import { useMultiDeckSession } from '@/hooks/useMultiDeckSession';
import type { DeckInfo } from '@/hooks/useMultiDeckSession';
import type { OverlayDeck } from '@/components/session';
import { DeckModal, type DeckFormData } from '@/components/home/DeckModal';
import { useSessionCards } from '@/hooks/useSessionCards';
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

const SIDEBAR_INITIAL_WIDTH = 320;

// ─── Route entry point ──────────────────────────────────────────────────────

export default function Session() {
  const params = useLocalSearchParams<{
    topic?: string; language?: string; count?: string; nodeId?: string; studyMode?: 'scheduled' | 'early'; deckIds?: string;
  }>();

  if (params.nodeId) {
    const selectedDeckIds = params.deckIds
      ? String(params.deckIds).split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    const studyMode = params.studyMode === 'early' ? 'early' : 'scheduled';
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
  const loader = useSessionLoader({ topic, language, cardCount });

  return (
    <SessionUI
      loading={loader.loading}
      loadPhase={loader.loadPhase}
      loadError={loader.loadError}
      setLoadError={loader.setLoadError}
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
  const multi = useMultiDeckSession({ nodeId, selectedDeckIds });
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
      loading={multi.loading}
      loadPhase="cards"
      loadError={multi.loadError}
      setLoadError={multi.setLoadError}
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
    />
  );
}

// ─── Shared session UI ──────────────────────────────────────────────────────

interface SessionUIProps {
  loading: boolean;
  loadPhase: 'explanation' | 'cards';
  loadError: string | null;
  setLoadError: (e: string | null) => void;
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
}

function SessionUI({
  loading, loadPhase, loadError, setLoadError,
  cards, setCards, totalCost, addCost,
  explanation, wasTruncated, topic, clarification, language,
  showExplanationOverlay, markStudied, deckName, overlayDecks, decks, studyMode = 'scheduled',
  quickStudyCardCount,
}: SessionUIProps) {
  const router = useRouter();
  const { isSmallScreen } = useScreenSize();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const [showOverlay, setShowOverlay] = useState(showExplanationOverlay);
  const [panelNarrowed, setPanelNarrowed] = useState(false);
  const [hasContentBelow, setHasContentBelow] = useState(false);
  const studiedRef = useRef(false);
  const [quickDeckModalVisible, setQuickDeckModalVisible] = useState(false);
  const [quickDeckCreated, setQuickDeckCreated] = useState(false);

  const session = useSessionCards({
    cards, setCards, language, explanation, addCost, setLoadError, showOverlay,
  });

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
          <Text className="text-foreground font-semibold">← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render: loading (deck/collection mode, no overlay) ─────────────────────

  if (loading && !showOverlay) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8 gap-4" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text className="text-foreground-secondary text-base">Generating flashcards…</Text>
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
    showHint: session.showHint,
    onToggleHint: session.toggleHint,
    onSubmitAnswer: session.handleSubmitAnswer,
    onConfirmCorrect: session.handleConfirmCorrect,
    onConfirmWrong: session.handleConfirmWrong,
    inputRef: session.inputRef,
    chatMessages: session.chatMessages,
    chatStreaming: session.chatStreaming,
    onChatSend: session.handleChatSend,
    deckName,
    hintCache: session.hintCache,
    addCost,
    vocabHintDismissSignal: session.vocabHintDismissSignal,
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
    </View>
  );
}
