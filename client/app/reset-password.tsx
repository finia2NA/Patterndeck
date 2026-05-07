import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/constants/theme';
import { OnboardingBackground } from '@/components/OnboardingBackground';
import { validateResetToken, resetPassword } from '@/lib/api';
import { validatePassword } from '@patterndeck/shared';
import { useI18n } from '@/lib/i18n';

type PageState = 'loading' | 'invalid' | 'form' | 'success';

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useI18n();
  const confirmRef = useRef<TextInput>(null);

  const [state, setState] = useState<PageState>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    validateResetToken(token)
      .then(({ valid }) => setState(valid ? 'form' : 'invalid'))
      .catch(() => setState('invalid'));
  }, [token]);

  async function handleSubmit() {
    setError(null);
    const pwErr = validatePassword(password);
    if (pwErr) { setError(pwErr); return; }
    if (password !== confirm) { setError(t('reset.passwordMismatch')); return; }

    setSubmitting(true);
    try {
      await resetPassword(token!, password);
      setState('success');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <OnboardingBackground />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-md bg-surface rounded-3xl p-8 shadow-2xl">
          {state === 'loading' && (
            <>
              <Text className="text-3xl font-bold text-foreground mb-4">{t('onboarding.resetPassword')}</Text>
              <ActivityIndicator color={colors.primary} size="large" />
            </>
          )}

          {state === 'invalid' && (
            <>
              <Text className="text-3xl font-bold text-foreground mb-3">{t('reset.linkExpired')}</Text>
              <Text className="text-foreground-secondary text-sm leading-6">
                {t('reset.linkExpiredBody')}
              </Text>
            </>
          )}

          {state === 'form' && (
            <>
              <Text className="text-3xl font-bold text-foreground mb-2">{t('onboarding.resetPassword')}</Text>
              <Text className="text-foreground-secondary text-sm leading-6 mb-6">
                {t('reset.newPasswordBody')}
              </Text>

              <Text className="text-foreground/80 text-sm font-medium mb-2">{t('reset.newPassword')}</Text>
              <View className="p-1 mb-3">
                <TextInput
                  className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
                  placeholder={t('onboarding.passwordPlaceholder')}
                  placeholderTextColor={colors.foreground_muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  editable={!submitting}
                />
              </View>

              <Text className="text-foreground/80 text-sm font-medium mb-2">{t('reset.confirmPassword')}</Text>
              <View className="p-1">
                <TextInput
                  ref={confirmRef}
                  className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
                  placeholder={t('reset.confirmPlaceholder')}
                  placeholderTextColor={colors.foreground_muted}
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  autoCapitalize="none"
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit}
                  editable={!submitting}
                />
              </View>

              <Text className="text-foreground-subtle text-xs mt-2 mb-4">
                {t('reset.requirements')}
              </Text>

              {error && <Text className="text-error text-xs mb-3">{error}</Text>}

              <TouchableOpacity
                className={`py-3.5 rounded-xl items-center ${submitting ? 'bg-primary/70' : 'bg-primary'}`}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-primary-foreground font-semibold">{t('reset.submit')}</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {state === 'success' && (
            <>
              <Text className="text-3xl font-bold text-primary mb-3">{t('reset.successTitle')}</Text>
              <Text className="text-foreground-secondary text-sm leading-6">
                {t('reset.successBody')}
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
