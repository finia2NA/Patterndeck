import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Text, TextInput, View, Platform, type TextInputProps } from 'react-native';
import { PillDropdown } from '@/components/PillDropdown';
import { CARD_COUNTS } from '@/constants/session';
import { useColors } from '@/constants/theme';
import type { Language, CardCount } from '@/constants/session';
import { usePageSheetScrolling } from '@/components/PageSheetScrollContext';
import { formatUnitCount, useI18n } from '@/lib/i18n';

function isComposingKeyEvent(event: any) {
  const nativeEvent = event?.nativeEvent ?? event;
  return nativeEvent?.isComposing === true || nativeEvent?.keyCode === 229;
}

function isComposingInputEvent(event: any, wasComposing: boolean) {
  const nativeEvent = event?.nativeEvent ?? event;
  return nativeEvent?.isComposing === true ||
    nativeEvent?.keyCode === 229 ||
    (nativeEvent?.isComposing == null && wasComposing && nativeEvent?.inputType === 'insertCompositionText');
}

function getEventText(event: any) {
  return event?.nativeEvent?.text ?? event?.target?.value ?? '';
}

export const DeckModalTextInput = forwardRef<TextInput, TextInputProps>(function DeckModalTextInput(props, ref) {
  const { value, defaultValue, onChange, onChangeText, onKeyPress, onBlur, ...rest } = props;
  const inputRef = useRef<TextInput>(null);
  const initialValueRef = useRef(value ?? defaultValue ?? '');
  const isComposingRef = useRef(false);

  useImperativeHandle(ref, () => inputRef.current as TextInput, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || isComposingRef.current) return;
    const node = inputRef.current as any;
    const nextValue = value ?? '';
    if (node && 'value' in node && node.value !== nextValue) {
      node.value = nextValue;
    }
  }, [value]);

  if (Platform.OS !== 'web') {
    return <TextInput ref={inputRef} value={value} defaultValue={defaultValue} onChange={onChange} onChangeText={onChangeText} onKeyPress={onKeyPress} onBlur={onBlur} {...rest} />;
  }

  function handleKeyPress(event: any) {
    if (isComposingKeyEvent(event)) isComposingRef.current = true;
    onKeyPress?.(event);
  }

  function handleChange(event: any) {
    onChange?.(event);
    if (isComposingInputEvent(event, isComposingRef.current)) {
      isComposingRef.current = true;
      return;
    }

    isComposingRef.current = false;
    onChangeText?.(getEventText(event));
  }

  function handleBlur(event: any) {
    if (isComposingRef.current) {
      isComposingRef.current = false;
      onChangeText?.(getEventText(event));
    }
    onBlur?.(event);
  }

  return (
    <TextInput
      ref={inputRef}
      defaultValue={initialValueRef.current}
      onChange={handleChange}
      onKeyPress={handleKeyPress}
      onBlur={handleBlur}
      {...rest}
    />
  );
});

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
      <DeckModalTextInput
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
          formatLabel={(v: CardCount) => formatUnitCount(t, v, 'card', { zeroKey: 'common.inherit' })}
        />
      </View>
    </>
  );
}
