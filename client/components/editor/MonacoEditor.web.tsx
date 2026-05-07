import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useColorScheme, Appearance } from 'react-native';
import MonacoReact, { DiffEditor } from '@monaco-editor/react';
import { light, dark } from '@/constants/theme';

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
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const applyingExternalValueRef = useRef(false);
  const appliedExternalRevisionRef = useRef(externalRevision);
  const [pinnedModified, setPinnedModified] = useState(value);

  const beforeMount = useCallback((monaco: any) => {
    monacoRef.current = monaco;

    // Define light theme
    monaco.editor.defineTheme('grammarCrammerLight', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'heading', foreground: light.primary.replace('#', '') },
        { token: 'bold', fontStyle: 'bold' },
        { token: 'italic', fontStyle: 'italic' },
        { token: 'link', foreground: light.secondary.replace('#', '') },
        { token: 'string.link', foreground: light.secondary.replace('#', '') },
      ],
      colors: {
        'editor.background': light.background,
        'editor.foreground': light.foreground,
        'editorCursor.foreground': light.primary,
        'editorLineNumber.foreground': light.foreground_muted,
        'editorLineNumber.activeForeground': light.foreground,
        'editor.selectionBackground': light.primary_light + '40',
        'editor.lineHighlightBackground': light.background_warm,
        'editorBracketMatch.background': light.primary_light + '40',
        'editorBracketMatch.border': light.primary,
        'editorIndentGuide.background': light.background_muted,
        'editorIndentGuide.activeBackground': light.foreground_subtle,
      }
    });

    // Define dark theme
    monaco.editor.defineTheme('grammarCrammerDark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'heading', foreground: dark.primary.replace('#', '') },
        { token: 'bold', fontStyle: 'bold' },
        { token: 'italic', fontStyle: 'italic' },
        { token: 'link', foreground: dark.secondary.replace('#', '') },
        { token: 'string.link', foreground: dark.secondary.replace('#', '') },
      ],
      colors: {
        'editor.background': dark.background,
        'editor.foreground': dark.foreground,
        'editorCursor.foreground': dark.primary,
        'editorLineNumber.foreground': dark.foreground_muted,
        'editorLineNumber.activeForeground': dark.foreground,
        'editor.selectionBackground': dark.primary_light + '40',
        'editor.lineHighlightBackground': dark.background_warm,
        'editorBracketMatch.background': dark.primary_light + '40',
        'editorBracketMatch.border': dark.primary,
        'editorIndentGuide.background': dark.background_muted,
        'editorIndentGuide.activeBackground': dark.foreground_subtle,
      }
    });
  }, []);

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

  const commonOptions = useMemo<any>(() => ({
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

  const handleMount = (ed: any) => {
    editorRef.current = ed;
    appliedExternalRevisionRef.current = externalRevision;

    // Apply theme after mount
    if (monacoRef.current) {
      const scheme = Appearance.getColorScheme();
      monacoRef.current.editor.setTheme(
        scheme === 'dark' ? 'grammarCrammerDark' : 'grammarCrammerLight'
      );
    }

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

  const handleDiffMount = (diffEditor: any) => {
    const modifiedEditor = diffEditor.getModifiedEditor();
    editorRef.current = modifiedEditor;
    appliedExternalRevisionRef.current = externalRevision;

    // Apply theme after mount
    if (monacoRef.current) {
      const scheme = Appearance.getColorScheme();
      monacoRef.current.editor.setTheme(
        scheme === 'dark' ? 'grammarCrammerDark' : 'grammarCrammerLight'
      );
    }

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

  // Apply theme when colorScheme changes using Appearance API
  useEffect(() => {
    const applyTheme = () => {
      if (monacoRef.current) {
        const scheme = Appearance.getColorScheme();
        monacoRef.current.editor.setTheme(
          scheme === 'dark' ? 'grammarCrammerDark' : 'grammarCrammerLight'
        );
      }
    };

    // Listen for changes
    const subscription = Appearance.addChangeListener(applyTheme);
    return () => subscription.remove();
  }, []);

  if (showDiff && original !== undefined) {
    return (
      <DiffEditor
        height="100%"
        language="markdown"
        original={original}
        modified={pinnedModified}
        beforeMount={beforeMount}
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
      height="100%"
      language="markdown"
      defaultValue={value}
      beforeMount={beforeMount}
      onMount={handleMount}
      options={commonOptions}
    />
  );
}
