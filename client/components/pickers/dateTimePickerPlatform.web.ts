export function useDateTimePickerModule() {
  return null;
}

export function dismissPickerKeyboard() {}

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
