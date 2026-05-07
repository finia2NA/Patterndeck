export const UI_LOCALES = ['en', 'de'] as const;
export type UiLocale = typeof UI_LOCALES[number];

export const UI_LOCALE_LABELS: Record<UiLocale, string> = {
  en: 'English',
  de: 'Deutsch',
};

export const UI_LOCALE_LANGUAGE_NAMES: Record<UiLocale, string> = {
  en: 'English',
  de: 'German',
};

export function isUiLocale(value: string | null | undefined): value is UiLocale {
  return value === 'en' || value === 'de';
}

export function normalizeUiLocale(value: string | null | undefined): UiLocale {
  if (!value) return 'en';
  const lower = value.toLowerCase();
  if (lower.startsWith('de')) return 'de';
  return 'en';
}
