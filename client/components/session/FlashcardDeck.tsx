import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useColors } from '@/constants/theme';
import type { AnalyticsContext, Card, CardPhase, ChatMessage, WordHint } from '@/lib/types';
import { GrammarMarkdown } from './GrammarMarkdown';
import { CardChat } from './CardChat';
import { ClickableEnglishSentence } from './ClickableEnglishSentence';
import { TouchTarget } from '@/components/TouchTarget';
import { useI18n } from '@/lib/i18n';

// ─── Small helpers ────────────────────────────────────────────────────────────

function AnswerBox({ answer }: { answer: string }) {
  const { t } = useI18n();
  return (
    <View className="bg-background-muted rounded-lg px-3 py-2 gap-1">
      <Text className="text-foreground-secondary text-xs">{t('session.yourAnswer')}</Text>
      <Text className="text-foreground/70 text-sm">{answer}</Text>
    </View>
  );
}

function ExampleBox({ example }: { example: string }) {
  const { t } = useI18n();
  return (
    <View className="bg-background-warm rounded-lg px-3 py-2 gap-1">
      <Text className="text-foreground-secondary text-xs">{t('session.exampleSentence')}</Text>
      <Text className="text-foreground text-base font-medium">{example}</Text>
    </View>
  );
}

// ─── FlashcardDeck ────────────────────────────────────────────────────────────

interface FlashcardDeckProps {
  cards: Card[];
  language: string;
  cardPhase: CardPhase;
  answer: string;
  onChangeAnswer: (text: string) => void;
  submittedAnswer: string;
  feedback: string;
  wrongExplanation: string;
  showHint: boolean;
  onToggleHint: () => void;
  wasSkipped: boolean;
  onSubmitAnswer: () => void;
  onConfirmCorrect: () => void;
  onConfirmWrong: () => void;
  onOverrideWrong: () => void;
  inputRef: React.RefObject<TextInput | null>;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  onChatSend: (text: string) => void;
  deckName?: string;
  hintCache: React.MutableRefObject<Map<string, WordHint>>;
  addCost: (usd: number) => void;
  vocabHintDismissSignal?: number;
  analyticsContext?: AnalyticsContext;
  onWordHint?: () => void;
}

export function FlashcardDeck({
  cards, language, cardPhase,
  answer, onChangeAnswer, submittedAnswer,
  feedback, wrongExplanation, wasSkipped,
  showHint, onToggleHint,
  onSubmitAnswer, onConfirmCorrect, onConfirmWrong, onOverrideWrong,
  inputRef, chatMessages, chatStreaming, onChatSend, deckName,
  hintCache, addCost, vocabHintDismissSignal, analyticsContext, onWordHint,
}: FlashcardDeckProps) {
  const colors = useColors();
  const { t } = useI18n();
  const currentCard = cards[0] ?? { english: '', targetLanguage: '', hint: '', sentenceContext: '' };

  return (
    <>
      {/* Card */}
      <View className="w-full max-w-xl bg-surface rounded-3xl p-8 mb-6">
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-foreground-secondary text-xs uppercase tracking-widest">{t('session.translateTo', { language })}</Text>
          {deckName ? <Text className="text-foreground-secondary text-xs">{deckName}</Text> : null}
        </View>
        <View className="mb-2">
          <ClickableEnglishSentence
            card={currentCard}
            language={language}
            hintCache={hintCache}
            addCost={addCost}
            dismissSignal={vocabHintDismissSignal}
            analyticsContext={analyticsContext}
            onWordHint={onWordHint}
          />
        </View>
        {currentCard.sentenceContext && (
          <View className="self-end bg-background-muted border border-border rounded-md px-2 py-0.5 mb-4">
            <Text className="text-primary/70 text-xs font-medium">{currentCard.sentenceContext}</Text>
          </View>
        )}

        {/* Input phase */}
        {(cardPhase === 'input' || cardPhase === 'judging') && (
          <>
            <TextInput
              ref={inputRef}
              className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-base mb-4"
              placeholder={t('session.translationPlaceholder')}
              placeholderTextColor={colors.foreground_muted}
              value={answer}
              onChangeText={onChangeAnswer}
              onSubmitEditing={onSubmitAnswer}
              returnKeyType="go"
              editable={cardPhase === 'input'}
              autoFocus
            />
            <TouchableOpacity
              className={`py-3.5 rounded-xl items-center mb-3 ${cardPhase === 'judging' ? 'bg-background-muted' : 'bg-primary'
                }`}
              onPress={onSubmitAnswer}
              disabled={cardPhase === 'judging'}
            >
              {cardPhase === 'judging' ? (
                <ActivityIndicator color={colors.foreground} />
              ) : (
                <Text className="text-primary-foreground font-semibold">{t('session.checkAnswer')}</Text>
              )}
            </TouchableOpacity>

            {/* Hint */}
            {currentCard.hint && (
              showHint ? (
                <View className="bg-background-muted rounded-lg px-3 py-2">
                  <Text className="text-foreground-secondary text-xs">{currentCard.hint}</Text>
                </View>
              ) : (
                <TouchTarget onPress={onToggleHint} style={{ alignSelf: 'center' }}>
                  <Text className="text-foreground-secondary/50 text-xs text-center">{t('session.showHint')}</Text>
                </TouchTarget>
              )
            )}
          </>
        )}

        {/* Correct */}
        {cardPhase === 'correct' && (
          <View className="gap-3">
            <View className="flex-row items-center gap-2 mb-1">
              <Text className="text-success text-lg">✓</Text>
              <Text className="text-success font-semibold">{t('session.correct')}</Text>
            </View>
            <AnswerBox answer={submittedAnswer} />
            <GrammarMarkdown>{feedback}</GrammarMarkdown>
            <ExampleBox example={currentCard.targetLanguage} />
            <TouchableOpacity
              className="bg-success rounded-xl py-3.5 items-center mt-2"
              onPress={onConfirmCorrect}
            >
              <Text className="text-primary-foreground font-semibold">{t('session.nextCard')}</Text>
            </TouchableOpacity>
            <CardChat messages={chatMessages} streaming={chatStreaming} onSend={onChatSend} />
          </View>
        )}

        {/* Wrong — explaining */}
        {cardPhase === 'wrong_explaining' && (
          <View className="items-center gap-3 py-2">
            <ActivityIndicator color={colors.error} />
            <Text className="text-foreground-secondary text-sm">{t('session.gettingFeedback')}</Text>
          </View>
        )}

        {/* Wrong — shown */}
        {cardPhase === 'wrong_shown' && (
          <View className="gap-3">
            <View className="flex-row items-center gap-2 mb-1">
              {wasSkipped ? (
                <>
                  <Text className="text-foreground-secondary text-lg">→</Text>
                  <Text className="text-foreground-secondary font-semibold">{t('session.hereIsAnswer')}</Text>
                </>
              ) : (
                <>
                  <Text className="text-error text-lg">✗</Text>
                  <Text className="text-error font-semibold">{t('session.notQuite')}</Text>
                </>
              )}
            </View>
            {!wasSkipped && <AnswerBox answer={submittedAnswer} />}
            <ExampleBox example={currentCard.targetLanguage} />
            <GrammarMarkdown>{wrongExplanation}</GrammarMarkdown>
            <TouchableOpacity
              className="bg-primary rounded-xl py-3.5 items-center mt-2"
              onPress={onConfirmWrong}
            >
              <Text className="text-primary-foreground font-semibold">{t('session.tryAgainLater')}</Text>
            </TouchableOpacity>
            {!wasSkipped && (
              <TouchTarget onPress={onOverrideWrong} style={{ alignSelf: 'flex-end' }}>
                <Text className="text-secondary text-xs">{t('session.overrideCorrect')}</Text>
              </TouchTarget>
            )}
            <CardChat messages={chatMessages} streaming={chatStreaming} onSend={onChatSend} />
          </View>
        )}
      </View>
    </>
  );
}
