import { useRef, useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import MonacoReact, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface MonacoEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  externalRevision?: number;
}

export function MonacoEditor({ value, onChange, readOnly, externalRevision = 0 }: MonacoEditorProps) {
  const colorScheme = useColorScheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const applyingExternalValueRef = useRef(false);
  const appliedExternalRevisionRef = useRef(externalRevision);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (externalRevision === appliedExternalRevisionRef.current) return;
    appliedExternalRevisionRef.current = externalRevision;

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
