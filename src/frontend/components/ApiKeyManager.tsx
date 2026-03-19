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
import { useTranslation } from 'react-i18next';
import { useServer } from '../contexts/ServerContext';
import { ApiKeyEditDialog } from './ApiKeyEditDialog';
import { copyToClipboard as copyText } from '../utils/clipboard';
import { formatDateTime } from '../utils/dateUtils';
import type { ApiKey } from '../types';
import axios from 'axios';

export default function ApiKeyManager() {
  const { t } = useTranslation();
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
      setSnackbar(t('apiKeys.revealedRemaining', '密钥已显示，剩余查看次数: {{count}}', { count: response.data.remainingViews }));
    } catch (e: any) {
      if (e.response?.status === 403) {
        setSnackbar(t('apiKeys.noViewsRemaining', '查看次数已用完'));
      } else {
        setSnackbar(t('apiKeys.revealFailed', '查看失败'));
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
    setSnackbar(t('apiKeys.updateSuccess', '已更新'));
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const apiKey = await createApiKey(newKeyName.trim());
      setNewKey(apiKey.key || '');
      setNewKeyName('');
      setDialogOpen(false);
    } catch (e) {
      setSnackbar(t('apiKeys.failedToCreate'));
    }
  };

  const handleToggleKey = async (id: string, enabled: boolean) => {
    try {
      await updateApiKey(id, { enabled });
    } catch (e) {
      setSnackbar(t('apiKeys.failedToUpdate'));
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm(t('apiKeys.confirmDelete'))) return;
    try {
      await deleteApiKey(id);
      setSnackbar(t('common.delete') + t('common.success'));
    } catch (e) {
      setSnackbar(t('apiKeys.failedToDelete'));
    }
  };

  const copyToClipboard = (text: string) => {
    copyText(text)
      .then(() => setSnackbar(t('apiKeys.copyToClipboard')))
      .catch(() => setSnackbar(t('errors.failedToCopy')));
  };

  const formatDateDisplay = (timestamp: number) => {
    return formatDateTime(timestamp, 'zh-CN');
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t('apiKeys.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={() => setDialogOpen(true)}
        >
          {t('apiKeys.createKey')}
        </Button>
      </Box>

      {apiKeys.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Key size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
            <Typography color="text.secondary">
              {t('apiKeys.noApiKeys')}
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
                    pr: 25,
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                          {key.name}
                        </Typography>
                        <Chip
                          label={key.enabled ? t('common.active') : t('common.disabled')}
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
                            {t('common.created')}: {formatDateDisplay(key.createdAt)}
                          </Box>
                          {key.lastUsedAt && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Clock size={12} />
                              {t('apiKeys.lastUsed')}: {formatDateDisplay(key.lastUsedAt)}
                            </Box>
                          )}
                          {key.viewCount !== undefined && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Eye size={12} />
                              {t('apiKeys.viewCount', '已查看')}: {key.viewCount}/3
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
                          title={t('apiKeys.revealKey', '查看密钥')}
                        >
                          <Eye size={18} />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => handleEditKey(key)}
                        title={t('apiKeys.editKey')}
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
        <DialogTitle>{t('apiKeys.createNewKey')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label={t('apiKeys.keyName')}
            fullWidth
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={t('apiKeys.keyNamePlaceholder')}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateKey} disabled={!newKeyName.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 显示新创建的密钥 */}
      <Dialog open={!!newKey} onClose={() => setNewKey(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('apiKeys.keyCreatedSuccessfully')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('apiKeys.saveKeySecurely')}
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
            {t('apiKeys.copyToClipboard')}
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