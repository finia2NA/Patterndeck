import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useColors } from '@/constants/theme';
import { rateSession } from '@/lib/api';
import type { CardAttempt } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

export interface DeckReviewDraft {
  userStars: number;
  aiStars: number;
  aiRecap: string;
}

interface DeckRatingCardProps {
  nodeId: string;
  topic: string;
  language: string;
  cards: CardAttempt[];
  disabled?: boolean;
  studySessionId?: string;
  onDraftChange: (nodeId: string, draft: DeckReviewDraft) => void;
}

export function DeckRatingCard({ nodeId, topic, language, cards, disabled = false, studySessionId, onDraftChange }: DeckRatingCardProps) {
  const colors = useColors();
  const { t } = useI18n();
  const [aiStars, setAiStars] = useState<number | null>(null);
  const [userStars, setUserStars] = useState<number | null>(null);
  const [recap, setRecap] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAiStars(null);
    setUserStars(null);
    setRecap('');
    rateSession(topic, language, cards, {
      studySessionId,
      deckId: nodeId,
      deckTopic: topic,
      language,
      traceId: studySessionId ? `session_rating:${studySessionId}:${nodeId}` : undefined,
    })
      .then(result => {
        if (cancelled) return;
        setAiStars(result.stars);
        setUserStars(result.stars);
        setRecap(result.recap);
        setLoading(false);
        onDraftChange(nodeId, { userStars: result.stars, aiStars: result.stars, aiRecap: result.recap });
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to a neutral rating if AI fails
        setAiStars(3);
        setUserStars(3);
        setRecap('');
        setLoading(false);
        onDraftChange(nodeId, { userStars: 3, aiStars: 3, aiRecap: '' });
      });
    return () => { cancelled = true; };
  }, [nodeId, topic, language, cards, onDraftChange, studySessionId]);

  const stars = loading ? 0 : (userStars ?? aiStars ?? 3);

  return (
    <View className="rounded-2xl p-1 gap-3">
      <Text className="text-foreground font-medium text-sm">{t('session.deckFeel')}</Text>

      {loading ? (
        <View className="flex-row items-center gap-3 py-2">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text className="text-foreground-secondary text-sm">{t('session.aiRating')}</Text>
        </View>
      ) : (
        <>
          {recap.length > 0 && (
            <Text className="text-foreground-secondary text-sm leading-5">{recap}</Text>
          )}
        </>
      )}

      {/* Star selector */}
      <View className="flex-row gap-2">
        {[1, 2, 3, 4, 5].map(n => (
          <TouchableOpacity
            key={n}
            onPress={() => {
              if (loading || disabled) return;
              setUserStars(n);
              onDraftChange(nodeId, { userStars: n, aiStars: aiStars ?? 3, aiRecap: recap });
            }}
            disabled={loading || disabled}
            style={{ padding: 4 }}
            activeOpacity={0.7}
          >
            <Text
              style={{
                fontSize: 28,
                color: n <= stars ? (colors.foreground as string) : (colors.foreground_muted as string),
                opacity: loading || disabled ? 0.5 : 1,
              }}
            >
              {n <= stars ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
