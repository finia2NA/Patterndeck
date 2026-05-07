import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Colors, useColors } from '@/constants/theme';
import type { LoadPhase } from '@/lib/types';
import { GrammarMarkdown } from './GrammarMarkdown';
import { TruncationWarning } from './ExplanationPanel';
import { useI18n } from '@/lib/i18n';

export interface OverlayDeck {
  topic: string;
  clarification: string | null;
  deckName: string;
  explanation: string;
  wasTruncated: boolean;
}

interface ExplanationOverlayProps {
  topic: string;
  clarification?: string | null;
  explanation: string;
  wasTruncated: boolean;
  loading: boolean;
  loadPhase: LoadPhase;
  onStart: () => void;
  onBack: () => void;
  insets: { top: number; bottom: number };
  allDecks?: OverlayDeck[];
}

export function ExplanationOverlay({
  topic, clarification, explanation, wasTruncated, loading, loadPhase, onStart, onBack, insets, allDecks,
}: ExplanationOverlayProps) {
  const { t } = useI18n();
  const colors = useColors();
  const [deckIndex, setDeckIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const hasMultiple = allDecks && allDecks.length > 1;

  const displayTopic = hasMultiple ? allDecks[deckIndex].topic : topic;
  const displayClarification = hasMultiple ? allDecks[deckIndex].clarification : clarification;
  const displayExplanation = hasMultiple ? allDecks[deckIndex].explanation : explanation;
  const displayTruncated = hasMultiple ? allDecks[deckIndex].wasTruncated : wasTruncated;
  const displayName = hasMultiple ? allDecks[deckIndex].deckName : undefined;

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [deckIndex]);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-8"
        contentContainerStyle={{
          maxWidth: 720,
          alignSelf: 'center',
          width: '100%',
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <TouchableOpacity
            onPress={onBack}
            activeOpacity={0.7}
            style={styles.backButton}
          >
            <Text style={{ color: colors['foreground'] as string, opacity: 0.7, fontSize: 14, fontWeight: '600' }}>←</Text>
          </TouchableOpacity>
          <Text className="text-foreground-secondary text-xs font-semibold uppercase tracking-widest">
            Grammar Explanation
            {hasMultiple && (
              <Text className="text-foreground-muted"> — {deckIndex + 1}/{allDecks.length}</Text>
            )}
          </Text>
        </View>
        {displayName && displayName !== displayTopic && (
          <Text className="text-foreground-secondary text-sm mb-1">{displayName}</Text>
        )}
        <Text className={`text-foreground text-2xl font-bold ${displayClarification?.trim() ? 'mb-2' : 'mb-6'}`}>
          {displayTopic}
        </Text>
        {!!displayClarification?.trim() && (
          <Text className="text-foreground-secondary text-sm italic leading-5 mb-6">
            {displayClarification.trim()}
          </Text>
        )}
        {displayExplanation ? (
          <GrammarMarkdown>{displayExplanation}</GrammarMarkdown>
        ) : (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        )}
        {!loading && displayTruncated && <TruncationWarning />}
        <View className="h-8" />
      </ScrollView>

      <View className="px-8 pb-10" style={{ maxWidth: 720, alignSelf: 'center', width: '100%' } as any}>
        {hasMultiple && (
          <View className="flex-row items-center justify-between mb-3">
            <TouchableOpacity
              onPress={() => setDeckIndex(i => i - 1)}
              disabled={deckIndex === 0}
              className="px-4 py-2 rounded-xl bg-surface border border-border"
              activeOpacity={0.7}
            >
              <Text className={`text-sm font-semibold ${deckIndex === 0 ? 'text-foreground-muted' : 'text-foreground'}`}>
                ← Prev
              </Text>
            </TouchableOpacity>

            <Text className="text-foreground-secondary text-xs font-mono">
              {deckIndex + 1} / {allDecks.length}
            </Text>

            <TouchableOpacity
              onPress={() => setDeckIndex(i => i + 1)}
              disabled={deckIndex === allDecks.length - 1}
              className="px-4 py-2 rounded-xl bg-surface border border-border"
              activeOpacity={0.7}
            >
              <Text className={`text-sm font-semibold ${deckIndex === allDecks.length - 1 ? 'text-foreground-muted' : 'text-foreground'}`}>
                Next →
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <View className="flex-row items-center justify-center gap-3 py-4">
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text className="text-foreground-secondary text-sm">
              {loadPhase === 'cards' ? t('session.generatingCards') : t('session.generatingExplanation')}
            </Text>
          </View>
        ) : (
          <TouchableOpacity className="bg-primary rounded-2xl py-4 items-center" onPress={onStart}>
            <Text className="text-primary-foreground font-bold text-base">{t('session.startPractising')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(128,128,128,0.15)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.25)',
  },
});
