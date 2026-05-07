import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { normalizeTime, splitTime } from './timeUtils';
import { dismissPickerKeyboard, openAndroidTimePicker, openIosTimePicker, useDateTimePickerModule } from './dateTimePickerPlatform';
import { PlatformPopover } from './PlatformPopover';
import { TimePickerContent } from './TimePickerContent';
import { TimePickerTrigger } from './TimePickerTrigger';
import { useColors } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function useNativeWebTimeInput() {
  const [preferNativeInput, setPreferNativeInput] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(pointer: coarse), (hover: none)');
    const syncPreference = () => setPreferNativeInput(mediaQuery.matches);
    syncPreference();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncPreference);
      return () => mediaQuery.removeEventListener('change', syncPreference);
    }

    mediaQuery.addListener(syncPreference);
    return () => mediaQuery.removeListener(syncPreference);
  }, []);

  return preferNativeInput;
}

export function TimePicker({ value, onChange, disabled = false }: TimePickerProps) {
  const colors = useColors();
  const { t } = useI18n();
  const nativePickerModule = useDateTimePickerModule();
  const preferNativeWebTimeInput = useNativeWebTimeInput();

  const normalizedValue = useMemo(() => normalizeTime(value), [value]);
  const { hour, minute } = splitTime(normalizedValue);
  const [textValue, setTextValue] = useState(normalizedValue);
  const [draftHour, setDraftHour] = useState(hour);
  const [draftMinute, setDraftMinute] = useState(minute);

  useEffect(() => {
    setTextValue(normalizedValue);
    setDraftHour(hour);
    setDraftMinute(minute);
  }, [hour, minute, normalizedValue]);

  const pickerDate = useMemo(() => {
    const next = new Date();
    next.setHours(Number(draftHour), Number(draftMinute), 0, 0);
    return next;
  }, [draftHour, draftMinute]);

  function commitTextValue() {
    const normalized = normalizeTime(textValue);
    setTextValue(normalized);
    onChange(normalized);
  }

  const handleOpen = useCallback((openPopover: () => void) => {
    if (disabled) return;
    dismissPickerKeyboard();
    const { hour: nextHour, minute: nextMinute } = splitTime(textValue);
    const initial = new Date();
    initial.setHours(Number(nextHour), Number(nextMinute), 0, 0);

    if (openAndroidTimePicker(nativePickerModule, initial, (selected) => {
      const next = `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`;
      onChange(normalizeTime(next));
    })) {
      return;
    }

    if (openIosTimePicker(initial, (selected) => {
      const next = `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`;
      onChange(normalizeTime(next));
    }, {
      title: t('picker.dueTime'),
      cancelText: t('common.cancel'),
      confirmText: t('common.done'),
      accentColor: colors.primary,
    })) {
      return;
    }

    setDraftHour(nextHour);
    setDraftMinute(nextMinute);
    openPopover();
  }, [colors.primary, disabled, nativePickerModule, onChange, t, textValue]);

  function handleDone() {
    const next = normalizeTime(`${draftHour}:${draftMinute}`);
    setTextValue(next);
    onChange(next);
  }

  function handleDraftDateChange(next: Date) {
    setDraftHour(String(next.getHours()).padStart(2, '0'));
    setDraftMinute(String(next.getMinutes()).padStart(2, '0'));
  }

  const handleNativeWebInputChange = useCallback((nextValue: string) => {
    const normalized = normalizeTime(nextValue);
    const { hour: nextHour, minute: nextMinute } = splitTime(normalized);
    setTextValue(normalized);
    setDraftHour(nextHour);
    setDraftMinute(nextMinute);
    onChange(normalized);
  }, [onChange]);

  const triggerProps = {
    value,
    textValue,
    normalizedValue,
    disabled,
    useNativeInput: preferNativeWebTimeInput,
    onTextValueChange: setTextValue,
    onCommitTextValue: commitTextValue,
    onResetTextValue: () => setTextValue(normalizedValue),
    onNativeInputChange: handleNativeWebInputChange,
  };

  return (
    <PlatformPopover
      title={t('picker.dueTime')}
      // Mobile browsers handle their native time control more reliably than our custom popover.
      disabled={disabled || preferNativeWebTimeInput}
      fallbackHeight={230}
      maxWidth={300}
      closeDelay={130}
      sheetHeight={420}
      minHeight={360}
      anchorDisplay="inline-block"
      onDone={handleDone}
      trigger={({ open, openPopover, closePopover }) => (
        <TimePickerTrigger
          {...triggerProps}
          onPress={() => {
            if (preferNativeWebTimeInput) return;
            if (open) {
              closePopover();
              return;
            }
            handleOpen(openPopover);
          }}
        />
      )}
    >
      <TimePickerContent
        pickerDate={pickerDate}
        dateTimePickerModule={nativePickerModule}
        draftHour={draftHour}
        draftMinute={draftMinute}
        onDraftDateChange={handleDraftDateChange}
        onDraftHourChange={setDraftHour}
        onDraftMinuteChange={setDraftMinute}
      />
    </PlatformPopover>
  );
}
