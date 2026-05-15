import { ApiError, RequestTimeoutError } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

type Translate = (key: TranslationKey) => string;

export function isNetworkError(error: unknown): boolean {
  if (error instanceof RequestTimeoutError) return false;
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return error.name === 'AbortError'
    || message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('internet disconnected');
}

export function getDisplayErrorName(error: unknown, t: Translate): string {
  if (isNetworkError(error)) return t('common.networkError');
  if (error instanceof RequestTimeoutError) return t('common.timeoutError');
  if (error instanceof ApiError) return error.code || error.name;
  if (error instanceof Error) return error.name || 'Error';
  return 'Error';
}

export function getDisplayErrorMessage(error: unknown, t: Translate): string {
  if (isNetworkError(error)) return t('common.networkError');
  if (error instanceof RequestTimeoutError) return t('common.timeoutError');
  if (error instanceof Error) return error.message;
  return t('common.errorGeneric');
}
