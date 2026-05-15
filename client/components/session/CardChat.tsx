import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useColors } from '@/constants/theme';
import type { ChatMessage } from '@/lib/types';
import { GrammarMarkdown } from './GrammarMarkdown';
import { useI18n } from '@/lib/i18n';

interface CardChatProps {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
}

export function CardChat({ messages, streaming, onSend }: CardChatProps) {
  const colors = useColors();
  const { t } = useI18n();
  const [inputText, setInputText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll to bottom when messages change (streaming chunks)
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages]);

  function handleSend() {
    const trimmed = inputText.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setInputText('');
  }

  return (
    <View className="mt-4 gap-3" style={{ maxHeight: 400 }}>
      {/* Message history */}
      <ScrollView
        ref={scrollRef}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 12 }}
      >
        {messages.map((msg, i) => (
          <View key={i}>
            {msg.role === 'user' ? (
              <View className="bg-background-muted self-end rounded-lg px-3 py-2">
                <Text className="text-foreground text-sm">{msg.content}</Text>
              </View>
            ) : (
              <View className={`${msg.failed ? 'bg-badge-error' : 'bg-background-warm'} rounded-lg px-3 py-2`}>
                {msg.content ? (
                  msg.failed ? (
                    <Text className="text-error text-sm">{msg.content}</Text>
                  ) : (
                    <GrammarMarkdown>{msg.content}</GrammarMarkdown>
                  )
                ) : (
                  <ActivityIndicator size="small" color={colors.border} />
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Input row */}
      <View className="flex-row items-end gap-2">
        <TextInput
          ref={inputRef}
          className="flex-1 bg-background-muted border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-foreground-muted text-sm"
          placeholder={t('session.askAboutCard')}
          placeholderTextColor={colors.foreground_muted}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          blurOnSubmit={false}
          editable={!streaming}
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
            !inputText.trim() || streaming ? 'bg-background-muted' : 'bg-primary'
          }`}
          onPress={handleSend}
          disabled={!inputText.trim() || streaming}
          activeOpacity={0.7}
        >
          <Text className="text-primary-foreground text-base font-semibold">→</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
