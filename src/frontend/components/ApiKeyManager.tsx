import { useState } from 'react';
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
import { Key, Plus, Trash2, Copy, Calendar, Clock } from 'lucide-react';
import { useServer } from '../contexts/ServerContext';

export default function ApiKeyManager() {
  const { apiKeys, createApiKey, updateApiKey, deleteApiKey } = useServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const key = await createApiKey(newKeyName.trim());
      setNewKey(key.key); // 显示完整的 key（只有这一次机会）
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
                <ListItem sx={{ py: 2 }}>
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
                          {key.key}
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
                        </Box>
                      </Box>
                    }
                  />
                  <ListItemSecondaryAction>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
            请立即复制并保存此密钥，关闭后将无法再次查看完整密钥！
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
