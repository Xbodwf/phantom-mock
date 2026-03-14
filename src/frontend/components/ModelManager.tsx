import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Tooltip,
  Stack,
  Fade,
  Card,
  CardContent,
  CardActions,
  useTheme,
  useMediaQuery,
  Tabs,
  Tab,
  Divider,
  Alert,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  Plus,
  Pencil,
  Trash2,
  DollarSign,
  Key,
  Link,
  Tag,
  Globe,
} from 'lucide-react';
import { useServer } from '../contexts/ServerContext';
import type { Model, ModelUpdateParams } from '../types';
import { useTranslation } from 'react-i18next';

// 格式化上下文大小
function formatContextLength(value?: number): string {
  if (!value) return '-';
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}K`;
  }
  return value.toString();
}

// 解析用户输入的上下文大小
function parseContextLength(value: string): number {
  const trimmed = value.trim().toUpperCase();
  if (trimmed.endsWith('M')) {
    return Math.round(parseFloat(trimmed) * 1000000);
  }
  if (trimmed.endsWith('K')) {
    return Math.round(parseFloat(trimmed) * 1000);
  }
  return parseInt(trimmed) || 0;
}

interface FormData {
  id: string;
  owned_by: string;
  description: string;
  context_length: number;
  aliases: string;
  max_output_tokens: number;
  pricing_type: 'token' | 'request';
  pricing_input: number;
  pricing_output: number;
  pricing_per_request: number;
  api_key: string;
  api_base_url: string;
  api_type: 'openai' | 'anthropic' | 'google' | 'azure' | 'custom';
  supported_features: string;
}

const defaultFormData: FormData = {
  id: '',
  owned_by: 'google',
  description: '',
  context_length: 1048576,
  aliases: '',
  max_output_tokens: 8192,
  pricing_type: 'token',
  pricing_input: 0,
  pricing_output: 0,
  pricing_per_request: 0,
  api_key: '',
  api_base_url: '',
  api_type: 'openai',
  supported_features: '',
};

export default function ModelManager() {
  const { t } = useTranslation();
  const { models, addModel, updateModel, deleteModel } = useServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [activeTab, setActiveTab] = useState(0);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));

  const handleOpenDialog = (model?: Model) => {
    if (model) {
      setEditingModel(model);
      setFormData({
        id: model.id,
        owned_by: model.owned_by,
        description: model.description || '',
        context_length: model.context_length || 1048576,
        aliases: model.aliases?.join(', ') || '',
        max_output_tokens: model.max_output_tokens || 8192,
        pricing_type: model.pricing?.type || 'token',
        pricing_input: model.pricing?.input || 0,
        pricing_output: model.pricing?.output || 0,
        pricing_per_request: model.pricing?.perRequest || 0,
        api_key: model.api_key || '',
        api_base_url: model.api_base_url || '',
        api_type: model.api_type || 'openai',
        supported_features: model.supported_features?.join(', ') || '',
      });
    } else {
      setEditingModel(null);
      setFormData(defaultFormData);
    }
    setActiveTab(0);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingModel(null);
  };

  const handleSave = async () => {
    if (!formData.id.trim()) return;

    const modelData = {
      id: formData.id,
      owned_by: formData.owned_by,
      description: formData.description,
      context_length: formData.context_length,
      aliases: formData.aliases ? formData.aliases.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      max_output_tokens: formData.max_output_tokens,
      pricing: (formData.pricing_type === 'token' && (formData.pricing_input > 0 || formData.pricing_output > 0)) ||
               (formData.pricing_type === 'request' && formData.pricing_per_request > 0) ? {
        type: formData.pricing_type,
        input: formData.pricing_input,
        output: formData.pricing_output,
        perRequest: formData.pricing_per_request,
      } : undefined,
      api_key: formData.api_key || undefined,
      api_base_url: formData.api_base_url || undefined,
      api_type: formData.api_type || undefined,
      supported_features: formData.supported_features ? formData.supported_features.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    };

    if (editingModel) {
      if (formData.id !== editingModel.id) {
        const updateParams: ModelUpdateParams = { ...modelData, newId: formData.id };
        await updateModel(editingModel.id, updateParams);
      } else {
        await updateModel(editingModel.id, modelData);
      }
    } else {
      await addModel(modelData);
    }
    handleCloseDialog();
  };

  const handleDelete = async (id: string) => {
    if (confirm(t('models.manager.confirmDelete', { id }))) {
      await deleteModel(id);
    }
  };

  const ownerColors: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'> = {
    google: 'primary',
    anthropic: 'secondary',
    deepseek: 'success',
    openai: 'info',
  };

  // 移动端卡片视图
  if (isMobile) {
    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('models.manager.totalModels', { count: models.length })}
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<Plus size={18} />}
            onClick={() => handleOpenDialog()}
          >
            {t('common.add')}
          </Button>
        </Box>

        <Stack spacing={1.5}>
          {models.map((model) => (
            <Fade in key={model.id}>
              <Card sx={{ backgroundColor: 'background.paper' }}>
                <CardContent sx={{ pb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {model.id}
                    </Typography>
                    <Chip
                      label={model.owned_by}
                      size="small"
                      color={ownerColors[model.owned_by] || 'default'}
                      sx={{ borderRadius: 2 }}
                    />
                  </Box>
                  {model.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5, fontSize: '0.8rem' }}>
                      {model.description}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                    <Chip key="context" size="small" label={`${t('models.manager.contextLength')}: ${formatContextLength(model.context_length)}`} />
                    {model.max_output_tokens && (
                      <Chip key="output" size="small" label={`${t('common.output')}: ${formatContextLength(model.max_output_tokens)}`} />
                    )}
                    {model.api_key && (
                      <Chip key="apikey" size="small" icon={<Key size={14} />} label={t('models.manager.configuredApiKey')} color="success" />
                    )}
                  </Stack>
                </CardContent>
                <CardActions sx={{ pt: 0 }}>
                  <Button
                    size="small"
                    startIcon={<Pencil size={16} />}
                    onClick={() => handleOpenDialog(model)}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<Trash2 size={16} />}
                    onClick={() => handleDelete(model.id)}
                  >
                    {t('common.delete')}
                  </Button>
                </CardActions>
              </Card>
            </Fade>
          ))}
        </Stack>

        <Dialog 
          open={dialogOpen} 
          onClose={handleCloseDialog} 
          fullWidth 
          maxWidth="sm"
          fullScreen={isSmall}
        >
          <DialogTitle>{editingModel ? t('models.manager.editModel') : t('models.manager.addModel')}</DialogTitle>
          <DialogContent>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="fullWidth">
                <Tab label={t('models.manager.basicInfo')} />
                <Tab label={t('models.manager.advancedSettings')} />
              </Tabs>
            </Box>

            {activeTab === 0 && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label={t('models.manager.modelId')}
                  fullWidth
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  placeholder={t('models.manager.modelIdPlaceholder')}
                  size="small"
                />
                <TextField
                  label={t('models.provider')}
                  fullWidth
                  value={formData.owned_by}
                  onChange={(e) => setFormData({ ...formData, owned_by: e.target.value })}
                  placeholder={t('models.manager.providerPlaceholder')}
                  size="small"
                />
                <TextField
                  label={t('models.details.description')}
                  fullWidth
                  multiline
                  minRows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('models.manager.descriptionPlaceholder')}
                  size="small"
                />
                <TextField
                  label={t('models.manager.contextLength')}
                  fullWidth
                  value={formData.context_length}
                  onChange={(e) => setFormData({ ...formData, context_length: parseContextLength(e.target.value) })}
                  placeholder={t('models.manager.contextLengthPlaceholder')}
                  helperText={`=${formatContextLength(formData.context_length)} tokens`}
                  size="small"
                />
                <TextField
                  label={t('models.manager.maxOutputTokens')}
                  fullWidth
                  value={formData.max_output_tokens}
                  onChange={(e) => setFormData({ ...formData, max_output_tokens: parseInt(e.target.value) || 8192 })}
                  placeholder="例如: 8192"
                  size="small"
                />
                <TextField
                  label={t('models.manager.aliases')}
                  fullWidth
                  value={formData.aliases}
                  onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                  placeholder={t('models.manager.aliasesPlaceholder')}
                  helperText={t('models.manager.aliasesHelper')}
                  size="small"
                />
              </Stack>
            )}

            {activeTab === 1 && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Alert severity="info" sx={{ mb: 1 }}>
                  {t('models.manager.advancedInfo')}
                </Alert>
                
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DollarSign size={16} /> {t('models.manager.pricingTitle')}
                </Typography>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('models.manager.pricingType')}</InputLabel>
                  <Select
                    value={formData.pricing_type}
                    label={t('models.manager.pricingType')}
                    onChange={(e) => setFormData({ ...formData, pricing_type: e.target.value })}
                  >
                    <MenuItem value="token">{t('models.manager.pricingByToken')}</MenuItem>
                    <MenuItem value="request">{t('models.manager.pricingByRequest')}</MenuItem>
                  </Select>
                </FormControl>

                {formData.pricing_type === 'token' ? (
                  <Stack direction="row" spacing={2}>
                    <TextField
                      label={t('models.manager.inputPrice')}
                      type="number"
                      value={formData.pricing_input}
                      onChange={(e) => setFormData({ ...formData, pricing_input: parseFloat(e.target.value) || 0 })}
                      size="small"
                      inputProps={{ min: 0, step: 0.0001 }}
                    />
                    <TextField
                      label={t('models.manager.outputPrice')}
                      type="number"
                      value={formData.pricing_output}
                      onChange={(e) => setFormData({ ...formData, pricing_output: parseFloat(e.target.value) || 0 })}
                      size="small"
                      inputProps={{ min: 0, step: 0.0001 }}
                    />
                  </Stack>
                ) : (
                  <TextField
                    label={t('models.manager.pricePerRequest')}
                    type="number"
                    fullWidth
                    value={formData.pricing_per_request}
                    onChange={(e) => setFormData({ ...formData, pricing_per_request: parseFloat(e.target.value) || 0 })}
                    size="small"
                    inputProps={{ min: 0, step: 0.0001 }}
                    helperText={t('models.manager.pricePerRequestHelper')}
                  />
                )}

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Globe size={16} /> {t('models.manager.apiConfig')}
                </Typography>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('models.manager.apiType')}</InputLabel>
                  <Select
                    value={formData.api_type}
                    label={t('models.manager.apiType')}
                    onChange={(e) => setFormData({ ...formData, api_type: e.target.value })}
                  >
                    <MenuItem value="openai">OpenAI</MenuItem>
                    <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
                    <MenuItem value="google">Google (Gemini)</MenuItem>
                    <MenuItem value="azure">Azure OpenAI</MenuItem>
                    <MenuItem value="custom">{t('models.manager.customApi')}</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label={t('models.manager.apiKey')}
                  fullWidth
                  type="password"
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  placeholder="sk-..."
                  size="small"
                />
                <TextField
                  label={t('models.manager.apiBaseUrl')}
                  fullWidth
                  value={formData.api_base_url}
                  onChange={(e) => setFormData({ ...formData, api_base_url: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  size="small"
                  helperText={t('models.manager.apiBaseUrlHelper')}
                />

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Tag size={16} /> {t('models.manager.supportedFeatures')}
                </Typography>
                <TextField
                  label={t('models.manager.supportedFeatures')}
                  fullWidth
                  value={formData.supported_features}
                  onChange={(e) => setFormData({ ...formData, supported_features: e.target.value })}
                  placeholder={t('models.manager.featuresPlaceholder')}
                  helperText="用逗号分隔"
                  size="small"
                />
              </Stack>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseDialog}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!formData.id.trim()}
            >
              {editingModel ? t('common.save') : t('common.add')}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // 桌面端表格视图
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {t('models.manager.totalModels', { count: models.length })}
        </Typography>
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={() => handleOpenDialog()}
        >
          {t('models.manager.addModel')}
        </Button>
      </Box>

      <TableContainer 
        component={Paper} 
        sx={{ 
          backgroundColor: 'background.paper',
          borderRadius: 3,
        }}
      >
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('models.manager.modelId')}</TableCell>
              <TableCell>{t('models.provider')}</TableCell>
              <TableCell>{t('models.details.description')}</TableCell>
              <TableCell align="right">{t('models.manager.contextLength')}</TableCell>
              <TableCell align="right">{t('models.manager.maxOutputTokens')}</TableCell>
              <TableCell align="center">API</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {models.map((model) => (
              <Fade in key={model.id}>
                <TableRow
                  sx={{ 
                    '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
                  }}
                >
                  <TableCell>
                    <Box>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                        {model.id}
                      </Typography>
                      {model.aliases && model.aliases.length > 0 && (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                          {model.aliases.slice(0, 2).map(alias => (
                            <Chip key={alias} label={alias} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                          ))}
                          {model.aliases.length > 2 && (
                            <Chip label={`+${model.aliases.length - 2}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                          )}
                        </Stack>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={model.owned_by}
                      size="small"
                      color={ownerColors[model.owned_by] || 'default'}
                      sx={{ borderRadius: 2 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 200 }}>
                      {model.description || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">
                      {formatContextLength(model.context_length)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2">
                      {formatContextLength(model.max_output_tokens)}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} justifyContent="center">
                      {model.api_key && (
                        <Tooltip title={t('models.manager.configuredApiKey')}>
                          <Chip icon={<Key size={12} />} label="Key" size="small" color="success" />
                        </Tooltip>
                      )}
                      {model.api_base_url && (
                        <Tooltip title={model.api_base_url}>
                          <Chip icon={<Link size={12} />} label="URL" size="small" color="info" />
                        </Tooltip>
                      )}
                      {!model.api_key && !model.api_base_url && (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title={t('common.edit')}>
                        <IconButton size="small" onClick={() => handleOpenDialog(model)}>
                          <Pencil size={16} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete')}>
                        <IconButton size="small" color="error" onClick={() => handleDelete(model.id)}>
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              </Fade>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingModel ? t('models.manager.editModel') : t('models.manager.addModel')}</DialogTitle>
        <DialogContent>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, mt: 1 }}>
            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
              <Tab label={t('models.manager.basicInfo')} />
              <Tab label={t('models.manager.advancedSettings')} />
            </Tabs>
          </Box>

          {activeTab === 0 && (
            <Stack spacing={2}>
              <TextField
                label={t('models.manager.modelId')}
                fullWidth
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                placeholder={t('models.manager.modelIdPlaceholder')}
              />
              <TextField
                label={t('models.provider')}
                fullWidth
                value={formData.owned_by}
                onChange={(e) => setFormData({ ...formData, owned_by: e.target.value })}
                placeholder={t('models.manager.providerPlaceholder')}
              />
              <TextField
                label={t('models.details.description')}
                fullWidth
                multiline
                minRows={2}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('models.manager.descriptionPlaceholder')}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label={t('models.manager.contextLength')}
                  fullWidth
                  value={formData.context_length}
                  onChange={(e) => setFormData({ ...formData, context_length: parseContextLength(e.target.value) })}
                  placeholder={t('models.manager.contextLengthPlaceholder')}
                  helperText={`=${formatContextLength(formData.context_length)} tokens`}
                />
                <TextField
                  label={t('models.manager.maxOutputTokens')}
                  fullWidth
                  value={formData.max_output_tokens}
                  onChange={(e) => setFormData({ ...formData, max_output_tokens: parseInt(e.target.value) || 8192 })}
                  placeholder="例如: 8192"
                />
              </Stack>
              <TextField
                label={t('models.manager.aliases')}
                fullWidth
                value={formData.aliases}
                onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                placeholder={t('models.manager.aliasesPlaceholder')}
                helperText={t('models.manager.aliasesHelper')}
              />
            </Stack>
          )}

          {activeTab === 1 && (
            <Stack spacing={2}>
              <Alert severity="info">
                {t('models.manager.advancedInfo')}
              </Alert>
              
              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DollarSign size={16} /> {t('models.manager.pricingTitle')}
              </Typography>
              <FormControl fullWidth>
                <InputLabel>{t('models.manager.pricingType')}</InputLabel>
                <Select
                  value={formData.pricing_type}
                  label={t('models.manager.pricingType')}
                  onChange={(e) => setFormData({ ...formData, pricing_type: e.target.value })}
                >
                  <MenuItem value="token">{t('models.manager.pricingByToken')}</MenuItem>
                  <MenuItem value="request">{t('models.manager.pricingByRequest')}</MenuItem>
                </Select>
              </FormControl>

              {formData.pricing_type === 'token' ? (
                <Stack direction="row" spacing={2}>
                  <TextField
                    label={t('models.manager.inputPrice')}
                    type="number"
                    value={formData.pricing_input}
                    onChange={(e) => setFormData({ ...formData, pricing_input: parseFloat(e.target.value) || 0 })}
                    inputProps={{ min: 0, step: 0.0001 }}
                  />
                  <TextField
                    label={t('models.manager.outputPrice')}
                    type="number"
                    value={formData.pricing_output}
                    onChange={(e) => setFormData({ ...formData, pricing_output: parseFloat(e.target.value) || 0 })}
                    inputProps={{ min: 0, step: 0.0001 }}
                  />
                </Stack>
              ) : (
                <TextField
                  label={t('models.manager.pricePerRequest')}
                  type="number"
                  fullWidth
                  value={formData.pricing_per_request}
                  onChange={(e) => setFormData({ ...formData, pricing_per_request: parseFloat(e.target.value) || 0 })}
                  inputProps={{ min: 0, step: 0.0001 }}
                  helperText={t('models.manager.pricePerRequestHelper')}
                />
              )}

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Key size={16} /> {t('models.manager.apiConfig')}
              </Typography>
              <TextField
                label={t('models.manager.apiKey')}
                fullWidth
                type="password"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                placeholder="sk-..."
              />
              <TextField
                label={t('models.manager.apiBaseUrl')}
                fullWidth
                value={formData.api_base_url}
                onChange={(e) => setFormData({ ...formData, api_base_url: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tag size={16} /> {t('models.manager.supportedFeatures')}
              </Typography>
              <TextField
                label={t('models.manager.supportedFeatures')}
                fullWidth
                value={formData.supported_features}
                onChange={(e) => setFormData({ ...formData, supported_features: e.target.value })}
                placeholder={t('models.manager.featuresPlaceholder')}
                helperText="用逗号分隔"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseDialog}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!formData.id.trim()}
          >
            {editingModel ? t('common.save') : t('common.add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}