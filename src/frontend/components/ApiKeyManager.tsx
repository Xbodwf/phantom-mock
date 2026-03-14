import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  IconButton,
  Chip,
  Switch,
  FormControlLabel,
  Alert,
  Snackbar,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
} from '@mui/material';
import { Key, Plus, Trash2, Copy, Calendar, Clock, Eye, Edit2 } from 'lucide-react';
import { useServer } from '../contexts/ServerContext';
import { ApiKeyEditDialog } from './ApiKeyEditDialog';
import type { ApiKey } from '../types';
import axios from 'axios';

export default function ApiKeyManager() {
  const { apiKeys, createApiKey, updateApiKey, deleteApiKey, models } = useServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [actions, setActions] = useState<Array<{ id: string; name: string }>>([]);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, { key: string; remainingViews: number }>>({});

  useEffect(() => {
    fetchActions();
  }, []);

  const fetchActions = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/actions', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setActions(response.data);
    } catch (e) {
      console.error('Failed to fetch actions:', e);
    }
  };

  const handleRevealKey = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/user/api-keys/${id}/reveal`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setRevealedKeys(prev => ({
        ...prev,
        [id]: { key: response.data.key, remainingViews: response.data.remainingViews }
      }));
      setSnackbar(`密钥已显示，剩余查看次数: ${response.data.remainingViews}`);
    } catch (e: any) {
      if (e.response?.status === 403) {
        setSnackbar('查看次数已用完');
      } else {
        setSnackbar('查看失败');
      }
    }
  };

  const handleEditKey = (key: ApiKey) => {
    setSelectedKey(key);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async (id: string, updates: Partial<ApiKey>) => {
    await updateApiKey(id, updates);
    setEditDialogOpen(false);
    setSnackbar('已更新');
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const apiKey = await createApiKey(newKeyName.trim());
      setNewKey(apiKey.key || ''); // 显示完整的 key（首次创建不计入查看次数）
      setNewKeyName('');
      setDialogOpen(false);
    } catch (e) {
      setSnackbar('创建失败');
    }
  };

  const handleToggleKey = async (id: string, enabled: boolean) => {
    try {
      await updateApiKey(id, { enabled });
    } catch (e) {
      setSnackbar('更新失败');
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm('确定要删除这个 API Key 吗？')) return;
    try {
      await deleteApiKey(id);
      setSnackbar('已删除');
    } catch (e) {
      setSnackbar('删除失败');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSnackbar('已复制到剪贴板');
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          API 密钥管理
        </Typography>
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={() => setDialogOpen(true)}
        >
          创建密钥
        </Button>
      </Box>

      {apiKeys.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Key size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
            <Typography color="text.secondary">
              暂无 API 密钥，点击上方按钮创建
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <List disablePadding>
            {apiKeys.map((key, index) => (
              <Box key={key.id}>
                {index > 0 && <Divider />}
                <ListItem
                  sx={{
                    py: 2,
                    pr: 25, // 给右侧按钮留出足够空间
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                          {key.name}
                        </Typography>
                        <Chip
                          label={key.enabled ? '启用' : '禁用'}
                          size="small"
                          color={key.enabled ? 'success' : 'default'}
                        />
                      </Box>
                    }
                    secondary={
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                          {revealedKeys[key.id] ? revealedKeys[key.id].key : '••••••••••••••••'}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, color: 'text.secondary', fontSize: '0.75rem' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Calendar size={12} />
                            创建: {formatDate(key.createdAt)}
                          </Box>
                          {key.lastUsedAt && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Clock size={12} />
                              最后使用: {formatDate(key.lastUsedAt)}
                            </Box>
                          )}
                          {key.viewCount !== undefined && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Eye size={12} />
                              已查看: {key.viewCount}/3
                            </Box>
                          )}
                        </Box>
                      </Box>
                    }
                  />
                  <ListItemSecondaryAction>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {!revealedKeys[key.id] && (key.viewCount || 0) < 3 && (
                        <IconButton
                          size="small"
                          onClick={() => handleRevealKey(key.id)}
                          title="查看密钥"
                        >
                          <Eye size={18} />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => handleEditKey(key)}
                        title="编辑权限"
                      >
                        <Edit2 size={18} />
                      </IconButton>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={key.enabled}
                            onChange={(_, checked) => handleToggleKey(key.id, checked)}
                            size="small"
                          />
                        }
                        label=""
                      />
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteKey(key.id)}
                        color="error"
                      >
                        <Trash2 size={18} />
                      </IconButton>
                    </Box>
                  </ListItemSecondaryAction>
                </ListItem>
              </Box>
            ))}
          </List>
        </Card>
      )}

      {/* 创建密钥对话框 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>创建新的 API 密钥</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="密钥名称"
            fullWidth
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="例如：生产环境密钥"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleCreateKey} disabled={!newKeyName.trim()}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      {/* 显示新创建的密钥 */}
      <Dialog open={!!newKey} onClose={() => setNewKey(null)} maxWidth="sm" fullWidth>
        <DialogTitle>密钥已创建</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            请立即复制并保存此密钥，您还有 3 次查看机会！
          </Alert>
          <Box
            sx={{
              p: 2,
              bgcolor: 'background.default',
              borderRadius: 2,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {newKey}
            </Typography>
            <IconButton size="small" onClick={() => copyToClipboard(newKey!)}>
              <Copy size={18} />
            </IconButton>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={() => {
              copyToClipboard(newKey!);
              setNewKey(null);
            }}
          >
            复制并关闭
          </Button>
        </DialogActions>
      </Dialog>

      {/* 编辑密钥权限对话框 */}
      <ApiKeyEditDialog
        open={editDialogOpen}
        apiKey={selectedKey}
        models={models}
        actions={actions}
        onClose={() => setEditDialogOpen(false)}
        onSave={handleSaveEdit}
      />

      <Snackbar
        open={!!snackbar}
        autoHideDuration={2000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
