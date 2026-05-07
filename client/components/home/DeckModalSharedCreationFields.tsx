import { useRef } from 'react';
import { Text, TextInput, View, Platform } from 'react-native';
import { PillDropdown } from '@/components/PillDropdown';
import { CARD_COUNTS, formatCardCount } from '@/constants/session';
import { useColors } from '@/constants/theme';
import type { Language, CardCount } from '@/constants/session';
import { usePageSheetScrolling } from '@/components/PageSheetScrollContext';
import { useI18n } from '@/lib/i18n';

interface SharedCreationNameFieldProps {
  label: string;
  description: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  autoFocus?: boolean;
}

export function SharedCreationNameField({
  label,
  description,
  placeholder,
  value,
  onChangeText,
  autoFocus,
}: SharedCreationNameFieldProps) {
  const colors = useColors();
  const inputRef = useRef<TextInput>(null);
  const isScrollingRef = usePageSheetScrolling();

  function handleFocus() {
    if (Platform.OS !== 'web' && isScrollingRef?.current) {
      inputRef.current?.blur();
    }
  }

  return (
    <>
      <Text className="text-foreground/80 text-sm font-medium mb-2">{label}</Text>
      <Text className="text-foreground-secondary text-xs mb-2">{description}</Text>
      <TextInput
        ref={inputRef}
        className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-base mb-6"
        placeholder={placeholder}
        placeholderTextColor={colors.foreground_muted}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus && Platform.OS === 'web'}
        onFocus={handleFocus}
      />
    </>
  );
}

interface SharedCreationOptionsSectionProps {
  language: Language;
  onLanguageChange: (value: Language) => void;
  cardCount: CardCount;
  onCardCountChange: (value: CardCount) => void;
  enabledLanguages: string[];
}

export function SharedCreationOptionsSection({
  language,
  onLanguageChange,
  cardCount,
  onCardCountChange,
  enabledLanguages,
}: SharedCreationOptionsSectionProps) {
  const { t } = useI18n();
  return (
    <>
      <Text className="text-foreground/80 text-sm font-medium mb-3">{t('deck.options')}</Text>
      <View className="flex-row gap-3 mb-6">
        <PillDropdown
          key={enabledLanguages.join('|')}
          value={language}
          options={enabledLanguages}
          onChange={onLanguageChange}
        />
        <PillDropdown
          value={cardCount}
          options={CARD_COUNTS}
          onChange={onCardCountChange}
          formatLabel={formatCardCount}
        />
      </View>
    </>
  );
}
