import { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter, useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/constants/theme';
import { PillDropdown } from '@/components/PillDropdown';
import { DEFAULT_LANGUAGES, CARD_COUNTS, formatCardCount } from '@/constants/session';
import type { Language, CardCount } from '@/constants/session';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useDeckTree } from '@/hooks/useDeckTree';
import { DeckTree } from '@/components/home/DeckTree';
import { DeckModal, type DeckFormData, type CsvImportData } from '@/components/home/DeckModal';
import { SettingsModal } from '@/components/home/SettingsModal';
import { ReviewHistoryModal } from '@/components/home/ReviewHistoryModal';
import { PlatformButton } from '@/components/PlatformButton';
import { BrandLogo } from '@/components/BrandLogo';
import {
  createDeckFromPath,
  updateDeck,
  deleteNode,
  getNodePath,
  getDeck,
  moveNode,
  importDecksFromCsv,
  hydrateSettings,
  syncReviewTimezone,
  getSetting,
} from '@/lib/api';
import type { TreeNode } from '@/lib/types';
import { useEnabledLanguages } from '@/hooks/state/persistent/useSettings';
import { getLocalSetting } from '@/hooks/state/persistent/settingsStore';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isSmallScreen } = useScreenSize();
  const useNativePlatformButtonStyle = Platform.OS === 'ios';
  const isFocused = useIsFocused();
  const { tree, loading, refreshing, newDecksStartedToday, refresh } = useDeckTree(isFocused);
  const enabledLanguages = useEnabledLanguages(DEFAULT_LANGUAGES);
  const newDecksPerDayLimit = parseInt(getLocalSetting('new_decks_per_day') ?? '1', 10) || 1;

  // Quick-study state
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState<Language>('Japanese');
  const [cardCount, setCardCount] = useState<CardCount>(0);
  const [inputFocused, setInputFocused] = useState(false);
  const canStart = topic.trim().length > 0;

  // Deck/modal state
  const [deckModalVisible, setDeckModalVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [editNode, setEditNode] = useState<TreeNode | null>(null);
  const [editNodePathStr, setEditNodePathStr] = useState('');

  // History modal state
  const [historyNode, setHistoryNode] = useState<TreeNode | null>(null);
  const [historyShowActions, setHistoryShowActions] = useState(false);
  const [historyStudyContext, setHistoryStudyContext] = useState<{
    nodeId: string;
    studyMode: 'scheduled' | 'early';
    deckIds?: string[];
    notStartedDeckIds?: string[];
  } | null>(null);

  useEffect(() => {
    hydrateSettings().catch(() => {});
    syncReviewTimezone().catch(() => {});
  }, [isFocused]);

  useEffect(() => {
    setLanguage(prev => (enabledLanguages.includes(prev) ? prev : enabledLanguages[0] ?? DEFAULT_LANGUAGES[0]));
  }, [enabledLanguages]);

  // ─── Handlers ───────────────────────────────────────────────────────

  function handleQuickStart() {
    const trimmed = topic.trim();
    if (!trimmed) return;
    router.push({
      pathname: '/session',
      params: { topic: trimmed, language, count: String(cardCount) },
    });
  }

  const handleStudy = useCallback(async (node: TreeNode) => {
    const startStudy = (params: { nodeId: string; studyMode: 'scheduled' | 'early'; deckIds?: string[] }) => {
      router.push({
        pathname: '/session',
        params: {
          nodeId: params.nodeId,
          studyMode: params.studyMode,
          ...(params.deckIds ? { deckIds: params.deckIds.join(',') } : {}),
        },
      });
    };

    if (node.deck) {
      if (node.deck.explanationStatus !== 'ready') return;
      const isDue = node.deck.isDue ?? false;
      if (isDue) {
        startStudy({ nodeId: node.id, studyMode: 'scheduled' });
        return;
      }

      // Not due — open history with action buttons
      setHistoryNode(node);
      setHistoryShowActions(true);
      setHistoryStudyContext({ nodeId: node.id, studyMode: 'early' });
      return;
    }

    const queue = [...node.children];
    const dueDeckIds: string[] = [];
    const notStartedDeckIds: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.deck) {
        if (current.deck.explanationStatus !== 'ready') continue;
        if (current.deck.isDue) dueDeckIds.push(current.id);
        else if (current.deck.dueAt == null) notStartedDeckIds.push(current.id);
        continue;
      }
      queue.push(...current.children);
    }

    const maxDecksRaw = await getSetting('max_decks_per_session');
    const maxDecks = Math.max(1, parseInt(maxDecksRaw ?? '3', 10) || 3);

    if (dueDeckIds.length > 0) {
      startStudy({ nodeId: node.id, studyMode: 'scheduled', deckIds: dueDeckIds.slice(0, maxDecks) });
      return;
    }

    // No due decks — open history with action buttons
    setHistoryNode(node);
    setHistoryShowActions(true);
    setHistoryStudyContext({
      nodeId: node.id,
      studyMode: 'early',
      deckIds: notStartedDeckIds.slice(0, maxDecks),
      notStartedDeckIds,
    });
  }, [router]);

  const handleEdit = useCallback(async (node: TreeNode) => {
    const path = await getNodePath(node.id);
    let nodeForEdit = node;
    if (node.deck) {
      const deck = await getDeck(node.id);
      nodeForEdit = { ...node, deck };
    }
    setEditNodePathStr(path);
    setEditNode(nodeForEdit);
    setDeckModalVisible(true);
  }, []);

  const handleHistory = useCallback((node: TreeNode) => {
    setHistoryNode(node);
    setHistoryShowActions(false);
    setHistoryStudyContext(null);
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryNode(null);
    setHistoryShowActions(false);
    setHistoryStudyContext(null);
  }, []);

  const handleStudyAnyway = useCallback(() => {
    if (!historyStudyContext) return;
    closeHistory();
    router.push({
      pathname: '/session',
      params: {
        nodeId: historyStudyContext.nodeId,
        studyMode: historyStudyContext.studyMode,
        ...(historyStudyContext.deckIds ? { deckIds: historyStudyContext.deckIds.join(',') } : {}),
      },
    });
  }, [historyStudyContext, closeHistory, router]);

  const handleStartNewDeck = useCallback(() => {
    if (!historyStudyContext?.notStartedDeckIds?.length && !historyNode?.deck) return;
    closeHistory();
    const deckId = historyNode?.deck
      ? historyNode.id
      : historyStudyContext!.notStartedDeckIds![0];
    if (!deckId) return;
    router.push({
      pathname: '/session',
      params: {
        nodeId: historyStudyContext?.nodeId ?? deckId,
        studyMode: 'early',
        deckIds: deckId,
      },
    });
  }, [historyStudyContext, historyNode, closeHistory, router]);

  const handleCreate = useCallback(() => {
    setEditNode(null);
    setDeckModalVisible(true);
  }, []);

  const handleSubmit = useCallback(async (data: DeckFormData) => {
    try {
      if (editNode) {
        const pathChanged = data.path !== editNodePathStr;

        if (pathChanged) {
          await moveNode(editNode.id, data.path);
        }

        if (editNode.deck !== null) {
          const newName = data.path.split('::').pop()?.trim() ?? data.path;
          await updateDeck(editNode.id, {
            name: pathChanged ? undefined : newName,
            topic: data.topic,
            clarification: data.clarification,
            language: data.language,
            cardCount: data.cardCount,
            explanation: data.explanation,
          });

        }
      } else {
        await createDeckFromPath(data.path, data.topic, data.language, data.cardCount, data.clarification, data.explanation);
      }
      setDeckModalVisible(false);
      setEditNode(null);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'An error occurred.');
    }
  }, [editNode, editNodePathStr, refresh]);

  const handleCsvImport = useCallback(async (data: CsvImportData) => {
    const result = await importDecksFromCsv(
      data.csvContent,
      data.collectionPath,
      data.language,
      data.cardCount,
    );
    if (result.createdCount > 0 && result.failedCount === 0) {
      setDeckModalVisible(false);
    }
    if (result.createdCount > 0) {
      refresh();
    }
    return result;
  }, [refresh]);

  const handleDelete = useCallback(async () => {
    if (!editNode) return;
    await deleteNode(editNode.id);
    setDeckModalVisible(false);
    setEditNode(null);
    refresh();
  }, [editNode, refresh]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + (isSmallScreen ? 80 : 32),
        }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between mb-6">
          <BrandLogo size={34} wordmarkSize={20} />
          <PlatformButton
            icon="settings"
            onPress={() => setSettingsVisible(true)}
            variant="glass"
            color={colors.foreground_secondary}
            backgroundColor={useNativePlatformButtonStyle ? colors.surface : undefined}
            iconSize={18}
            horizontalPadding={useNativePlatformButtonStyle ? 10 : 8}
            verticalPadding={useNativePlatformButtonStyle ? 10 : 8}
            cornerRadius={useNativePlatformButtonStyle ? 20 : 16}
            accessibilityLabel="Settings"
            style={{
              width: useNativePlatformButtonStyle ? 40 : 34,
              height: useNativePlatformButtonStyle ? 40 : 34,
              borderRadius: useNativePlatformButtonStyle ? 20 : 17,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
        </View>

        {/* Deck tree */}
        <View
          className="w-full max-w-2xl self-center mb-6 bg-surface rounded-2xl border border-border"
          style={{
            padding: 20,
            ...Platform.select({ web: { boxShadow: '0 2px 12px rgba(0,0,0,0.08)' } }),
          }}
        >
          {!isSmallScreen && (
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-foreground-secondary text-sm font-semibold">Decks</Text>
              <View className="flex-row items-center">
                <TouchableOpacity
                  className="px-4 py-2 rounded-xl bg-primary"
                  onPress={handleCreate}
                  activeOpacity={0.85}
                >
                  <Text className="text-primary-foreground text-sm font-semibold">New Deck</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {loading ? (
            <View className="items-center py-16">
              <Text className="text-foreground-secondary text-base">Loading…</Text>
            </View>
          ) : (
            <>
              {refreshing && (
                <View className="items-center py-2">
                  <Text className="text-foreground-muted text-xs">Updating…</Text>
                </View>
              )}
              <DeckTree tree={tree} onStudy={handleStudy} onEdit={handleEdit} onHistory={handleHistory} />
            </>
          )}
        </View>

        {/* Quick study */}
        <View className="w-full max-w-2xl self-center mb-6">
          <View
            className={`bg-surface rounded-2xl mb-3 border ${inputFocused ? 'border-primary' : 'border-border'}`}
            style={{
              minHeight: 100,
              zIndex: 10,
              ...Platform.select({ web: inputFocused ? { boxShadow: `0 0 0 3px ${colors.primary}40` } : {} }),
            }}
          >
            <View
              className="absolute flex-row gap-2"
              style={{ top: 12, right: 12, zIndex: 20 }}
            >
              <PillDropdown
                key={enabledLanguages.join('|')}
                value={language}
                options={enabledLanguages}
                onChange={setLanguage}
              />
              <PillDropdown
                value={cardCount}
                options={CARD_COUNTS}
                onChange={setCardCount}
                formatLabel={formatCardCount}
              />
            </View>
            <TextInput
              className="no-focus-ring flex-1 text-foreground placeholder:text-foreground-muted text-base px-5 pb-4"
              style={{ paddingTop: 48, textAlignVertical: 'top', minHeight: 100 }}
              placeholder="Quick study — type any grammar topic"
              placeholderTextColor={colors.foreground_muted}
              value={topic}
              onChangeText={setTopic}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onSubmitEditing={handleQuickStart}
              returnKeyType="go"
              blurOnSubmit
              multiline
            />
          </View>
          <TouchableOpacity
            className={`py-3 rounded-2xl items-center bg-primary`}
            onPress={handleQuickStart}
            disabled={!canStart}
            activeOpacity={0.85}
          >
            <Text className={`text-base font-semibold text-primary-foreground`}>
              Start Session
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Mobile FABs */}
      {isSmallScreen && (
        <View
          className="absolute items-center"
          style={{
            width: 56,
            right: 24,
            bottom: insets.bottom + 24,
          }}
        >
          <TouchableOpacity
            className="bg-primary rounded-full items-center justify-center shadow-lg"
            style={{ width: 56, height: 56 }}
            onPress={handleCreate}
            activeOpacity={0.85}
          >
            <Text className="text-primary-foreground text-2xl font-light" style={{ marginTop: -2 }}>+</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modals */}
      <DeckModal
        visible={deckModalVisible}
        onClose={() => { setDeckModalVisible(false); setEditNode(null); }}
        onSubmit={handleSubmit}
        onCsvImport={handleCsvImport}
        onDelete={editNode ? handleDelete : undefined}
        editNode={editNode}
        editNodePath={editNodePathStr}
      />
      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      />
      <ReviewHistoryModal
        visible={historyNode !== null}
        node={historyNode}
        onClose={closeHistory}
        onScheduleChanged={refresh}
        showActions={historyShowActions}
        onStudyAnyway={
          historyStudyContext && historyNode?.deck?.dueAt != null
            ? handleStudyAnyway
            : undefined
        }
        onStartNewDeck={
          historyStudyContext && (
            historyNode?.deck?.dueAt == null ||
            (historyStudyContext.notStartedDeckIds?.length ?? 0) > 0
          )
            ? handleStartNewDeck
            : undefined
        }
        newDeckLimitReached={newDecksStartedToday >= newDecksPerDayLimit}
      />
    </View>
  );
}
