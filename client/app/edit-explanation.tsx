import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useColors } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';
import { analytics } from '@/lib/analytics';
import { getDeck, updateDeck, getNodePath } from '@/lib/api';
import { BrandLogo } from '@/components/BrandLogo';
import { useScreenSize } from '@/hooks/useScreenSize';
import { MonacoEditor } from '@/components/editor/MonacoEditor';
import { ExplanationChat } from '@/components/editor/ExplanationChat';
import { ResizablePanels } from '@/components/editor/ResizablePanels';
import { GrammarMarkdown } from '@/components/session/GrammarMarkdown';
import { useTutorial } from '@/hooks/useTutorial';
import { TutorialOverlay, type TutorialStep } from '@/components/tutorial/TutorialOverlay';

export default function EditExplanationPage() {
  const colors = useColors();
  const { t } = useI18n();
  const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
  const { isSmallScreen } = useScreenSize();
  const isLargeScreen = Platform.OS === 'web' && !isSmallScreen;

  const [explanation, setExplanation] = useState('');
  const [originalExplanation, setOriginalExplanation] = useState('');
  const [deckTopic, setDeckTopic] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [language, setLanguage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [editCount, setEditCount] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [editorRevision, setEditorRevision] = useState(0);
  const [showDiff, setShowDiff] = useState(false);
  const dirty = explanation !== originalExplanation;

  const { visible: tutorialVisible, onDone: onTutorialDone } = useTutorial('editor');
  const editorPanelRef = useRef<View>(null);
  const previewPanelRef = useRef<View>(null);
  const chatPanelRef = useRef<View>(null);

  const editorTutorialSteps: TutorialStep[] = [
    { ref: editorPanelRef, title: t('tutorial.editor.monaco.title'), body: t('tutorial.editor.monaco.body') },
    { ref: previewPanelRef, title: t('tutorial.editor.preview.title'), body: t('tutorial.editor.preview.body') },
    { ref: chatPanelRef, title: t('tutorial.editor.chat.title'), body: t('tutorial.editor.chat.body') },
  ];

  useEffect(() => {
    if (!nodeId) return;
    setLoading(true);
    Promise.all([getDeck(nodeId), getNodePath(nodeId)])
      .then(([deck, path]) => {
        const exp = deck.explanation ?? '';
        setExplanation(exp);
        setOriginalExplanation(exp);
        setEditorRevision(r => r + 1);
        setDeckTopic(deck.topic);
        setLanguage(deck.language);
        setNodeName(path);
        analytics.track('explanation_editor_opened', {
          deck_id: nodeId,
          deck_topic: deck.topic,
          language: deck.language,
          has_existing_explanation: !!deck.explanation,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [nodeId]);

  // Warn before tab close if dirty
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function handleBack() {
    if (dirty) {
      if (Platform.OS === 'web') {
        if (!window.confirm(t('editor.unsavedChanges'))) return;
      }
    }
    if (Platform.OS === 'web' && window.opener) {
      window.close();
    } else {
      router.back();
    }
  }

  const handleSave = useCallback(async () => {
    if (!nodeId || saving || !dirty) return;
    setSaving(true);
    try {
      await updateDeck(nodeId, { explanation });
      setOriginalExplanation(explanation);
      analytics.track('explanation_edit_saved', {
        deck_id: nodeId,
        explanation_length: explanation.length,
        edit_count: editCount,
        total_cost: totalCost,
      });
    } catch (err) {
      if (Platform.OS === 'web') {
        window.alert(err instanceof Error ? err.message : t('common.errorGeneric'));
      }
    } finally {
      setSaving(false);
    }
  }, [nodeId, saving, dirty, explanation, editCount, totalCost, t]);

  function handleExplanationChange(text: string) {
    setExplanation(text);
    setEditCount(c => c + 1);
  }

  function handleExternalExplanationChange(text: string) {
    setExplanation(text);
    setEditorRevision(r => r + 1);
    setEditCount(c => c + 1);
  }

  if (!isLargeScreen) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8 gap-4">
        <Text className="text-foreground text-lg font-semibold text-center">
          {t('editor.smallScreenMessage')}
        </Text>
        <TouchableOpacity
          className="bg-primary px-6 py-3 rounded-xl"
          onPress={handleBack}
          activeOpacity={0.8}
        >
          <Text className="text-primary-foreground font-semibold">{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background flex-col" style={{ flex: 1 }}>
      {/* Top bar */}
      <View
        className="flex-row items-center px-4 border-b border-border bg-surface"
        style={{ height: 52, minHeight: 52 }}
      >
        {/* Left: back + logo */}
        <View className="flex-row items-center gap-3 flex-1">
          <TouchableOpacity
            className="flex-row items-center gap-2"
            onPress={handleBack}
            activeOpacity={0.7}
          >
            <Text className="text-foreground-secondary text-base">←</Text>
            <Text className="text-foreground-secondary text-sm">{t('common.back')}</Text>
          </TouchableOpacity>
          <BrandLogo size={28} wordmarkSize={16} />
        </View>

        {/* Center: deck name */}
        <View className="flex-1 items-center">
          {loading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Text className="text-foreground font-semibold text-sm" numberOfLines={1}>{nodeName}</Text>
          }
        </View>

        {/* Right: save */}
        <View className="flex-row items-center gap-2 flex-1" style={{ justifyContent: 'flex-end' }}>
          <TouchableOpacity
            className={`px-5 py-2 rounded-xl ${dirty && !saving ? 'bg-primary' : 'bg-background-muted'}`}
            onPress={handleSave}
            disabled={!dirty || saving}
            activeOpacity={0.8}
          >
            <Text className={`font-semibold text-sm ${dirty && !saving ? 'text-primary-foreground' : 'text-foreground-muted'}`}>
              {saving ? t('editor.saving') : t('editor.save')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Three-panel editor */}
      <ResizablePanels>
        {[
          <View key="monaco" ref={editorPanelRef} style={{ flex: 1, position: 'relative' }}>
            {!loading && (
              <MonacoEditor
                value={explanation}
                onChange={handleExplanationChange}
                readOnly={aiGenerating}
                externalRevision={editorRevision}
                original={originalExplanation}
                showDiff={showDiff}
              />
            )}
            {dirty && (
              <TouchableOpacity
                style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10 }}
                className={`px-3 py-1.5 rounded-lg border ${showDiff ? 'border-primary bg-primary/10' : 'border-border bg-surface'}`}
                onPress={() => setShowDiff(v => !v)}
                activeOpacity={0.7}
              >
                <Text className={`text-xs font-medium ${showDiff ? 'text-primary' : 'text-foreground-secondary'}`}>
                  {t('editor.diff')}
                </Text>
              </TouchableOpacity>
            )}
          </View>,
          <View key="preview" ref={previewPanelRef} style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 24 }}
            >
              {explanation ? (
                <GrammarMarkdown>{explanation}</GrammarMarkdown>
              ) : (
                <Text className="text-foreground-secondary text-sm italic">
                  {t('deck.generatedExplanationPlaceholder')}
                </Text>
              )}
            </ScrollView>
          </View>,
          <View key="chat" ref={chatPanelRef} style={{ flex: 1 }}>
            <ExplanationChat
              explanation={explanation}
              onExplanationChange={handleExternalExplanationChange}
              onGeneratingChange={setAiGenerating}
              onCostChange={(cost) => setTotalCost(c => c + cost)}
              nodeId={nodeId}
              deckTopic={deckTopic}
              language={language}
              disabled={loading}
            />
          </View>,
        ]}
      </ResizablePanels>
      <TutorialOverlay steps={editorTutorialSteps} visible={isLargeScreen && tutorialVisible} onDone={onTutorialDone} />
    </View>
  );
}
