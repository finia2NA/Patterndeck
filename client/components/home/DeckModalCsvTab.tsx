import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import type { Language, CardCount } from '@/constants/session';
import { AnimatedCollapsible } from '@/components/AnimatedCollapsible';
import { SharedCreationNameField, SharedCreationOptionsSection } from './DeckModalSharedCreationFields';
import { CsvFileDropZone } from './CsvFileDropZone';
import type { CsvImportStatus } from './DeckModal';

interface DeckModalCsvTabProps {
  collectionPath: string;
  onCollectionPathChange: (value: string) => void;
  language: Language;
  onLanguageChange: (value: Language) => void;
  cardCount: CardCount;
  onCardCountChange: (value: CardCount) => void;
  onFileSelected: (fileName: string, content: string) => void;
  importStatus: CsvImportStatus;
  enabledLanguages: string[];
}

export function DeckModalCsvTab({
  collectionPath,
  onCollectionPathChange,
  language,
  onLanguageChange,
  cardCount,
  onCardCountChange,
  onFileSelected,
  importStatus,
  enabledLanguages,
}: DeckModalCsvTabProps) {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  function handleFileSelected(name: string, content: string) {
    setSelectedFileName(name);
    onFileSelected(name, content);
  }

  return (
    <View>
      <SharedCreationNameField
        label="Collection Name"
        description='Use :: to nest in collections, e.g. "Japanese::N5". Imported rows become subdecks in this collection.'
        placeholder="Japanese::N5"
        value={collectionPath}
        onChangeText={onCollectionPathChange}
        autoFocus
      />

      <View className="mb-6 rounded-xl border border-border bg-background-muted overflow-hidden">
        <TouchableOpacity
          className="px-4 py-3 flex-row items-center justify-between"
          onPress={() => setDetailsExpanded(v => !v)}
          activeOpacity={0.85}
        >
          <Text className="text-foreground text-base font-semibold">How this works</Text>
          <Text className="text-foreground-secondary text-sm">{detailsExpanded ? '▼' : '▶'}</Text>
        </TouchableOpacity>
        <AnimatedCollapsible expanded={detailsExpanded} keepMounted>
          <View className="px-4 pb-4">
          <Text className="text-foreground/80 text-sm font-medium mb-2">File Format</Text>
          <Text className="text-foreground-secondary text-sm leading-5 mb-2">
            Tab-separated (.tsv / .csv). Commas in text are fine — only tabs separate columns.
          </Text>
          <View className="bg-surface border border-border rounded-xl px-4 py-3 mb-3">
            <Text className="text-foreground text-sm font-mono">DeckName&#9;Topic&#9;Clarification&#9;Explanation</Text>
          </View>
          <Text className="text-foreground-secondary text-sm leading-5 mb-1">
            • Header row is optional. Without it, columns are: <Text className="text-foreground font-mono">DeckName</Text>, <Text className="text-foreground font-mono">Topic</Text>, <Text className="text-foreground font-mono">Clarification</Text>, <Text className="text-foreground font-mono">Explanation</Text>.
          </Text>
          <Text className="text-foreground-secondary text-sm leading-5 mb-1">
            • <Text className="text-foreground font-mono">DeckName</Text>, <Text className="text-foreground font-mono">Clarification</Text>, and <Text className="text-foreground font-mono">Explanation</Text> columns can be omitted.
          </Text>
          <Text className="text-foreground-secondary text-sm leading-5 mb-4">
            • If <Text className="text-foreground font-mono">DeckName</Text> is blank, <Text className="text-foreground font-mono">Topic</Text> is used as the deck name.
          </Text>

          <Text className="text-foreground/80 text-sm font-medium mb-2">Deck Generation</Text>
          <Text className="text-foreground-secondary text-sm leading-5 mb-1">
            • Each row creates one subdeck inside the collection.
          </Text>
          <Text className="text-foreground-secondary text-sm leading-5 mb-1">
            • <Text className="text-foreground font-mono">Clarification</Text> gives the model extra guidance while keeping <Text className="text-foreground font-mono">Topic</Text> short.
          </Text>
          <Text className="text-foreground-secondary text-sm leading-5 mb-1">
            • <Text className="text-foreground font-mono">Explanation</Text> is treated as already-generated markdown and is saved directly.
          </Text>
          <Text className="text-foreground-secondary text-sm leading-5">
            • Rows without <Text className="text-foreground font-mono">Explanation</Text> generate in the background (up to 5 at a time).
          </Text>
          </View>
        </AnimatedCollapsible>
      </View>

      <Text className="text-foreground/80 text-sm font-medium mb-2">CSV File</Text>
      <Text className="text-foreground-secondary text-sm leading-5 mb-3">
        Drag and drop a `.csv` file here, or click/tap to browse. Max 5,000 rows.
      </Text>
      <CsvFileDropZone fileName={selectedFileName} onFileSelected={handleFileSelected} />

      <View className="pt-4">
        <SharedCreationOptionsSection
          language={language}
          onLanguageChange={onLanguageChange}
          cardCount={cardCount}
          onCardCountChange={onCardCountChange}
          enabledLanguages={enabledLanguages}
        />
      </View>

      <ImportStatusDisplay status={importStatus} />
    </View>
  );
}

function ImportStatusDisplay({ status }: { status: CsvImportStatus }) {
  if (status.state === 'idle') return null;

  if (status.state === 'importing') {
    return (
      <View className="mt-4 p-4 rounded-xl bg-primary/10 border border-primary/30">
        <Text className="text-foreground text-sm font-semibold">Importing…</Text>
      </View>
    );
  }

  if (status.state === 'error') {
    return (
      <View className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
        <Text className="text-red-400 text-sm font-semibold mb-1">Import failed</Text>
        <Text className="text-foreground-secondary text-xs">{status.message}</Text>
      </View>
    );
  }

  const { result } = status;
  const hasFailures = result.failedCount > 0;
  const hasSuccesses = result.createdCount > 0;

  return (
    <View className={`mt-4 p-4 rounded-xl ${hasFailures ? 'bg-red-500/10 border border-red-500/30' : 'bg-green-500/10 border border-green-500/30'}`}>
      {hasSuccesses && (
        <Text className="text-foreground text-sm font-semibold mb-1">
          Created {result.createdCount} deck{result.createdCount === 1 ? '' : 's'}
        </Text>
      )}
      {hasFailures && (
        <>
          <Text className="text-red-400 text-sm font-semibold mb-2">
            {result.failedCount} row{result.failedCount === 1 ? '' : 's'} failed
          </Text>
          <ScrollView style={{ maxHeight: 160 }}>
            {result.failures.map((f, i) => (
              <View key={i} className="mb-2 pl-3 border-l-2 border-red-500/40">
                <Text className="text-foreground-secondary text-xs">
                  <Text className="text-foreground font-semibold">Line {f.line}</Text>
                  {'  '}
                  {f.error}
                </Text>
                <Text className="text-foreground-muted text-xs font-mono mt-0.5" numberOfLines={1}>
                  {f.context}
                </Text>
              </View>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}
