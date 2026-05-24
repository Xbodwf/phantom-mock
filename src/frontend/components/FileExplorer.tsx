import { useState } from 'react';
import { Box, Typography, IconButton, CircularProgress } from '@mui/material';
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  RefreshCw, Upload, Plus
} from 'lucide-react';
import type { FileNode } from '../contexts/ChatContext';

interface FileExplorerProps {
  fileTree: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string, node: FileNode) => void;
  onRefresh?: () => void;
  loading?: boolean;
}

export function FileExplorer({ fileTree, selectedPath, onSelect, onRefresh, loading }: FileExplorerProps) {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, color: 'text.secondary' }}>
          Explorer
        </Typography>
        {onRefresh && (
          <IconButton size="small" onClick={onRefresh} disabled={loading}>
            {loading ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
          </IconButton>
        )}
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
        {fileTree.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ px: 2, display: 'block', py: 2, textAlign: 'center' }}>
            No files yet
          </Typography>
        ) : (
          fileTree.map((node, i) => (
            <TreeNode
              key={`${node.name}-${i}`}
              node={node}
              depth={0}
              path={node.name}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function TreeNode({ node, depth, path, selectedPath, onSelect }: {
  node: FileNode;
  depth: number;
  path: string;
  selectedPath: string | null;
  onSelect: (path: string, node: FileNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.type === 'directory';
  const isSelected = selectedPath === path;

  const handleClick = () => {
    if (isDir) {
      setExpanded(!expanded);
    }
    onSelect(path, node);
  };

  return (
    <>
      <Box
        onClick={handleClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.3,
          cursor: 'pointer',
          userSelect: 'none',
          bgcolor: isSelected ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
          pl: 1 + depth * 1.5,
        }}
      >
        {isDir ? (
          expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        ) : (
          <Box sx={{ width: 14 }} />
        )}
        {isDir ? (
          expanded ? <FolderOpen size={15} color="#e6a817" /> : <Folder size={15} color="#e6a817" />
        ) : (
          <File size={15} color="#82aaff" />
        )}
        <Typography variant="body2" sx={{ fontSize: 13, ml: 0.3 }}>{node.name}</Typography>
      </Box>
      {isDir && expanded && node.children?.map((child, i) => (
        <TreeNode
          key={`${child.name}-${i}`}
          node={child}
          depth={depth + 1}
          path={`${path}/${child.name}`}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
