import { Keyboard, Platform } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type ButtonType, type DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface AndroidNeutralButtonOptions {
  neutralButton?: ButtonType;
  onNeutralButtonPress?: () => void;
}

export function useDateTimePickerModule() {
  return { default: DateTimePicker, DateTimePickerAndroid };
}

export function dismissPickerKeyboard() {
  Keyboard.dismiss();
}

export function openAndroidDatePicker(
  nativePickerModule: any,
  value: Date,
  onSelected: (selected: Date) => void,
  options: AndroidNeutralButtonOptions = {},
) {
  if (Platform.OS !== 'android') return false;

  nativePickerModule.DateTimePickerAndroid.open({
    value,
    mode: 'date',
    is24Hour: true,
    neutralButton: options.neutralButton,
    onChange: (event: DateTimePickerEvent, selected?: Date) => {
      if (event.type === 'neutralButtonPressed') {
        options.onNeutralButtonPress?.();
        return;
      }
      if (!selected) return;
      onSelected(selected);
    },
  });
  return true;
}

export function openAndroidTimePicker(
  nativePickerModule: any,
  value: Date,
  onSelected: (selected: Date) => void,
) {
  if (Platform.OS !== 'android') return false;

  nativePickerModule.DateTimePickerAndroid.open({
    value,
    mode: 'time',
    is24Hour: true,
    onChange: (_event: unknown, selected?: Date) => {
      if (!selected) return;
      onSelected(selected);
    },
  });
  return true;
}

export function openIosDatePicker(
  _value: Date,
  _onSelected: (selected: Date) => void,
  _options: unknown = {},
) {
  return false;
}

export function openIosTimePicker(
  _value: Date,
  _onSelected: (selected: Date) => void,
  _options: unknown = {},
) {
  return false;
}
