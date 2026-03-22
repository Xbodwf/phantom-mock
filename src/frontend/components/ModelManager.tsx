import { useState, useRef } from 'react';
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
  Avatar,
  CircularProgress,
  FormControlLabel,
  Switch,
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
  Image,
  Upload,
  X,
  Gauge,
  Settings,
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
  type: 'text' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'rerank' | 'responses';
  context_length: number;
  aliases: string;
  max_output_tokens: number;
  pricing_type: 'token' | 'request';
  pricing_input: number;
  pricing_output: number;
  pricing_per_request: number;
  pricing_cache_read: number;
  api_key: string;
  api_base_url: string;
  api_type: 'openai' | 'anthropic' | 'google' | 'azure' | 'custom';
  forwardModelName: string;       // 转发时使用的模型名称
  supported_features: string;
  icon: string;
  allowManualReply: boolean;      // 是否允许人工回复
  // 新增字段
  rpm: number;
  tpm: number;
  maxConcurrentRequests: number;
  concurrentQueues: number;
  allowOveruse: number;
}

const defaultFormData: FormData = {
  id: '',
  owned_by: 'google',
  description: '',
  type: 'text',
  context_length: 1048576,
  aliases: '',
  max_output_tokens: 8192,
  pricing_type: 'token',
  pricing_input: 0,
  pricing_output: 0,
  pricing_per_request: 0,
  pricing_cache_read: 0,
  api_key: '',
  api_base_url: '',
  api_type: 'openai',
  forwardModelName: '',
  supported_features: '',
  icon: '',
  allowManualReply: false,
  rpm: 0,
  tpm: 0,
  maxConcurrentRequests: 100,
  concurrentQueues: 10,
  allowOveruse: 0,
};

export default function ModelManager() {
  const { t } = useTranslation();
  const { models, addModel, updateModel, deleteModel } = useServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [activeTab, setActiveTab] = useState(0);

  // 图标相关状态
  const [availableIcons, setAvailableIcons] = useState<Array<{ filename: string; url: string }>>([]);
  const [loadingIcons, setLoadingIcons] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));

  // 获取可用图标列表
  const fetchAvailableIcons = async () => {
    setLoadingIcons(true);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/model-icons', { headers });
      if (res.ok) {
        const data = await res.json();
        setAvailableIcons(data.icons || []);
      }
    } catch (error) {
      console.error('Failed to fetch icons:', error);
    } finally {
      setLoadingIcons(false);
    }
  };

  // 上传图标
  const handleUploadIcon = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingIcon(true);
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('icon', file);

      const res = await fetch('/api/model-icons/upload', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        // 选择刚上传的图标
        setFormData(prev => ({ ...prev, icon: data.icon.url }));
        // 刷新图标列表
        await fetchAvailableIcons();
      } else {
        const error = await res.json();
        alert(error.error || '上传失败');
      }
    } catch (error) {
      console.error('Failed to upload icon:', error);
      alert('上传失败');
    } finally {
      setUploadingIcon(false);
      // 清空文件输入
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  // 打开对话框时加载图标列表
  const handleOpenDialog = (model?: Model) => {
    fetchAvailableIcons();
    if (model) {
      setEditingModel(model);
      setFormData({
        id: model.id,
        owned_by: model.owned_by,
        description: model.description || '',
        type: model.type || 'text',
        context_length: model.context_length || 1048576,
        aliases: model.aliases?.join(', ') || '',
        max_output_tokens: model.max_output_tokens || 8192,
        pricing_type: model.pricing?.type || 'token',
        pricing_input: model.pricing?.input || 0,
        pricing_output: model.pricing?.output || 0,
        pricing_per_request: model.pricing?.perRequest || 0,
        pricing_cache_read: model.pricing?.cacheRead || 0,
        api_key: model.api_key || '',
        api_base_url: model.api_base_url || '',
        api_type: model.api_type || 'openai',
        forwardModelName: model.forwardModelName || '',
        supported_features: model.supported_features?.join(', ') || '',
        icon: model.icon || '',
        allowManualReply: model.allowManualReply || false,
        rpm: model.rpm || 0,
        tpm: model.tpm || 0,
        maxConcurrentRequests: model.maxConcurrentRequests || 100,
        concurrentQueues: model.concurrentQueues || 10,
        allowOveruse: model.allowOveruse || 0,
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
      type: formData.type,
      context_length: formData.context_length,
      aliases: formData.aliases ? formData.aliases.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      max_output_tokens: formData.max_output_tokens,
      pricing: (formData.pricing_type === 'token' && (formData.pricing_input > 0 || formData.pricing_output > 0)) ||
               (formData.pricing_type === 'request' && formData.pricing_per_request > 0) ? {
        type: formData.pricing_type,
        input: formData.pricing_input,
        output: formData.pricing_output,
        perRequest: formData.pricing_per_request,
        cacheRead: formData.pricing_cache_read || undefined,
      } : undefined,
      api_key: formData.api_key || undefined,
      api_base_url: formData.api_base_url || undefined,
      api_type: formData.api_type || undefined,
      forwardModelName: formData.forwardModelName || undefined,
      supported_features: formData.supported_features ? formData.supported_features.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      icon: formData.icon || undefined,
      allowManualReply: formData.allowManualReply,
      // 新增字段
      rpm: formData.rpm || undefined,
      tpm: formData.tpm || undefined,
      maxConcurrentRequests: formData.maxConcurrentRequests || undefined,
      concurrentQueues: formData.concurrentQueues || undefined,
      allowOveruse: formData.allowOveruse || undefined,
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {model.icon && (
                        <Avatar 
                          src={model.icon} 
                          sx={{ width: 24, height: 24, borderRadius: 0.5 }}
                          variant="rounded"
                        >
                          <Image size={16} />
                        </Avatar>
                      )}
                      <Typography variant="subtitle2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {model.id}
                      </Typography>
                    </Box>
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

                {/* 模型类型 */}
                <FormControl fullWidth size="small">
                  <InputLabel id="model-type-label">{t('models.type')}</InputLabel>
                  <Select
                    labelId="model-type-label"
                    id="model-type-select"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    label={t('models.type')}
                  >
                    <MenuItem value="text">Text</MenuItem>
                    <MenuItem value="image">Image</MenuItem>
                    <MenuItem value="video">Video</MenuItem>
                    <MenuItem value="tts">TTS</MenuItem>
                    <MenuItem value="stt">STT</MenuItem>
                    <MenuItem value="embedding">Embedding</MenuItem>
                    <MenuItem value="rerank">Rerank</MenuItem>
                    <MenuItem value="responses">Responses</MenuItem>
                  </Select>
                </FormControl>

                {/* 图标选择 */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Image size={16} /> {t('models.manager.icon', '模型图标')}
                  </Typography>
                  
                  {/* 当前选中的图标 */}
                  {formData.icon && (
                    <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar 
                        src={formData.icon} 
                        sx={{ width: 48, height: 48, borderRadius: 1 }}
                        variant="rounded"
                      >
                        <Image size={24} />
                      </Avatar>
                      <Typography variant="body2" color="text.secondary">
                        {formData.icon.split('/').pop()}
                      </Typography>
                      <IconButton 
                        size="small" 
                        onClick={() => setFormData({ ...formData, icon: '' })}
                        title={t('common.remove', '移除')}
                      >
                        <X size={16} />
                      </IconButton>
                    </Box>
                  )}
                  
                  {/* 上传按钮 */}
                  <Box sx={{ mb: 2 }}>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                      style={{ display: 'none' }}
                      ref={fileInputRef}
                      onChange={handleUploadIcon}
                    />
                    <Button
                      variant="outlined"
                      component="span"
                      startIcon={uploadingIcon ? <CircularProgress size={16} /> : <Upload size={16} />}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingIcon}
                      size="small"
                    >
                      {uploadingIcon ? t('models.manager.uploading', '上传中...') : t('models.manager.uploadIcon', '上传新图标')}
                    </Button>
                  </Box>
                  
                  {/* 已有图标列表 */}
                  {loadingIcons ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : availableIcons.length > 0 ? (
                    <Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {t('models.manager.selectIcon', '选择已有图标')}:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {availableIcons.map((icon) => (
                          <Tooltip key={icon.filename} title={icon.filename}>
                            <Avatar
                              src={icon.url}
                              sx={{
                                width: 40,
                                height: 40,
                                borderRadius: 1,
                                cursor: 'pointer',
                                border: formData.icon === icon.url ? '2px solid' : '1px solid',
                                borderColor: formData.icon === icon.url ? 'primary.main' : 'divider',
                                '&:hover': { opacity: 0.8 },
                              }}
                              variant="rounded"
                              onClick={() => setFormData({ ...formData, icon: icon.url })}
                            />
                          </Tooltip>
                        ))}
                      </Box>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('models.manager.noIcons', '暂无已上传的图标')}
                    </Typography>
                  )}
                </Box>
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
                <TextField
                  label={t('models.manager.forwardModelName', '转发模型名称')}
                  fullWidth
                  value={formData.forwardModelName}
                  onChange={(e) => setFormData({ ...formData, forwardModelName: e.target.value })}
                  placeholder={t('models.manager.forwardModelNamePlaceholder', '留空则使用原模型名称')}
                  size="small"
                  helperText={t('models.manager.forwardModelNameHelper', '不同平台的模型名称可能不同，可在此指定转发时使用的模型名称')}
                />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.allowManualReply}
                      onChange={(e) => setFormData({ ...formData, allowManualReply: e.target.checked })}
                    />
                  }
                  label={t('models.manager.allowManualReply', '允许人工回复')}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {t('models.manager.allowManualReplyHelper', '开启后，该模型的请求会在请求列表中显示，供管理员手动回复')}
                </Typography>

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

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Gauge size={16} /> {t('models.manager.rateLimits', '速率限制')}
                </Typography>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label={t('models.manager.rpm', 'RPM (每分钟请求数)')}
                    type="number"
                    fullWidth
                    value={formData.rpm}
                    onChange={(e) => setFormData({ ...formData, rpm: parseInt(e.target.value) || 0 })}
                    size="small"
                    inputProps={{ min: 0 }}
                    helperText="0 表示无限制"
                  />
                  <TextField
                    label={t('models.manager.tpm', 'TPM (每分钟Token数)')}
                    type="number"
                    fullWidth
                    value={formData.tpm}
                    onChange={(e) => setFormData({ ...formData, tpm: parseInt(e.target.value) || 0 })}
                    size="small"
                    inputProps={{ min: 0 }}
                    helperText="0 表示无限制"
                  />
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Settings size={16} /> {t('models.manager.concurrentSettings', '并发配置')}
                </Typography>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label={t('models.manager.maxConcurrentRequests', '最大同时请求数')}
                    type="number"
                    fullWidth
                    value={formData.maxConcurrentRequests}
                    onChange={(e) => setFormData({ ...formData, maxConcurrentRequests: parseInt(e.target.value) || 100 })}
                    size="small"
                    inputProps={{ min: 1 }}
                  />
                  <TextField
                    label={t('models.manager.concurrentQueues', '同时进行队列数')}
                    type="number"
                    fullWidth
                    value={formData.concurrentQueues}
                    onChange={(e) => setFormData({ ...formData, concurrentQueues: parseInt(e.target.value) || 10 })}
                    size="small"
                    inputProps={{ min: 1 }}
                  />
                </Stack>
                <TextField
                  label={t('models.manager.allowOveruse', '允许超开倍率')}
                  type="number"
                  fullWidth
                  value={formData.allowOveruse}
                  onChange={(e) => setFormData({ ...formData, allowOveruse: parseFloat(e.target.value) || 0 })}
                  size="small"
                  inputProps={{ min: 0, step: 0.1 }}
                  helperText={t('models.manager.allowOveruseHelper', '0表示不允许超开，1以上表示最大请求数*倍率')}
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
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {model.icon && (
                          <Avatar 
                            src={model.icon} 
                            sx={{ width: 24, height: 24, borderRadius: 0.5 }}
                            variant="rounded"
                          >
                            <Image size={16} />
                          </Avatar>
                        )}
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                          {model.id}
                        </Typography>
                      </Box>
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
              
              {/* 图标选择 */}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Image size={16} /> {t('models.manager.icon', '模型图标')}
                </Typography>
                
                {/* 当前选中的图标 */}
                {formData.icon && (
                  <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar 
                      src={formData.icon} 
                      sx={{ width: 48, height: 48, borderRadius: 1 }}
                      variant="rounded"
                    >
                      <Image size={24} />
                    </Avatar>
                    <Typography variant="body2" color="text.secondary">
                      {formData.icon.split('/').pop()}
                    </Typography>
                    <IconButton 
                      size="small" 
                      onClick={() => setFormData({ ...formData, icon: '' })}
                      title={t('common.remove', '移除')}
                    >
                      <X size={16} />
                    </IconButton>
                  </Box>
                )}
                
                {/* 上传按钮 */}
                <Box sx={{ mb: 2 }}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                    style={{ display: 'none' }}
                    id="icon-upload-desktop"
                    onChange={handleUploadIcon}
                  />
                  <Button
                    variant="outlined"
                    component="label"
                    htmlFor="icon-upload-desktop"
                    startIcon={uploadingIcon ? <CircularProgress size={16} /> : <Upload size={16} />}
                    disabled={uploadingIcon}
                  >
                    {uploadingIcon ? t('models.manager.uploading', '上传中...') : t('models.manager.uploadIcon', '上传新图标')}
                  </Button>
                </Box>
                
                {/* 已有图标列表 */}
                {loadingIcons ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : availableIcons.length > 0 ? (
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {t('models.manager.selectIcon', '选择已有图标')}:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {availableIcons.map((icon) => (
                        <Tooltip key={icon.filename} title={icon.filename}>
                          <Avatar
                            src={icon.url}
                            sx={{
                              width: 40,
                              height: 40,
                              borderRadius: 1,
                              cursor: 'pointer',
                              border: formData.icon === icon.url ? '2px solid' : '1px solid',
                              borderColor: formData.icon === icon.url ? 'primary.main' : 'divider',
                              '&:hover': { opacity: 0.8 },
                            }}
                            variant="rounded"
                            onClick={() => setFormData({ ...formData, icon: icon.url })}
                          />
                        </Tooltip>
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('models.manager.noIcons', '暂无已上传的图标')}
                  </Typography>
                )}
              </Box>
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
              <TextField
                label={t('models.manager.forwardModelName', '转发模型名称')}
                fullWidth
                value={formData.forwardModelName}
                onChange={(e) => setFormData({ ...formData, forwardModelName: e.target.value })}
                placeholder={t('models.manager.forwardModelNamePlaceholder', '留空则使用原模型名称')}
                helperText={t('models.manager.forwardModelNameHelper', '不同平台的模型名称可能不同，可在此指定转发时使用的模型名称')}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={formData.allowManualReply}
                    onChange={(e: any) => setFormData({ ...formData, allowManualReply: e.target.checked })}
                  />
                }
                label={t('models.manager.allowManualReply', '允许人工回复')}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {t('models.manager.allowManualReplyHelper', '开启后，该模型的请求会在请求列表中显示，供管理员手动回复')}
              </Typography>

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

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Gauge size={16} /> {t('models.manager.rateLimits', '速率限制')}
              </Typography>
              <Stack direction="row" spacing={2}>
                <TextField
                  label={t('models.manager.rpm', 'RPM (每分钟请求数)')}
                  type="number"
                  fullWidth
                  value={formData.rpm}
                  onChange={(e) => setFormData({ ...formData, rpm: parseInt(e.target.value) || 0 })}
                  inputProps={{ min: 0 }}
                  helperText="0 表示无限制"
                />
                <TextField
                  label={t('models.manager.tpm', 'TPM (每分钟Token数)')}
                  type="number"
                  fullWidth
                  value={formData.tpm}
                  onChange={(e) => setFormData({ ...formData, tpm: parseInt(e.target.value) || 0 })}
                  inputProps={{ min: 0 }}
                  helperText="0 表示无限制"
                />
              </Stack>

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Settings size={16} /> {t('models.manager.concurrentSettings', '并发配置')}
              </Typography>
              <Stack direction="row" spacing={2}>
                <TextField
                  label={t('models.manager.maxConcurrentRequests', '最大同时请求数')}
                  type="number"
                  fullWidth
                  value={formData.maxConcurrentRequests}
                  onChange={(e) => setFormData({ ...formData, maxConcurrentRequests: parseInt(e.target.value) || 100 })}
                  inputProps={{ min: 1 }}
                />
                <TextField
                  label={t('models.manager.concurrentQueues', '同时进行队列数')}
                  type="number"
                  fullWidth
                  value={formData.concurrentQueues}
                  onChange={(e) => setFormData({ ...formData, concurrentQueues: parseInt(e.target.value) || 10 })}
                  inputProps={{ min: 1 }}
                />
              </Stack>
              <TextField
                label={t('models.manager.allowOveruse', '允许超开倍率')}
                type="number"
                fullWidth
                value={formData.allowOveruse}
                onChange={(e) => setFormData({ ...formData, allowOveruse: parseFloat(e.target.value) || 0 })}
                inputProps={{ min: 0, step: 0.1 }}
                helperText={t('models.manager.allowOveruseHelper', '0表示不允许超开，1以上表示最大请求数*倍率')}
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