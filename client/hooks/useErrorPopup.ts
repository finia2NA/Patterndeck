import { useCallback, useState } from 'react';
import { getDisplayErrorName } from '@/lib/errorDisplay';
import { useI18n } from '@/lib/i18n';

export interface ErrorPopupState {
  visible: boolean;
  errorName?: string;
  message?: string;
}

export function useErrorPopup() {
  const { t } = useI18n();
  const [state, setState] = useState<ErrorPopupState>({ visible: false });

  const showError = useCallback((error: unknown, message?: string) => {
    setState({
      visible: true,
      errorName: getDisplayErrorName(error, t),
      message: message || t('errorPopup.body'),
    });
  }, [t]);

  const dismiss = useCallback(() => {
    setState(current => ({ ...current, visible: false }));
  }, []);

  return { errorPopup: state, showError, dismissError: dismiss };
}
