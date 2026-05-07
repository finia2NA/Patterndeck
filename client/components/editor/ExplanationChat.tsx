import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useColors } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';
import { analytics } from '@/lib/analytics';
import { editExplanationAI } from '@/lib/api';
import { GrammarMarkdown } from '@/components/session/GrammarMarkdown';
import type { ChatMessage } from '@/lib/types';

interface ExplanationChatProps {
  explanation: string;
  onExplanationChange: (text: string) => void;
  onGeneratingChange?: (generating: boolean) => void;
  nodeId?: string;
  deckTopic?: string;
  language?: string;
  disabled?: boolean;
  onCostChange?: (cost: number) => void;
}

export function ExplanationChat({
  explanation,
  onExplanationChange,
  onGeneratingChange,
  nodeId,
  deckTopic,
  language,
  disabled,
  onCostChange,
}: ExplanationChatProps) {
  const colors = useColors();
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [totalCost, setTotalCost] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages]);

  async function handleSend() {
    const trimmed = inputText.trim();
    if (!trimmed || loading || disabled) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputText('');
    setLoading(true);
    onGeneratingChange?.(true);

    try {
      const result = await editExplanationAI(nodeId, explanation, trimmed, messages);
      onExplanationChange(result.explanation);
      setTotalCost(c => c + result.cost);
      onCostChange?.(result.cost);
      setMessages(prev => [...prev, { role: 'assistant', content: result.summary || t('editor.changesApplied') }]);
      analytics.track('explanation_edit_requested', {
        deck_id: nodeId,
        instruction_length: trimmed.length,
        message_count: messages.length,
        cost: result.cost,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.errorGeneric');
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${msg}` }]);
      analytics.track('explanation_edit_failed', {
        deck_id: nodeId,
        error_message: msg,
      });
    } finally {
      setLoading(false);
      onGeneratingChange?.(false);
    }
  }

  return (
    <View className="flex-1 flex-col">
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ gap: 12, padding: 16 }}
      >
        {messages.length === 0 && (
          <Text className="text-foreground-secondary text-sm text-center mt-8">
            {t('editor.chatPlaceholder')}
          </Text>
        )}
        {messages.map((msg, i) => (
          <View key={i}>
            {msg.role === 'user' ? (
              <View className="bg-background-muted self-end rounded-xl px-3 py-2 max-w-xs">
                <Text className="text-foreground text-sm">{msg.content}</Text>
              </View>
            ) : (
              <View className="bg-background-warm rounded-xl px-3 py-2">
                {msg.content ? (
                  <GrammarMarkdown>{msg.content}</GrammarMarkdown>
                ) : (
                  <ActivityIndicator size="small" color={colors.border} />
                )}
              </View>
            )}
          </View>
        ))}
        {loading && (
          <View className="bg-background-warm rounded-xl px-3 py-2 self-start">
            <ActivityIndicator size="small" color={colors.border} />
          </View>
        )}
      </ScrollView>

      <View className="px-4 py-3 border-t border-border gap-2">
        <View className="flex-row items-end gap-2">
          <TextInput
            className="flex-1 bg-background-muted border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-foreground-muted text-sm"
            placeholder={t('editor.chatPlaceholder')}
            placeholderTextColor={colors.foreground_muted}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            blurOnSubmit={false}
            editable={!loading && !disabled}
            multiline
            style={{ maxHeight: 120 }}
            onKeyPress={(e: any) => {
              if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault?.();
                handleSend();
              }
            }}
          />
          <TouchableOpacity
            className={`w-10 h-10 rounded-xl items-center justify-center ${
              !inputText.trim() || loading || disabled ? 'bg-background-muted' : 'bg-primary'
            }`}
            onPress={handleSend}
            disabled={!inputText.trim() || loading || disabled}
            activeOpacity={0.7}
          >
            <Text className="text-primary-foreground text-base font-semibold">→</Text>
          </TouchableOpacity>
        </View>
        {totalCost > 0 && (
          <Text className="text-foreground-muted text-xs text-right">
            {t('editor.costLabel')}: ${totalCost.toFixed(4)}
          </Text>
        )}
      </View>
    </View>
  );
}
