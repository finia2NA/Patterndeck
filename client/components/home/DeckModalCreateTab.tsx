import { useRef, useState, type RefObject } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { useColors } from '@/constants/theme';
import type { Language, CardCount } from '@/constants/session';
import { DeckModalTextInput, SharedCreationNameField, SharedCreationOptionsSection } from './DeckModalSharedCreationFields';
import { NeedsConfirmationButton } from '@/components/NeedsConfirmationButton';
import { usePageSheetScrolling } from '@/components/PageSheetScrollContext';
import { AnimatedCollapsible } from '@/components/AnimatedCollapsible';
import { useI18n } from '@/lib/i18n';
import type { GrammarCaseSummary } from '@/lib/api';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useTutorial } from '@/hooks/useTutorial';
import { TutorialOverlay, type TutorialStep } from '@/components/tutorial/TutorialOverlay';

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
  grammarCases?: GrammarCaseSummary[];
  regenerateGrammarCases?: boolean;
  onRegenerateGrammarCases?: () => void;
  explanationChanged?: boolean;
  editNodeId?: string;
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
  grammarCases = [],
  regenerateGrammarCases = false,
  onRegenerateGrammarCases,
  explanationChanged = false,
  editNodeId,
}: DeckModalCreateTabProps) {
  const colors = useColors();
  const { t } = useI18n();
  const { isSmallScreen } = useScreenSize();
  const isLargeWeb = Platform.OS === 'web' && !isSmallScreen;
  const showEnhancedEditorButton = isLargeWeb && !!editNodeId && !explanationChanged;
  const isScrollingRef = usePageSheetScrolling();
  const topicRef = useRef<TextInput>(null);
  const clarificationRef = useRef<TextInput>(null);
  const explanationRef = useRef<TextInput>(null);

  const { visible: tutorialVisible, onDone: onTutorialDone } = useTutorial('deck_creation');
  const showDeckTutorial = tutorialVisible && !isEdit && !isCollection;
  const nameFieldRef = useRef<View>(null);
  const topicFieldRef = useRef<View>(null);
  const clarificationFieldRef = useRef<View>(null);

  const deckTutorialSteps: TutorialStep[] = [
    { ref: nameFieldRef, title: t('tutorial.deck.name.title'), body: t('tutorial.deck.name.body') },
    { ref: topicFieldRef, title: t('tutorial.deck.topic.title'), body: t('tutorial.deck.topic.body') },
    { ref: clarificationFieldRef, title: t('tutorial.deck.clarification.title'), body: t('tutorial.deck.clarification.body') },
  ];
  const [explanationExpanded, setExplanationExpanded] = useState(false);
  const [casesExpanded, setCasesExpanded] = useState(false);
  const caseCountLabel = grammarCases.length === 1
    ? t('deck.grammarCasesCountSingular', { count: grammarCases.length })
    : t('deck.grammarCasesCountPlural', { count: grammarCases.length });

  function handleScrollAwareFocus(ref: RefObject<TextInput | null>) {
    if (Platform.OS !== 'web' && isScrollingRef?.current) {
      ref.current?.blur();
    }
  }

  return (
    <>
      <View ref={nameFieldRef}>
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
      </View>

      {!isCollection && (
        <>
          <View ref={topicFieldRef}>
            <Text className="text-foreground/80 text-sm font-medium mb-2">{t('deck.topic')}</Text>
            <Text className="text-foreground-secondary text-xs mb-2">
              {t('deck.topicDescription')}
            </Text>
            <DeckModalTextInput
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
          </View>

          <View ref={clarificationFieldRef}>
            <Text className="text-foreground/80 text-sm font-medium mb-2">{t('deck.clarification')}</Text>
            <Text className="text-foreground-secondary text-xs mb-2">
              {t('deck.clarificationDescription')}
            </Text>
            <DeckModalTextInput
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
          </View>

          {showExplanationField && (
            <View className="mb-6">
              {showEnhancedEditorButton ? (
                <TouchableOpacity
                  className="rounded-xl border border-border bg-background-muted overflow-hidden px-4 py-3 flex-row items-center justify-between"
                  onPress={() => {
                    window.open(`/edit-explanation?nodeId=${editNodeId}`, '_blank');
                  }}
                  activeOpacity={0.85}
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-foreground/80 text-sm font-medium">{t('deck.generatedExplanation')}</Text>
                    <Text className="text-foreground-secondary text-xs mt-1">
                      {t('deck.generatedExplanationDescription')}
                    </Text>
                    <Text className="text-primary text-xs font-semibold mt-1">
                      {t('deck.openEnhancedEditor')}
                    </Text>
                  </View>
                  <Text className="text-foreground-secondary text-sm">▶</Text>
                </TouchableOpacity>
              ) : (
                <View className="rounded-xl border border-border bg-background-muted overflow-hidden">
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
                      {explanationChanged ? (
                        <Text className="text-primary text-xs font-semibold mt-1">
                          {t('deck.explanationChangedCasesWillRegenerate')}
                        </Text>
                      ) : (
                        <Text className="text-foreground-secondary italic text-xs mt-1">
                          {t('deck.enhancedEditorHint')}
                        </Text>
                      )}
                    </View>
                    <Text className="text-foreground-secondary text-sm">{explanationExpanded ? '▼' : '▶'}</Text>
                  </TouchableOpacity>
                  <AnimatedCollapsible expanded={explanationExpanded} keepMounted>
                    <View className="px-4 pb-4">
                      <DeckModalTextInput
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
            </View>
          )}

          {isEdit && showExplanationField && (
            <View className="mb-6 rounded-xl border border-border bg-background-muted overflow-hidden">
              <TouchableOpacity
                className="px-4 py-3 flex-row items-center justify-between"
                onPress={() => setCasesExpanded(v => !v)}
                activeOpacity={0.85}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-foreground/80 text-sm font-medium">{t('deck.grammarCases')}</Text>
                  <Text className="text-foreground-secondary text-xs mt-1">
                    {(regenerateGrammarCases || explanationChanged) ? t('deck.grammarCasesRegenerationScheduled') : caseCountLabel}
                  </Text>
                </View>
                <Text className="text-foreground-secondary text-sm">{casesExpanded ? '▼' : '▶'}</Text>
              </TouchableOpacity>
              <AnimatedCollapsible expanded={casesExpanded} keepMounted>
                <View className="px-4 pb-4 gap-3">
                  {grammarCases.length === 0 ? (
                    <Text className="text-foreground-secondary text-xs leading-5">
                      {t('deck.grammarCasesEmpty')}
                    </Text>
                  ) : (
                    <View className="gap-2">
                      {grammarCases.map((item) => (
                        <View key={item.id} className="bg-surface border border-border rounded-xl px-3 py-2">
                          <Text className="text-foreground text-sm font-medium">{item.label}</Text>
                          <Text className="text-foreground-secondary text-xs mt-1" numberOfLines={2}>{item.ruleSummary}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {onRegenerateGrammarCases && (
                    <TouchableOpacity
                      className="py-3 rounded-xl border items-center"
                      style={{ borderColor: regenerateGrammarCases ? colors.primary : colors.border, backgroundColor: regenerateGrammarCases ? colors.primary + '18' : 'transparent' }}
                      onPress={onRegenerateGrammarCases}
                      activeOpacity={0.8}
                    >
                      <Text className="text-foreground font-semibold">
                        {regenerateGrammarCases ? t('deck.grammarCasesRegenerationScheduled') : t('deck.grammarCasesRegenerate')}
                      </Text>
                    </TouchableOpacity>
                  )}
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
              <Text className="text-secondary-foreground font-semibold">{t('deck.exportJson')}</Text>
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
      <TutorialOverlay steps={deckTutorialSteps} visible={showDeckTutorial} onDone={onTutorialDone} measureDelay={500} />
    </>
  );
}
