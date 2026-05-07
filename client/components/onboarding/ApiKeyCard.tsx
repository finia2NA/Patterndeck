import { View, Text, TextInput } from 'react-native';
import { useColors } from '@/constants/theme';
import { TouchTarget } from '@/components/TouchTarget';
import { useI18n } from '@/lib/i18n';

export interface ApiKeyCardProps {
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  error: string | null;
  loading: boolean;
  canSkip?: boolean;
  onSkip?: () => void;
}

export function ApiKeyCard({ apiKey, onApiKeyChange, error, loading, canSkip, onSkip }: ApiKeyCardProps) {
  const colors = useColors();
  const { t } = useI18n();
  return (
    <>
      <Text className="text-3xl font-bold text-foreground mb-2">
        {t('onboarding.apiKeyTitle')}
      </Text>
      <Text className="text-foreground-secondary text-sm leading-6 mb-6">
        {t('onboarding.apiKeyBody')}
      </Text>
      <Text className="text-foreground/80 text-sm font-medium mb-2">
        {t('onboarding.apiKeyLabel')}
      </Text>
      <View className="p-1">
        <TextInput
          className="bg-background-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-foreground-muted text-sm font-mono"
          placeholder="sk-ant-..."
          placeholderTextColor={colors.foreground_muted}
          value={apiKey}
          onChangeText={onApiKeyChange}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
      </View>
      {error && (
        <Text className="text-error text-xs mt-2">{error}</Text>
      )}
      <Text className="text-foreground-secondary/70 text-xs mt-3 leading-5">
        {t('onboarding.apiKeyHelp')}
      </Text>
      {canSkip && (
        <TouchTarget onPress={onSkip!} style={{ marginTop: 8, paddingHorizontal: 0 }}>
          <Text className="text-primary text-sm">
            {t('onboarding.skipServerKey')}
          </Text>
        </TouchTarget>
      )}
    </>
  );
}
