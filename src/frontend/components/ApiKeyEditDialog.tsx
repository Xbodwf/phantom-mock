import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Chip,
  Box,
  Stack,
  Typography,
  Autocomplete,
} from '@mui/material';
import type { ApiKey, Model } from '../types';

interface ApiKeyEditDialogProps {
  open: boolean;
  apiKey: ApiKey | null;
  models: Model[];
  actions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (id: string, updates: Partial<ApiKey>) => Promise<void>;
}

export function ApiKeyEditDialog({
  open,
  apiKey,
  models,
  actions,
  onClose,
  onSave,
}: ApiKeyEditDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    modelsMode: 'whitelist' as 'whitelist' | 'blacklist',
    selectedModels: [] as string[],
    actionsMode: 'whitelist' as 'whitelist' | 'blacklist',
    selectedActions: [] as string[],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (apiKey) {
      setFormData({
        name: apiKey.name,
        modelsMode: apiKey.permissions?.modelsMode || 'whitelist',
        selectedModels: apiKey.permissions?.models || [],
        actionsMode: apiKey.permissions?.actionsMode || 'whitelist',
        selectedActions: apiKey.permissions?.actions || [],
      });
    }
  }, [apiKey]);

  const handleSave = async () => {
    if (!apiKey) return;

    setSaving(true);
    try {
      await onSave(apiKey.id, {
        name: formData.name,
        permissions: {
          ...apiKey.permissions,
          models: formData.selectedModels,
          modelsMode: formData.modelsMode,
          actions: formData.selectedActions,
          actionsMode: formData.actionsMode,
        },
      });
      onClose();
    } catch (error) {
      console.error('Failed to save API key:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!apiKey) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>编辑 API Key</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 2 }}>
          <TextField
            label="名称"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            fullWidth
          />

          {/* 模型访问控制 */}
          <Box>
            <FormControl component="fieldset">
              <FormLabel component="legend">模型访问控制</FormLabel>
              <RadioGroup
                row
                value={formData.modelsMode}
                onChange={(e) =>
                  setFormData({ ...formData, modelsMode: e.target.value as 'whitelist' | 'blacklist' })
                }
              >
                <FormControlLabel value="whitelist" control={<Radio />} label="白名单（仅允许）" />
                <FormControlLabel value="blacklist" control={<Radio />} label="黑名单（禁止）" />
              </RadioGroup>
            </FormControl>

            <Autocomplete
              multiple
              options={models.map((m) => m.id)}
              value={formData.selectedModels}
              onChange={(_, newValue) => setFormData({ ...formData, selectedModels: newValue })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={formData.modelsMode === 'whitelist' ? '允许访问的模型' : '禁止访问的模型'}
                  placeholder="选择模型"
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip label={option} size="small" {...getTagProps({ index })} />
                ))
              }
              sx={{ mt: 1 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {formData.modelsMode === 'whitelist'
                ? '留空表示允许所有模型'
                : '留空表示不禁止任何模型'}
            </Typography>
          </Box>

          {/* Action 访问控制 */}
          <Box>
            <FormControl component="fieldset">
              <FormLabel component="legend">Action 访问控制</FormLabel>
              <RadioGroup
                row
                value={formData.actionsMode}
                onChange={(e) =>
                  setFormData({ ...formData, actionsMode: e.target.value as 'whitelist' | 'blacklist' })
                }
              >
                <FormControlLabel value="whitelist" control={<Radio />} label="白名单（仅允许）" />
                <FormControlLabel value="blacklist" control={<Radio />} label="黑名单（禁止）" />
              </RadioGroup>
            </FormControl>

            <Autocomplete
              multiple
              options={actions.map((a) => a.id)}
              value={formData.selectedActions}
              onChange={(_, newValue) => setFormData({ ...formData, selectedActions: newValue })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={formData.actionsMode === 'whitelist' ? '允许访问的 Actions' : '禁止访问的 Actions'}
                  placeholder="选择 Actions"
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const action = actions.find((a) => a.id === option);
                  return (
                    <Chip
                      label={action?.name || option}
                      size="small"
                      {...getTagProps({ index })}
                    />
                  );
                })
              }
              sx={{ mt: 1 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {formData.actionsMode === 'whitelist'
                ? '留空表示允许所有 Actions'
                : '留空表示不禁止任何 Actions'}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
