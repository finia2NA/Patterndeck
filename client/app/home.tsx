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
import { Icon } from '@/components/Icon';
import {
  createDeckFromPath,
  updateDeck,
  deleteNode,
  getNodePath,
  getDeck,
  moveNode,
  importDecksFromCsv,
  hydrateSettings,
  resetDeckToNeverStudied,
  setDeckDueDate,
  syncReviewTimezone,
} from '@/lib/api';
import type { TreeNode } from '@/lib/types';
import { platformAlert, platformConfirm } from '@/lib/platformAlert';
import { formatLocalDateToYmd } from '@/components/pickers/dateUtils';
import { useEnabledLanguages } from '@/hooks/state/persistent/useSettings';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isSmallScreen } = useScreenSize();
  const isFocused = useIsFocused();
  const { tree, loading, refreshing, refresh } = useDeckTree(isFocused);
  const enabledLanguages = useEnabledLanguages(DEFAULT_LANGUAGES);

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

      const confirmed = await platformConfirm('Deck not due', 'This deck is not due yet. Study it anyway?');
      if (confirmed) startStudy({ nodeId: node.id, studyMode: 'early' });
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

    if (dueDeckIds.length > 0) {
      startStudy({ nodeId: node.id, studyMode: 'scheduled', deckIds: dueDeckIds });
      return;
    }

    if (notStartedDeckIds.length === 0) {
      platformAlert('Nothing to study', 'No due decks (or not-yet-started decks) are available in this collection right now.');
      return;
    }

    const confirmed = await platformConfirm('No decks due', 'No decks in this collection are due. Study not-yet-started decks anyway?');
    if (confirmed) startStudy({ nodeId: node.id, studyMode: 'early', deckIds: notStartedDeckIds });
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

          if (data.dueDate.length > 0) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) {
              throw new Error('Use YYYY-MM-DD format for due date.');
            }
            const initialDueDate = editNode.deck.dueAt
              ? formatLocalDateToYmd(new Date(editNode.deck.dueAt))
              : '';
            if (data.dueDate !== initialDueDate) {
              await setDeckDueDate(editNode.id, data.dueDate);
            }
          }
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
          <Text className="text-foreground text-xl font-bold">GrammarCrammer</Text>
          <TouchableOpacity onPress={() => setSettingsVisible(true)} className="w-10 h-10 items-center justify-center">
            <Icon name="settings" size={22} color={colors.foreground_secondary} />
          </TouchableOpacity>
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
              <DeckTree tree={tree} onStudy={handleStudy} onEdit={handleEdit} />
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
        onResetSchedule={editNode?.deck ? async (nodeId) => { await resetDeckToNeverStudied(nodeId); refresh(); } : undefined}
        editNode={editNode}
        editNodePath={editNodePathStr}
      />
      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      />
    </View>
  );
}
