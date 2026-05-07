import { View, Text, TextInput } from 'react-native';
import { useColors } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';

export interface ForgotPasswordCardProps {
  email: string;
  onEmailChange: (v: string) => void;
  error: string | null;
  loading: boolean;
  sent: boolean;
}

export function ForgotPasswordCard({ email, onEmailChange, error, loading, sent }: ForgotPasswordCardProps) {
  const colors = useColors();
  const { t } = useI18n();

  return (
    <>
      <Text className="text-3xl font-bold text-foreground mb-2">{t('onboarding.resetPassword')}</Text>
      {sent ? (
        <Text className="text-foreground-secondary text-sm leading-6">
          {t('onboarding.resetPasswordSent')}
        </Text>
      ) : (
        <>
          <Text className="text-foreground-secondary text-sm leading-6 mb-6">
            {t('onboarding.resetPasswordBody')}
          </Text>
          <Text className="text-foreground/80 text-sm font-medium mb-2">{t('onboarding.email')}</Text>
          <View className="p-1">
            <TextInput
              className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm"
              placeholder="you@example.com"
              placeholderTextColor={colors.foreground_muted}
              value={email}
              onChangeText={onEmailChange}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!loading}
            />
          </View>
          {error && <Text className="text-error text-xs mt-2">{error}</Text>}
        </>
      )}
    </>
  );
}
