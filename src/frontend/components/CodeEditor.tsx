import Editor from '@monaco-editor/react';
import { Box } from '@mui/material';
import { useTheme } from '../contexts/ThemeContext';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string;
  readOnly?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  language = 'typescript',
  height = '400px',
  readOnly = false,
}: CodeEditorProps) {
  const { theme } = useTheme();

  return (
    <Box sx={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <Editor
        height={height}
        defaultLanguage={language}
        language={language}
        value={value}
        onChange={(val) => onChange(val || '')}
        theme={theme.mode === 'dark' ? 'vs-dark' : 'vs-light'}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          readOnly,
          wordWrap: 'on',
          formatOnPaste: true,
          formatOnType: true,
        }}
      />
    </Box>
  );
}
