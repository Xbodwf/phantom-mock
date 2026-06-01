import { useState, useCallback, useEffect } from 'react';
import { Box, Divider, IconButton, Typography, Tooltip, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { PanelLeftClose, PanelLeft, Terminal, Code, Download } from 'lucide-react';
import { FileExplorer } from './FileExplorer';
import { CodeEditor } from './CodeEditor';
import type { FileNode } from '../contexts/ChatContext';

interface WorkspacePanelProps {
  fileTree: FileNode[];
  sessionId: string;
  onFileTreeChange?: (tree: FileNode[]) => void;
}

export function WorkspacePanel({ fileTree, sessionId, onFileTreeChange }: WorkspacePanelProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [localTree, setLocalTree] = useState<FileNode[]>(fileTree);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLocalTree(fileTree);
  }, [fileTree]);

  const handleRefresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/session/${sessionId}/files/tree`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.fileTree) {
        setLocalTree(data.fileTree);
        onFileTreeChange?.(data.fileTree);
      }
    } catch (e) {
      console.error('Failed to refresh file tree:', e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, onFileTreeChange]);

  const handleSelect = useCallback(async (path: string, node: FileNode) => {
    setSelectedPath(path);
    setSelectedNode(node);
    if (node.type === 'file') {
      // 如果文件内容为空，从服务器加载
      if (!node.content && node.content !== '') {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/session/${sessionId}/files/read`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ path }),
          });
          const data = await res.json();
          if (data.content !== undefined) {
            node.content = data.content;
            setSelectedNode({ ...node });
          }
        } catch (e) {
          console.error('Failed to read file:', e);
        }
      }
    }
  }, [sessionId]);

  const handleEditorChange = useCallback(async (value: string) => {
    if (!selectedNode || !selectedPath) return;
    const updatedNode = { ...selectedNode, content: value };
    setSelectedNode(updatedNode);

    // 更新本地 tree
    const updateTree = (nodes: FileNode[], targetPath: string): FileNode[] => {
      return nodes.map(n => {
        const nodePath = `${targetPath ? targetPath + '/' : ''}${n.name}`;
        if (nodePath === selectedPath) {
          return { ...n, content: value };
        }
        if (n.children) {
          return { ...n, children: updateTree(n.children, nodePath) };
        }
        return n;
      });
    };
    const newTree = updateTree(localTree, '');
    setLocalTree(newTree);

    // 保存到服务器（debounce 由外层处理）
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/session/${sessionId}/files/write`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ path: selectedPath, content: value }),
      });
    } catch (e) {
      console.error('Failed to save file:', e);
    }
  }, [selectedNode, selectedPath, sessionId, localTree]);

  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
      py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
      css: 'css', scss: 'scss', html: 'html', json: 'json', yml: 'yaml',
      yaml: 'yaml', md: 'markdown', xml: 'xml', sql: 'sql', sh: 'shell',
      bash: 'shell', dockerfile: 'dockerfile', gitignore: 'plaintext',
    };
    return map[ext || ''] || 'plaintext';
  };

  if (localTree.length === 0) return null;

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      borderLeft: 1,
      borderColor: 'divider',
      bgcolor: 'background.paper',
      position: 'relative',
    }}>
      {/* 工具栏 */}
      <Box sx={{
        display: 'flex', alignItems: 'center', px: 1, py: 0.5,
        borderBottom: 1, borderColor: 'divider', gap: 0.5,
      }}>
        <Tooltip title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}>
          <IconButton size="small" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
          </IconButton>
        </Tooltip>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', flex: 1 }}>
          {selectedPath || 'Workspace'}
        </Typography>
        {selectedNode && selectedNode.type === 'file' && (
          <Tooltip title="Download file">
            <IconButton
              size="small"
              onClick={() => {
                const blob = new Blob([selectedNode.content || ''], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = selectedPath?.split('/').pop() || 'file';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={14} />
            </IconButton>
          </Tooltip>
        )}
        <IconButton size="small" onClick={handleRefresh} disabled={loading}>
          <Terminal size={14} />
        </IconButton>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 文件树侧栏 */}
        {sidebarOpen && (
          <Box sx={{
            width: 220, borderRight: 1, borderColor: 'divider',
            overflow: 'auto', flexShrink: 0,
          }}>
            <FileExplorer
              fileTree={localTree}
              selectedPath={selectedPath}
              onSelect={handleSelect}
              onRefresh={handleRefresh}
              loading={loading}
            />
          </Box>
        )}

        {/* 编辑器 */}
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {selectedNode && selectedNode.type === 'file' ? (
            <CodeEditor
              value={selectedNode.content || ''}
              onChange={handleEditorChange}
              language={getLanguage(selectedNode.name)}
              height="100%"
            />
          ) : (
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', color: 'text.disabled', flexDirection: 'column', gap: 1,
            }}>
              <Code size={32} strokeWidth={1} />
              <Typography variant="body2" color="text.disabled">
                Select a file to edit
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
