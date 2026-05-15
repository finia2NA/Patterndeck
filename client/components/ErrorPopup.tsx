import { useEffect, useRef } from 'react';
import { Alert, Platform, Pressable, Text, ToastAndroid, View } from 'react-native';
import { useColors } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';
import { SmallModal } from './SmallModal';

interface ErrorPopupProps {
  visible: boolean;
  errorName?: string;
  message?: string;
  onDismiss: () => void;
}

export function ErrorPopup({ visible, errorName, message, onDismiss }: ErrorPopupProps) {
  const colors = useColors();
  const { t } = useI18n();
  const displayName = errorName?.trim() || t('common.apiError');
  const body = message || t('errorPopup.body');
  const lastNativeErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;

    const key = `${displayName}:${body}`;
    if (lastNativeErrorRef.current === key) return;
    lastNativeErrorRef.current = key;

    if (Platform.OS === 'android') {
      ToastAndroid.show(`${t('errorPopup.title')}: ${displayName}. ${body}`, ToastAndroid.LONG);
      onDismiss();
      return;
    }

    Alert.alert(
      t('errorPopup.title'),
      `${body}\n\n${t('errorPopup.errorLabel')}: ${displayName}`,
      [{ text: t('common.ok'), onPress: onDismiss }],
    );
  }, [body, displayName, onDismiss, t, visible]);

  useEffect(() => {
    if (visible) return;
    lastNativeErrorRef.current = null;
  }, [visible]);

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <SmallModal visible={visible} onDismiss={onDismiss}>
      <View accessibilityRole="alert">
        <Text className="text-foreground text-lg font-semibold">{t('errorPopup.title')}</Text>
        <Text className="mt-2 text-foreground-secondary text-sm">
          {body}
        </Text>
        <View
          className="mt-4 rounded-xl border px-3 py-2"
          style={{ backgroundColor: colors.background_muted, borderColor: colors.border }}
        >
          <Text className="text-foreground-muted text-xs uppercase">{t('errorPopup.errorLabel')}</Text>
          <Text className="mt-1 text-error text-sm font-semibold">{displayName}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          className="mt-5 self-end rounded-xl px-5 py-3"
          style={{ backgroundColor: colors.primary }}
          onPress={onDismiss}
        >
          <Text className="text-primary-foreground font-semibold">{t('common.ok')}</Text>
        </Pressable>
      </View>
    </SmallModal>
  );
}
