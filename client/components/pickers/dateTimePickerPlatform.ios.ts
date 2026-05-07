import { Keyboard } from 'react-native';
import { getNativeDateTimePicker } from 'native-date-time-picker';

interface IosPickerOptions {
  title: string;
  cancelText: string;
  confirmText: string;
  accentColor?: string;
}

interface IosDatePickerOptions extends IosPickerOptions {
  resetButton?: {
    label: string;
    textColor?: string;
    onPress: () => void;
  };
}

export function useDateTimePickerModule() {
  return null;
}

export function dismissPickerKeyboard() {
  Keyboard.dismiss();
}

export function openAndroidDatePicker(
  _nativePickerModule: any,
  _value: Date,
  _onSelected: (selected: Date) => void,
  _options: unknown = {},
) {
  return false;
}

export function openAndroidTimePicker(
  _nativePickerModule: any,
  _value: Date,
  _onSelected: (selected: Date) => void,
) {
  return false;
}

export function openIosDatePicker(
  value: Date,
  onSelected: (selected: Date) => void,
  options: IosDatePickerOptions,
) {
  const nativePicker = getNativeDateTimePicker();
  if (!nativePicker) return false;

  nativePicker.present({
    mode: 'date',
    value: value.toISOString(),
    title: options.title,
    cancelText: options.cancelText,
    confirmText: options.confirmText,
    accentColor: options.accentColor,
    resetText: options.resetButton?.label,
    resetTextColor: options.resetButton?.textColor,
  }).then((result) => {
    if (result.action === 'confirmed' && result.value) {
      onSelected(new Date(result.value));
      return;
    }
    if (result.action === 'reset') {
      options.resetButton?.onPress();
    }
  }).catch(() => {});

  return true;
}

export function openIosTimePicker(
  value: Date,
  onSelected: (selected: Date) => void,
  options: IosPickerOptions,
) {
  const nativePicker = getNativeDateTimePicker();
  if (!nativePicker) return false;

  nativePicker.present({
    mode: 'time',
    value: value.toISOString(),
    title: options.title,
    cancelText: options.cancelText,
    confirmText: options.confirmText,
    is24Hour: true,
    accentColor: options.accentColor,
  }).then((result) => {
    if (result.action === 'confirmed' && result.value) {
      onSelected(new Date(result.value));
    }
  }).catch(() => {});

  return true;
}
