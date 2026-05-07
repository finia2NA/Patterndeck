import { DEFAULT_LANGUAGES } from './languages.js';

export const CARD_ORDER_OPTIONS = ['shuffled', 'sequential'] as const;
export const JUDGE_WITH_EXPLANATION_OPTIONS = ['on', 'off'] as const;
export const FEEDBACK_BREVITY_OPTIONS = ['normal', 'brief'] as const;
export const KEY_PREFERENCE_OPTIONS = ['central', 'own'] as const;
export const MAX_DECKS_OPTIONS = [1, 2, 3, 5, 10] as const;
export const NEW_DECKS_OPTIONS = [1, 2, 3, 5, 999] as const;
export const UNLIMITED_NEW_DECKS = 999;

export const SETTING_DEFAULTS: Record<string, string> = {
  card_order: 'shuffled',
  judge_with_explanation: 'on',
  feedback_brevity: 'normal',
  default_card_count: '10',
  api_key_preference: 'central',
  ui_language: 'en',
  enabled_languages: JSON.stringify(DEFAULT_LANGUAGES),
  daily_due_time: '01:00',
  review_timezone: 'UTC',
  notifications_enabled: 'off',
  notification_time: '09:00',
  max_decks_per_session: '3',
  new_decks_per_day: '1',
};
