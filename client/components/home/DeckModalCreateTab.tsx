import { useRef, useState, type RefObject } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { useColors } from '@/constants/theme';
import type { Language, CardCount } from '@/constants/session';
import { SharedCreationNameField, SharedCreationOptionsSection } from './DeckModalSharedCreationFields';
import { NeedsConfirmationButton } from '@/components/NeedsConfirmationButton';
import { usePageSheetScrolling } from '@/components/PageSheetScrollContext';
import { AnimatedCollapsible } from '@/components/AnimatedCollapsible';
import { useI18n } from '@/lib/i18n';

interface DeckModalCreateTabProps {
  isCollection: boolean;
  isEdit: boolean;
  onDelete?: () => void;
  onExport?: () => void;
  name: string;
  onNameChange: (value: string) => void;
  topic: string;
  onTopicChange: (value: string) => void;
  clarification: string;
  onClarificationChange: (value: string) => void;
  explanation: string;
  onExplanationChange: (value: string) => void;
  showExplanationField: boolean;
  language: Language;
  onLanguageChange: (value: Language) => void;
  cardCount: CardCount;
  onCardCountChange: (value: CardCount) => void;
  enabledLanguages: string[];
}

export function DeckModalCreateTab({
  isCollection,
  isEdit,
  onDelete,
  onExport,
  name,
  onNameChange,
  topic,
  onTopicChange,
  clarification,
  onClarificationChange,
  explanation,
  onExplanationChange,
  showExplanationField,
  language,
  onLanguageChange,
  cardCount,
  onCardCountChange,
  enabledLanguages,
}: DeckModalCreateTabProps) {
  const colors = useColors();
  const { t } = useI18n();
  const isScrollingRef = usePageSheetScrolling();
  const topicRef = useRef<TextInput>(null);
  const clarificationRef = useRef<TextInput>(null);
  const explanationRef = useRef<TextInput>(null);
  const [explanationExpanded, setExplanationExpanded] = useState(false);

  function handleScrollAwareFocus(ref: RefObject<TextInput | null>) {
    if (Platform.OS !== 'web' && isScrollingRef?.current) {
      ref.current?.blur();
    }
  }

  return (
    <>
      <SharedCreationNameField
        label={isCollection ? t('deck.collectionName') : t('deck.deckName')}
        description={isCollection
          ? t('deck.renameCollection')
          : t('deck.pathDescription')}
        placeholder={isCollection ? t('deck.collectionPlaceholder') : t('deck.pathPlaceholder')}
        value={name}
        onChangeText={onNameChange}
        autoFocus
      />

      {!isCollection && (
        <>
          <Text className="text-foreground/80 text-sm font-medium mb-2">{t('deck.topic')}</Text>
          <Text className="text-foreground-secondary text-xs mb-2">
            {t('deck.topicDescription')}
          </Text>
          <TextInput
            ref={topicRef}
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-base mb-6"
            placeholder={t('deck.topicPlaceholder')}
            placeholderTextColor={colors.foreground_muted}
            value={topic}
            onChangeText={onTopicChange}
            multiline
            style={{ minHeight: 80, textAlignVertical: 'top' }}
            onFocus={() => handleScrollAwareFocus(topicRef)}
          />

          <Text className="text-foreground/80 text-sm font-medium mb-2">{t('deck.clarification')}</Text>
          <Text className="text-foreground-secondary text-xs mb-2">
            {t('deck.clarificationDescription')}
          </Text>
          <TextInput
            ref={clarificationRef}
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm mb-6"
            placeholder={t('deck.clarificationPlaceholder')}
            placeholderTextColor={colors.foreground_muted}
            value={clarification}
            onChangeText={onClarificationChange}
            multiline
            style={{ minHeight: 110, textAlignVertical: 'top' }}
            onFocus={() => handleScrollAwareFocus(clarificationRef)}
          />

          {showExplanationField && (
            <View className="mb-6 rounded-xl border border-border bg-background-muted overflow-hidden">
              <TouchableOpacity
                className="px-4 py-3 flex-row items-center justify-between"
                onPress={() => setExplanationExpanded(v => !v)}
                activeOpacity={0.85}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-foreground/80 text-sm font-medium">{t('deck.generatedExplanation')}</Text>
                  <Text className="text-foreground-secondary text-xs mt-1">
                    {t('deck.generatedExplanationDescription')}
                  </Text>
                </View>
                <Text className="text-foreground-secondary text-sm">{explanationExpanded ? '▼' : '▶'}</Text>
              </TouchableOpacity>
              <AnimatedCollapsible expanded={explanationExpanded} keepMounted>
                <View className="px-4 pb-4">
                  <TextInput
                    ref={explanationRef}
                    className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
                    placeholder={t('deck.generatedExplanationPlaceholder')}
                    placeholderTextColor={colors.foreground_muted}
                    value={explanation}
                    onChangeText={onExplanationChange}
                    multiline
                    style={{ minHeight: 160, textAlignVertical: 'top' }}
                    onFocus={() => handleScrollAwareFocus(explanationRef)}
                  />
                </View>
              </AnimatedCollapsible>
            </View>
          )}

          <SharedCreationOptionsSection
            language={language}
            onLanguageChange={onLanguageChange}
            cardCount={cardCount}
            onCardCountChange={onCardCountChange}
            enabledLanguages={enabledLanguages}
          />
        </>
      )}

      {isEdit && (onExport || onDelete) && (
        <View className="mt-auto flex-row gap-3">
          {onExport && (
            <TouchableOpacity
              className="flex-1 py-3.5 rounded-xl border-secondary items-center bg-secondary"
              onPress={onExport}
            >
              <Text className="text-secondary-foreground font-semibold">{t('deck.exportCsv')}</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <View className="flex-1">
              <NeedsConfirmationButton
                label={isCollection ? t('deck.deleteCollection') : t('deck.deleteDeck')}
                confirmLabel={t('deck.tapAgainDelete')}
                onConfirm={onDelete}
                destructive
              />
            </View>
          )}
        </View>
      )}
    </>
  );
}
