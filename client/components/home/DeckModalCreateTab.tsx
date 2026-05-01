import { useRef, useState, type RefObject } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, Alert } from 'react-native';
import { useColors } from '@/constants/theme';
import type { Language, CardCount } from '@/constants/session';
import { SharedCreationNameField, SharedCreationOptionsSection } from './DeckModalSharedCreationFields';
import { NeedsConfirmationButton } from '@/components/NeedsConfirmationButton';
import { DatePicker } from '@/components/pickers/DatePicker';
import { usePageSheetScrolling } from '@/components/PageSheetScrollContext';
import { AnimatedCollapsible } from '@/components/AnimatedCollapsible';

interface DeckModalCreateTabProps {
  isCollection: boolean;
  isEdit: boolean;
  onDelete?: () => void;
  onExport?: () => void;
  onResetSchedule?: (nodeId: string) => Promise<void>;
  editNodeId?: string;
  dueDate: string;
  onDueDateChange: (value: string) => void;
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
  onResetSchedule,
  editNodeId,
  dueDate,
  onDueDateChange,
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

  async function handleResetSchedule() {
    if (!editNodeId || !onResetSchedule) return;
    try {
      await onResetSchedule(editNodeId);
      onDueDateChange('');
      if (Platform.OS === 'web') window.alert('Deck reset to never studied.');
      else Alert.alert('Reset complete', 'Deck reset to never studied.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not reset deck.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Reset failed', message);
    }
  }

  function confirmResetSchedule() {
    if (Platform.OS === 'web') {
      void handleResetSchedule();
      return;
    }

    Alert.alert(
      'Reset schedule?',
      'This deck will return to never studied.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => { void handleResetSchedule(); },
        },
      ],
    );
  }

  return (
    <>
      <SharedCreationNameField
        label={isCollection ? 'Collection Name' : 'Deck Name'}
        description={isCollection
          ? 'Rename this collection.'
          : 'Use :: to nest in collections, e.g. "Japanese::N5::Te-form"'}
        placeholder={isCollection ? 'Collection name' : 'Japanese::N5::Te-form'}
        value={name}
        onChangeText={onNameChange}
        autoFocus
      />

      {!isCollection && (
        <>
          <Text className="text-foreground/80 text-sm font-medium mb-2">Topic</Text>
          <Text className="text-foreground-secondary text-xs mb-2">
            Name the grammar topic to study.
          </Text>
          <TextInput
            ref={topicRef}
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-base mb-6"
            placeholder='e.g. "Japanese て-form conjugation"'
            placeholderTextColor={colors.foreground_muted}
            value={topic}
            onChangeText={onTopicChange}
            multiline
            style={{ minHeight: 80, textAlignVertical: 'top' }}
            onFocus={() => handleScrollAwareFocus(topicRef)}
          />

          <Text className="text-foreground/80 text-sm font-medium mb-2">Clarification</Text>
          <Text className="text-foreground-secondary text-xs mb-2">
            Add extra guidance for explanation generation.
          </Text>
          <TextInput
            ref={clarificationRef}
            className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm mb-6"
            placeholder="What should the explanation include or keep in mind?"
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
                  <Text className="text-foreground/80 text-sm font-medium">AI-generated Explanation</Text>
                  <Text className="text-foreground-secondary text-xs mt-1">
                    Markdown saved with this deck.
                  </Text>
                </View>
                <Text className="text-foreground-secondary text-sm">{explanationExpanded ? '▼' : '▶'}</Text>
              </TouchableOpacity>
              <AnimatedCollapsible expanded={explanationExpanded} keepMounted>
                <View className="px-4 pb-4">
                  <TextInput
                    ref={explanationRef}
                    className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
                    placeholder="Generated explanation"
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

      {isEdit && !isCollection && editNodeId && (
        <View className="mb-6 gap-3">
          <Text className="text-foreground/80 text-sm font-medium">Review Schedule</Text>
          <Text className="text-foreground-secondary text-xs">
            Set when this deck becomes due.
          </Text>

          <DatePicker
            value={dueDate}
            onChange={onDueDateChange}
            placeholder="Pick due date"
            popoverPlacement="above"
            popoverTitle="Due Date"
            popoverFooter={onResetSchedule ? (
              <NeedsConfirmationButton
                label="Reset to Never Studied"
                confirmLabel="Tap again to reset"
                onConfirm={() => { void handleResetSchedule(); }}
                destructive
              />
            ) : undefined}
            androidNeutralButton={onResetSchedule ? {
              label: 'Reset',
              textColor: colors.error,
              onPress: confirmResetSchedule,
            } : undefined}
          />
        </View>
      )}

      {isEdit && (onExport || onDelete) && (
        <View className="mt-auto flex-row gap-3">
          {onExport && (
            <TouchableOpacity
              className="flex-1 py-3.5 rounded-xl border-secondary items-center bg-secondary"
              onPress={onExport}
            >
              <Text className="text-secondary-foreground font-semibold">Export as CSV</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <View className="flex-1">
              <NeedsConfirmationButton
                label={`Delete ${isCollection ? 'Collection' : 'Deck'}`}
                confirmLabel="Tap again to delete"
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
