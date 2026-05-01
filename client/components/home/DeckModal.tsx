import { useState, useEffect, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
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
  clarification: string;
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
  const [clarification, setClarification] = useState('');
  const [language, setLanguage] = useState<Language>('Japanese');
  const [cardCount, setCardCount] = useState<CardCount>(0);
  const [dueDate, setDueDate] = useState('');
  const [explanation, setExplanation] = useState('');
  const [activeTab, setActiveTab] = useState<'create' | 'csv'>('create');
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<CsvImportStatus>({ state: 'idle' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setActiveTab('create');
      setCsvContent(null);
      setImportStatus({ state: 'idle' });
      if (isEdit && editNode) {
        setName(editNodePath ?? editNode.name);
        if (editNode.deck) {
          setTopic(editNode.deck.topic);
          setClarification(editNode.deck.clarification ?? '');
          setLanguage(editNode.deck.language as Language);
          setCardCount(editNode.deck.cardCount as CardCount);
          setDueDate(editNode.deck.dueAt ? formatLocalDateToYmd(new Date(editNode.deck.dueAt)) : '');
          setExplanation(editNode.deck.explanation ?? '');
        } else {
          setTopic('');
          setClarification('');
          setDueDate('');
          setExplanation('');
        }
      } else {
        setName(initialData?.path ?? '');
        setTopic(initialData?.topic ?? '');
        setClarification(initialData?.clarification ?? '');
        setLanguage(initialData?.language ?? 'Japanese');
        setCardCount(initialData?.cardCount ?? 0);
        setDueDate(initialData?.dueDate ?? '');
        setExplanation(initialData?.explanation ?? '');
      }
    }
  }, [visible, editNode, editNodePath, initialData, isEdit]);

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
    const promptChanged = isEdit && !isCollection && editNode?.deck && (
      topic.trim() !== editNode.deck.topic ||
      clarification.trim() !== (editNode.deck.clarification ?? '')
    );
    if (!promptChanged) {
      void submitDeckForm();
      return;
    }

    const title = 'Regenerate explanation?';
    const message = 'Editing the topic or clarification will regenerate the explanation for this deck.';
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
      onResetSchedule={onResetSchedule}
      editNodeId={editNode?.id}
      dueDate={dueDate}
      onDueDateChange={setDueDate}
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
        >
          {tabContent}
        </AnimatedTabbed>
      )}

      {!canUseCsvTab && tabContent}
    </PageSheetModal>
  );
}
