import { useState, useEffect, useCallback } from 'react';
import { Alert, ActivityIndicator, Platform, View, Text } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { PageSheetModal } from '@/components/PageSheetModal';
import { AnimatedTabbed } from '@/components/AnimatedTabbed';
import type { Language, CardCount } from '@/constants/session';
import { DEFAULT_LANGUAGES } from '@/constants/session';
import type { TreeNode } from '@/lib/types';
import type { CsvImportResult } from '@/lib/api';
import { exportNodeCsv, getNodePath, getDeck } from '@/lib/api';
import { DeckModalCreateTab } from './DeckModalCreateTab';
import { DeckModalCsvTab } from './DeckModalCsvTab';
import { useColors } from '@/constants/theme';
import { useEnabledLanguages } from '@/hooks/state/persistent/useSettings';

async function triggerCsvDownload(filename: string, csv: string) {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device.');
  }

  const fileUri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}${filename}`;
  if (!fileUri) {
    throw new Error('Could not prepare a file for export.');
  }

  await FileSystem.writeAsStringAsync(fileUri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/tab-separated-values',
    dialogTitle: 'Export CSV',
    UTI: 'public.comma-separated-values-text',
  });
}

interface DeckModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: DeckFormData) => void | Promise<void>;
  onCsvImport?: (data: CsvImportData) => Promise<CsvImportResult>;
  onDelete?: () => void;
  onEditDataLoaded?: (path: string) => void;
  editNode?: TreeNode | null;
  editNodePath?: string;
  initialData?: Partial<DeckFormData>;
}

export interface DeckFormData {
  path: string;
  topic: string;
  clarification: string;
  language: Language;
  cardCount: CardCount;
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
  onEditDataLoaded,
  editNode,
  editNodePath,
  initialData,
}: DeckModalProps) {
  const colors = useColors();
  const isEdit = editNode !== null && editNode !== undefined;
  const isCollection = isEdit && editNode.deck === null;
  const canUseCsvTab = !isEdit;
  const enabledLanguages = useEnabledLanguages(DEFAULT_LANGUAGES);

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [clarification, setClarification] = useState('');
  const [language, setLanguage] = useState<Language>('Japanese');
  const [cardCount, setCardCount] = useState<CardCount>(0);
  const [explanation, setExplanation] = useState('');
  const [activeTab, setActiveTab] = useState<'create' | 'csv'>('create');
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<CsvImportStatus>({ state: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && isEdit && editNode) {
      setLoading(true);
      setActiveTab('create');
      setCsvContent(null);
      setImportStatus({ state: 'idle' });

      const node = editNode;
      const pathProp = editNodePath;

      async function loadEditData() {
        try {
          const path = await getNodePath(node.id);
          if (onEditDataLoaded) onEditDataLoaded(path);
          setName(path);

          if (node.deck) {
            const deck = await getDeck(node.id);
            setTopic(deck.topic);
            setClarification(deck.clarification ?? '');
            setLanguage(deck.language as Language);
            setCardCount(deck.cardCount as CardCount);
            setExplanation(deck.explanation ?? '');
          } else {
            setTopic('');
            setClarification('');
            setExplanation('');
          }
        } catch {
          setName(pathProp ?? node.name);
          if (node.deck) {
            setTopic(node.deck.topic);
            setClarification(node.deck.clarification ?? '');
            setLanguage(node.deck.language as Language);
            setCardCount(node.deck.cardCount as CardCount);
            setExplanation(node.deck.explanation ?? '');
          }
        } finally {
          setLoading(false);
        }
      }

      loadEditData();
    } else if (visible) {
      setActiveTab('create');
      setCsvContent(null);
      setImportStatus({ state: 'idle' });
      setName(initialData?.path ?? '');
      setTopic(initialData?.topic ?? '');
      setClarification(initialData?.clarification ?? '');
      setLanguage(initialData?.language ?? 'Japanese');
      setCardCount(initialData?.cardCount ?? 0);
      setExplanation(initialData?.explanation ?? '');
    }
  }, [visible, editNode, editNodePath, isEdit, onEditDataLoaded, initialData]);

  useEffect(() => {
    if (!visible) return;
    setLanguage((prev: string) => enabledLanguages.includes(prev) ? prev : enabledLanguages[0] ?? DEFAULT_LANGUAGES[0]);
  }, [visible, enabledLanguages]);

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
        clarification,
        language,
        cardCount,
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

  const promptChanged = isEdit && !isCollection && !!editNode?.deck && (
    topic.trim() !== editNode.deck.topic ||
    clarification.trim() !== (editNode.deck.clarification ?? '')
  );

  function handleSubmit() {
    void submitDeckForm();
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
      await triggerCsvDownload(filename, csv);
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

  const confirmText = showingCsvTab
    ? (isImporting ? 'Importing…' : 'Import')
    : submitting
      ? 'Saving…'
      : isEdit
        ? 'Save'
        : 'Create';
  const confirmDisabled = showingCsvTab ? !csvCanImport : !canSubmit || submitting;
  const handleConfirm = showingCsvTab ? handleCsvImport : handleSubmit;

  const tabContent = activeTab === 'csv' ? (
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
      name={name}
      onNameChange={setName}
      topic={topic}
      onTopicChange={setTopic}
      clarification={clarification}
      onClarificationChange={setClarification}
      explanation={explanation}
      onExplanationChange={setExplanation}
      showExplanationField={isEdit || explanation.length > 0}
      language={language}
      onLanguageChange={setLanguage}
      cardCount={cardCount}
      onCardCountChange={setCardCount}
      enabledLanguages={enabledLanguages}
    />
  );

  if (loading && isEdit) {
    return (
      <PageSheetModal
        visible={visible}
        title={title}
        cancelText="Cancel"
        onCancel={onClose}
        confirmText={confirmText}
        onConfirm={handleConfirm}
        confirmDisabled
      >
        <View className="items-center py-16">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text className="text-foreground-secondary text-base mt-4">Loading deck…</Text>
        </View>
      </PageSheetModal>
    );
  }

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
      confirmConfirmationTitle={promptChanged && !showingCsvTab ? 'Regenerate explanation?' : undefined}
      confirmConfirmationMessage={promptChanged && !showingCsvTab ? 'This will regenerate the explanation for this deck.' : undefined}
      confirmConfirmationActionText={promptChanged && !showingCsvTab ? 'Confirm' : undefined}
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
        >
          {tabContent}
        </AnimatedTabbed>
      )}

      {!canUseCsvTab && tabContent}
    </PageSheetModal>
  );
}
