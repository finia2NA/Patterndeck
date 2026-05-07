import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useColors } from '@/constants/theme';
import { setApiKey, validateApiKey } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export function AddApiKeyForm({ onAdded }: { onAdded: () => void }) {
  const colors = useColors();
  const { t } = useI18n();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const { valid, error: validationError } = await validateApiKey(trimmed);
      if (!valid) {
        setError(validationError ?? t('apiKey.invalid'));
        return;
      }
      await setApiKey(trimmed);
      setKey('');
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('apiKey.saveFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="mt-2 gap-2">
      <TextInput
        className="bg-background-muted text-foreground placeholder:text-foreground-muted rounded-lg px-3 py-2 text-sm border border-border"
        placeholder="sk-ant-..."
        placeholderTextColor={colors.foreground_muted}
        value={key}
        onChangeText={setKey}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      {error ? <Text className="text-xs" style={{ color: '#f87171' }}>{error}</Text> : null}
      <TouchableOpacity
        className="bg-secondary rounded-lg py-2 items-center"
        onPress={handleSubmit}
        disabled={loading || !key.trim()}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text className="text-primary-foreground text-sm font-semibold">{t('common.verifySave')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
