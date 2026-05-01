import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Animated, Easing, Alert, Platform } from 'react-native';
import { PageSheetModal } from '@/components/PageSheetModal';
import { AnimatedTabbed } from '@/components/AnimatedTabbed';
import type { Language, CardCount } from '@/constants/session';
import { DEFAULT_LANGUAGES } from '@/constants/session';
import type { TreeNode } from '@/lib/types';
import type { CsvImportResult } from '@/lib/api';
import { exportNodeCsv } from '@/lib/api';
import { DeckModalCreateTab } from './DeckModalCreateTab';
import { DeckModalCsvTab } from './DeckModalCsvTab';
import { formatLocalDateToYmd } from '@/components/pickers/dateUtils';
import { useEnabledLanguages } from '@/hooks/state/persistent/useSettings';

function triggerCsvDownload(filename: string, csv: string) {
  if (Platform.OS !== 'web') {
    Alert.alert('Export', 'CSV export is only available on web.');
    return;
  }
  const blob = new Blob([csv], { type: 'text/tab-separated-values;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface DeckModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: DeckFormData) => void | Promise<void>;
  onCsvImport?: (data: CsvImportData) => Promise<CsvImportResult>;
  onDelete?: () => void;
  onResetSchedule?: (nodeId: string) => Promise<void>;
  editNode?: TreeNode | null;
  editNodePath?: string;
  initialData?: Partial<DeckFormData>;
}

export interface DeckFormData {
  path: string;
  topic: string;
  language: Language;
  cardCount: CardCount;
  dueDate: string;
  explanation?: string;
}

export interface CsvImportData {
  csvContent: string;
  collectionPath: string;
  language: Language;
  cardCount: CardCount;
}

export type CsvImportStatus =
  | { state: 'idle' }
  | { state: 'importing' }
  | { state: 'error'; message: string }
  | { state: 'done'; result: CsvImportResult };

export function DeckModal({
  visible,
  onClose,
  onSubmit,
  onCsvImport,
  onDelete,
  onResetSchedule,
  editNode,
  editNodePath,
  initialData,
}: DeckModalProps) {
  const isEdit = editNode !== null && editNode !== undefined;
  const isCollection = isEdit && editNode.deck === null;
  const canUseCsvTab = !isEdit;
  const enabledLanguages = useEnabledLanguages(DEFAULT_LANGUAGES);

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState<Language>('Japanese');
  const [cardCount, setCardCount] = useState<CardCount>(0);
  const [dueDate, setDueDate] = useState('');
  const [explanation, setExplanation] = useState('');
  const [activeTab, setActiveTab] = useState<'create' | 'csv'>('create');
  const [contentTab, setContentTab] = useState<'create' | 'csv'>('create');
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<CsvImportStatus>({ state: 'idle' });
  const tabContentOpacity = useRef(new Animated.Value(1)).current;
  const tabContentTranslateX = useRef(new Animated.Value(0)).current;
  const tabContentHeight = useRef(new Animated.Value(0)).current;
  const tabTransition = useRef<Animated.CompositeAnimation | null>(null);
  const tabHeightTransition = useRef<Animated.CompositeAnimation | null>(null);
  const contentHeightRef = useRef(0);
  const hasMeasuredContentRef = useRef(false);
  const pendingFadeInRef = useRef(false);
  const [hasMeasuredHeight, setHasMeasuredHeight] = useState(false);
  const [heightAnimating, setHeightAnimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setActiveTab('create');
      setContentTab('create');
      setCsvContent(null);
      setImportStatus({ state: 'idle' });
      tabTransition.current?.stop();
      tabHeightTransition.current?.stop();
      tabContentOpacity.setValue(1);
      tabContentTranslateX.setValue(0);
      tabContentHeight.setValue(0);
      hasMeasuredContentRef.current = false;
      contentHeightRef.current = 0;
      pendingFadeInRef.current = false;
      setHasMeasuredHeight(false);
      setHeightAnimating(false);
      if (isEdit && editNode) {
        setName(editNodePath ?? editNode.name);
        if (editNode.deck) {
          setTopic(editNode.deck.topic);
          setLanguage(editNode.deck.language as Language);
          setCardCount(editNode.deck.cardCount as CardCount);
          setDueDate(editNode.deck.dueAt ? formatLocalDateToYmd(new Date(editNode.deck.dueAt)) : '');
          setExplanation(editNode.deck.explanation ?? '');
        } else {
          setTopic('');
          setDueDate('');
          setExplanation('');
        }
      } else {
        setName(initialData?.path ?? '');
        setTopic(initialData?.topic ?? '');
        setLanguage(initialData?.language ?? 'Japanese');
        setCardCount(initialData?.cardCount ?? 0);
        setDueDate(initialData?.dueDate ?? '');
        setExplanation(initialData?.explanation ?? '');
      }
    }
  }, [visible, editNode, editNodePath, initialData, isEdit, tabContentOpacity, tabContentTranslateX, tabContentHeight]);

  useEffect(() => {
    if (!visible) return;
    setLanguage((prev: string) => enabledLanguages.includes(prev) ? prev : enabledLanguages[0] ?? DEFAULT_LANGUAGES[0]);
  }, [visible, enabledLanguages]);

  const startFadeIn = useCallback(() => {
    tabTransition.current?.stop();
    tabTransition.current = Animated.parallel([
      Animated.timing(tabContentOpacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(tabContentTranslateX, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    tabTransition.current.start();
  }, [tabContentOpacity, tabContentTranslateX]);

  useEffect(() => {
    if (!visible || activeTab === contentTab) return;

    const direction = activeTab === 'csv' ? 1 : -1;
    const exitOffset = direction * -16;
    const enterOffset = direction * 16;

    tabTransition.current?.stop();
    tabTransition.current = Animated.parallel([
      Animated.timing(tabContentOpacity, {
        toValue: 0,
        duration: 80,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(tabContentTranslateX, {
        toValue: exitOffset,
        duration: 80,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    tabTransition.current.start(({ finished }) => {
      if (!finished) return;
      setContentTab(activeTab);
      tabContentOpacity.setValue(0);
      tabContentTranslateX.setValue(enterOffset);
      // Defer fade-in until height settles (handled in handleContentLayout).
      // Keep a fallback in case the new content's measured height matches the
      // current one within 1px and onLayout doesn't trigger an animation.
      pendingFadeInRef.current = true;
    });
  }, [activeTab, contentTab, visible, tabContentOpacity, tabContentTranslateX]);

  useEffect(() => () => {
    tabTransition.current?.stop();
    tabHeightTransition.current?.stop();
  }, []);

  const handleContentLayout = useCallback((nextHeight: number) => {
    if (nextHeight <= 0) return;
    if (!hasMeasuredContentRef.current) {
      hasMeasuredContentRef.current = true;
      contentHeightRef.current = nextHeight;
      tabContentHeight.setValue(nextHeight);
      setHasMeasuredHeight(true);
      return;
    }

    if (Math.abs(contentHeightRef.current - nextHeight) < 1) {
      if (pendingFadeInRef.current) {
        pendingFadeInRef.current = false;
        startFadeIn();
      }
      return;
    }

    contentHeightRef.current = nextHeight;
    tabHeightTransition.current?.stop();
    setHeightAnimating(true);
    tabHeightTransition.current = Animated.timing(tabContentHeight, {
      toValue: nextHeight,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    tabHeightTransition.current.start(({ finished }) => {
      setHeightAnimating(false);
      if (!finished) return;
      if (pendingFadeInRef.current) {
        pendingFadeInRef.current = false;
        startFadeIn();
      }
    });
  }, [tabContentHeight, startFadeIn]);

  async function submitDeckForm() {
    const trimmedName = name.trim();
    const trimmedTopic = topic.trim();
    if (!trimmedName) return;
    if (!isCollection && !trimmedTopic) return;

    setSubmitting(true);
    try {
      await onSubmit({
        path: trimmedName,
        topic: trimmedTopic,
        language,
        cardCount,
        dueDate: dueDate.trim(),
        explanation,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'An error occurred.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Save failed', message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    const promptChanged = isEdit && !isCollection && editNode?.deck && topic.trim() !== editNode.deck.topic;
    if (!promptChanged) {
      void submitDeckForm();
      return;
    }

    const title = 'Regenerate explanation?';
    const message = 'Editing the prompt will regenerate the explanation for this deck.';
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) void submitDeckForm();
      return;
    }

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => { void submitDeckForm(); } },
    ]);
  }

  function handleFileSelected(fileName: string, content: string) {
    setCsvContent(content);
    setImportStatus({ state: 'idle' });
    if (!name.trim()) {
      const rawName = fileName.replace(/\.[^.]+$/, '');
      setName(rawName.replace(/__/g, '::'));
    }
  }

  const handleExport = useCallback(async () => {
    if (!editNode) return;
    try {
      const { filename, csv } = await exportNodeCsv(editNode.id);
      triggerCsvDownload(filename, csv);
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Unknown error');
    }
  }, [editNode]);

  const handleCsvImport = useCallback(async () => {
    if (!csvContent || !onCsvImport || importStatus.state === 'importing') return;
    setImportStatus({ state: 'importing' });
    try {
      const result = await onCsvImport({
        csvContent,
        collectionPath: name.trim(),
        language,
        cardCount,
      });
      if (result.failedCount > 0 && result.createdCount === 0) {
        setImportStatus({ state: 'done', result });
      } else if (result.failedCount > 0) {
        setImportStatus({ state: 'done', result });
      } else {
        setImportStatus({ state: 'idle' });
      }
    } catch (e: any) {
      setImportStatus({ state: 'error', message: e?.message ?? 'Import failed.' });
    }
  }, [csvContent, onCsvImport, importStatus.state, name, language, cardCount]);

  const isImporting = importStatus.state === 'importing';
  const canSubmit = name.trim().length > 0 && (isCollection || topic.trim().length > 0);
  const showingCsvTab = canUseCsvTab && activeTab === 'csv';
  const csvCanImport = showingCsvTab && csvContent !== null && !isImporting;

  const title = showingCsvTab
    ? 'Import CSV'
    : isCollection ? 'Edit Collection' : isEdit ? 'Edit Deck' : 'New Deck';

  const confirmText = showingCsvTab ? (isImporting ? 'Importing…' : 'Import') : submitting ? 'Saving…' : isEdit ? 'Save' : 'Create';
  const confirmDisabled = showingCsvTab ? !csvCanImport : !canSubmit || submitting;
  const handleConfirm = showingCsvTab ? handleCsvImport : handleSubmit;

  return (
    <PageSheetModal
      visible={visible}
      title={title}
      cancelText="Cancel"
      onCancel={onClose}
      confirmText={confirmText}
      onConfirm={handleConfirm}
      confirmDisabled={confirmDisabled}
      confirmCloses={false}
    >
      {canUseCsvTab && (
        <AnimatedTabbed
          className="mb-6"
          variant="primary"
          tabs={[
            { value: 'create', label: 'Create Deck' },
            { value: 'csv', label: 'Import CSV' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      )}

      <Animated.View
        style={{
          opacity: tabContentOpacity,
          transform: [{ translateX: tabContentTranslateX }],
        }}
      >
        <Animated.View
          style={[
            { overflow: heightAnimating ? 'hidden' : 'visible' },
            hasMeasuredHeight ? { height: tabContentHeight } : null,
          ]}
        >
          <View onLayout={(event) => handleContentLayout(event.nativeEvent.layout.height)}>
            {contentTab === 'csv' ? (
              <DeckModalCsvTab
                collectionPath={name}
                onCollectionPathChange={setName}
                language={language}
                onLanguageChange={setLanguage}
                cardCount={cardCount}
                onCardCountChange={setCardCount}
                onFileSelected={handleFileSelected}
                importStatus={importStatus}
                enabledLanguages={enabledLanguages}
              />
            ) : (
              <DeckModalCreateTab
                isCollection={isCollection}
                isEdit={isEdit}
                onDelete={onDelete}
                onExport={isEdit ? handleExport : undefined}
                onResetSchedule={onResetSchedule}
                editNodeId={editNode?.id}
                dueDate={dueDate}
                onDueDateChange={setDueDate}
                name={name}
                onNameChange={setName}
                topic={topic}
                onTopicChange={setTopic}
                explanation={explanation}
                onExplanationChange={setExplanation}
                showExplanationField={isEdit || explanation.length > 0}
                language={language}
                onLanguageChange={setLanguage}
                cardCount={cardCount}
                onCardCountChange={setCardCount}
                enabledLanguages={enabledLanguages}
              />
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </PageSheetModal>
  );
}
