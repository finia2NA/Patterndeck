import { useRef, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import MonacoReact, { DiffEditor, type OnMount, type DiffOnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface MonacoEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  externalRevision?: number;
  original?: string;
  showDiff?: boolean;
}

export function MonacoEditor({ value, onChange, readOnly, externalRevision = 0, original, showDiff }: MonacoEditorProps) {
  const colorScheme = useColorScheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const applyingExternalValueRef = useRef(false);
  const appliedExternalRevisionRef = useRef(externalRevision);
  const [pinnedModified, setPinnedModified] = useState(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (externalRevision === appliedExternalRevisionRef.current) return;
    appliedExternalRevisionRef.current = externalRevision;

    setPinnedModified(value);

    const ed = editorRef.current;
    if (!ed) return;

    if (value !== ed.getValue()) {
      applyingExternalValueRef.current = true;
      try {
        ed.setValue(value);
      } finally {
        applyingExternalValueRef.current = false;
      }
    }
  }, [value, externalRevision]);

  const commonOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => ({
    wordWrap: 'on',
    minimap: { enabled: false },
    fontSize: 14,
    automaticLayout: true,
    readOnly: readOnly ?? false,
    scrollBeyondLastLine: false,
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
  }), [readOnly]);

  const handleMount: OnMount = (ed) => {
    editorRef.current = ed;
    appliedExternalRevisionRef.current = externalRevision;
    if (ed.getValue() !== value) {
      applyingExternalValueRef.current = true;
      try {
        ed.setValue(value);
      } finally {
        applyingExternalValueRef.current = false;
      }
    }

    ed.onDidChangeModelContent(() => {
      if (!applyingExternalValueRef.current) {
        onChangeRef.current(ed.getValue());
      }
    });
  };

  const handleDiffMount: DiffOnMount = (diffEditor) => {
    const modifiedEditor = diffEditor.getModifiedEditor();
    editorRef.current = modifiedEditor;
    appliedExternalRevisionRef.current = externalRevision;

    if (modifiedEditor.getValue() !== value) {
      applyingExternalValueRef.current = true;
      try {
        modifiedEditor.setValue(value);
      } finally {
        applyingExternalValueRef.current = false;
      }
    }

    modifiedEditor.onDidChangeModelContent(() => {
      if (!applyingExternalValueRef.current) {
        onChangeRef.current(modifiedEditor.getValue());
      }
    });
  };

  const editorKey = colorScheme;

  if (showDiff && original !== undefined) {
    return (
      <DiffEditor
        key={editorKey}
        height="100%"
        language="markdown"
        theme={colorScheme === 'dark' ? 'vs-dark' : 'vs'}
        original={original}
        modified={pinnedModified}
        onMount={handleDiffMount}
        options={{
          ...commonOptions,
          renderSideBySide: true,
          originalEditable: false,
        }}
      />
    );
  }

  return (
    <MonacoReact
      key={editorKey}
      height="100%"
      language="markdown"
      theme={colorScheme === 'dark' ? 'vs-dark' : 'vs'}
      defaultValue={value}
      onMount={handleMount}
      options={commonOptions}
    />
  );
  }

  return (
    <MonacoReact
      height="100%"
      language="markdown"
      theme={colorScheme === 'dark' ? 'vs-dark' : 'light'}
      defaultValue={value}
      onMount={handleMount}
      options={commonOptions}
    />
  );
}
