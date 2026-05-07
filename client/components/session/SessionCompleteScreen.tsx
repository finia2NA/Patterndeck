import { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/constants/theme';
import { submitDeckReview } from '@/lib/api';
import { DID_NOT_KNOW_ANSWER, type CardAttempt } from '@/lib/types';
import type { DeckInfo } from '@/hooks/useMultiDeckSession';
import { DeckRatingCard, type DeckReviewDraft } from './DeckRatingCard';
import { useI18n } from '@/lib/i18n';

interface SessionCompleteScreenProps {
  completedCards: CardAttempt[];
  decks: Map<string, DeckInfo>;
  studyMode: 'scheduled' | 'early';
  studySessionId?: string;
  onDone: () => void | Promise<void>;
  onMakeDeck?: () => void;
  quickDeckCreated?: boolean;
}

function AttemptRow({ attempt }: { attempt: CardAttempt }) {
  const wrongAnswers = attempt.answers.slice(0, -1);
  const correctAnswer = attempt.answers[attempt.answers.length - 1];
  return (
    <View className="gap-1 py-3 border-b border-foreground/10">
      <Text className="text-foreground text-sm font-medium">{attempt.card.english}</Text>
      {wrongAnswers.map((wrong, i) => wrong === DID_NOT_KNOW_ANSWER ? (
        <Text key={i} className="text-foreground-secondary text-xs ml-2">✗ {DID_NOT_KNOW_ANSWER}</Text>
      ) : (
        <Text key={i} className="text-error text-xs ml-2">✗ {wrong}</Text>
      ))}
      <Text className="text-success text-xs ml-2">✓ {correctAnswer}</Text>
    </View>
  );
}

export function SessionCompleteScreen({
  completedCards,
  decks,
  studyMode,
  studySessionId,
  onDone,
  onMakeDeck,
  quickDeckCreated = false,
}: SessionCompleteScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useI18n();

  const { isQuickStudy, deckGroupEntries, quickCards } = useMemo(() => {
    // Group cards by deckId (undefined = quick study)
    const deckGroups = new Map<string | undefined, CardAttempt[]>();
    for (const attempt of completedCards) {
      const key = attempt.deckId;
      if (!deckGroups.has(key)) deckGroups.set(key, []);
      deckGroups.get(key)!.push(attempt);
    }
    return {
      isQuickStudy: deckGroups.size === 1 && deckGroups.has(undefined),
      deckGroupEntries: Array.from(deckGroups.entries()).filter(([k]) => k !== undefined) as [string, CardAttempt[]][],
      quickCards: deckGroups.get(undefined) ?? [],
    };
  }, [completedCards]);

  const [deckReviewDrafts, setDeckReviewDrafts] = useState<Record<string, DeckReviewDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const allRatingsReady = isQuickStudy || deckGroupEntries.every(([id]) => deckReviewDrafts[id] !== undefined);

  const handleDeckDraftChange = useCallback((nodeId: string, draft: DeckReviewDraft) => {
    setDeckReviewDrafts(prev => {
      const current = prev[nodeId];
      if (
        current &&
        current.userStars === draft.userStars &&
        current.aiStars === draft.aiStars &&
        current.aiRecap === draft.aiRecap
      ) {
        return prev;
      }
      return { ...prev, [nodeId]: draft };
    });
  }, []);
  const doneDisabled = submitting || (!isQuickStudy && !allRatingsReady);

  const handleDone = useCallback(async () => {
    if (doneDisabled) return;
    setSaveError(null);
    if (!isQuickStudy) {
      setSubmitting(true);
      try {
        await Promise.all(deckGroupEntries.map(async ([deckId, attempts]) => {
          const draft = deckReviewDrafts[deckId];
          if (!draft) throw new Error(t('session.ratingWaitError'));
          const correctCount = attempts.filter(a => a.answers.length === 1).length;
          const totalCount = attempts.length;
          await submitDeckReview(deckId, draft.userStars, draft.aiStars, draft.aiRecap, studyMode, studySessionId, correctCount, totalCount);
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : t('session.reviewSaveError');
        setSaveError(message);
        setSubmitting(false);
        return;
      } finally {
        setSubmitting(false);
      }
    }
    await onDone();
  }, [doneDisabled, isQuickStudy, deckGroupEntries, deckReviewDrafts, onDone, studyMode, studySessionId, t]);

  const totalCards = completedCards.length;
  const firstTryCorrect = completedCards.filter(a => a.answers.length === 1).length;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, gap: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="items-center gap-2 py-4">
          <Text className="text-5xl">🎉</Text>
          <Text className="text-foreground text-2xl font-bold">{t('session.complete')}</Text>
          <Text className="text-foreground-secondary text-sm text-center">
            {t('session.cardsCorrect', { correct: firstTryCorrect, total: totalCards })}
          </Text>
        </View>

        {/* Quick study cards (no deck) */}
        {quickCards.length > 0 && (
          <View className="bg-surface border border-border rounded-3xl p-6 gap-1">
            <View className="flex-row items-center justify-between gap-3 mb-2">
              <Text className="text-foreground font-semibold text-base">{t('session.cardsReviewed')}</Text>
              {onMakeDeck && (
                <TouchableOpacity
                  className={`px-3 py-2 rounded-xl ${quickDeckCreated ? 'bg-background-muted' : 'bg-primary'}`}
                  onPress={onMakeDeck}
                  disabled={quickDeckCreated}
                  activeOpacity={0.85}
                >
                  <Text className={`text-xs font-semibold ${quickDeckCreated ? 'text-foreground-muted' : 'text-primary-foreground'}`}>
                    {quickDeckCreated ? t('session.deckCreated') : t('session.makeDeck')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {quickCards.map((a, i) => <AttemptRow key={i} attempt={a} />)}
          </View>
        )}

        {/* Per-deck sections */}
        {deckGroupEntries.map(([deckId, deckCards]) => {
          const info = decks.get(deckId);
          return (
            <View key={deckId} className="bg-surface border border-border rounded-3xl p-6 gap-4">
              <View className="gap-1">
                <Text className="text-foreground font-semibold text-base mb-2">
                  {info?.deckName ?? t('session.deck')}
                </Text>
                {deckCards.map((a, i) => <AttemptRow key={i} attempt={a} />)}
              </View>

              {info && (
                <DeckRatingCard
                  nodeId={deckId}
                  topic={info.topic}
                  language={info.language}
                  cards={deckCards}
                  disabled={submitting}
                  studySessionId={studySessionId}
                  onDraftChange={handleDeckDraftChange}
                />
              )}
            </View>
          );
        })}

        {saveError && (
          <Text className="text-error text-sm text-center">{saveError}</Text>
        )}

        <TouchableOpacity
          className={`rounded-2xl py-4 items-center ${doneDisabled ? 'bg-background-muted' : 'bg-primary'}`}
          onPress={handleDone}
          disabled={doneDisabled}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.primary_foreground} />
          ) : (
            <Text className={`font-bold text-base ${doneDisabled ? 'text-foreground-muted' : 'text-primary-foreground'}`}>
              {!isQuickStudy && !allRatingsReady ? t('session.waitingRatings') : t('common.done')}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
