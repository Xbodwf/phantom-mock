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
} from '@mui/material';
import {
  Plus,
  Pencil,
  Trash2,
  DollarSign,
  Key,
  Link,
  Tag,
} from 'lucide-react';
import { useServer } from '../contexts/ServerContext';
import type { Model, ModelUpdateParams } from '../types';

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
  pricing_input: number;
  pricing_output: number;
  api_key: string;
  api_base_url: string;
  supported_features: string;
}

const defaultFormData: FormData = {
  id: '',
  owned_by: 'google',
  description: '',
  context_length: 1048576,
  aliases: '',
  max_output_tokens: 8192,
  pricing_input: 0,
  pricing_output: 0,
  api_key: '',
  api_base_url: '',
  supported_features: '',
};

export default function ModelManager() {
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
        pricing_input: model.pricing?.input || 0,
        pricing_output: model.pricing?.output || 0,
        api_key: model.api_key || '',
        api_base_url: model.api_base_url || '',
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
      pricing: formData.pricing_input > 0 || formData.pricing_output > 0 ? {
        input: formData.pricing_input,
        output: formData.pricing_output,
      } : undefined,
      api_key: formData.api_key || undefined,
      api_base_url: formData.api_base_url || undefined,
      supported_features: formData.supported_features ? formData.supported_features.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    };

    if (editingModel) {
      // 如果修改了ID，需要传递newId
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
    if (confirm(`确定要删除模型 "${id}" 吗？`)) {
      await deleteModel(id);
    }
  };

  const ownerColors: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'> = {
    google: 'primary',
    anthropic: 'secondary',
    deepseek: 'success',
    openai: 'info',
  };

  // 渲染模型价格标签 (预留功能)
  // const renderPricing = (model: Model) => {
  //   if (!model.pricing?.input && !model.pricing?.output) return '-';
  //   const parts = [];
  //   if (model.pricing.input) parts.push(`输入${model.pricing.input}/1K`);
  //   if (model.pricing.output) parts.push(`输出${model.pricing.output}/1K`);
  //   return parts.join(' | ');
  // };

  // 移动端卡片视图
  if (isMobile) {
    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            共 {models.length} 个模型
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<Plus size={18} />}
            onClick={() => handleOpenDialog()}
          >
            添加
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
                    <Chip size="small" label={`上下文: ${formatContextLength(model.context_length)}`} />
                    {model.max_output_tokens && (
                      <Chip size="small" label={`输出: ${formatContextLength(model.max_output_tokens)}`} />
                    )}
                    {model.api_key && (
                      <Chip size="small" icon={<Key size={14} />} label="已配置API Key" color="success" />
                    )}
                  </Stack>
                </CardContent>
                <CardActions sx={{ pt: 0 }}>
                  <Button
                    size="small"
                    startIcon={<Pencil size={16} />}
                    onClick={() => handleOpenDialog(model)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<Trash2 size={16} />}
                    onClick={() => handleDelete(model.id)}
                  >
                    删除
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
          <DialogTitle>{editingModel ? '编辑模型' : '添加模型'}</DialogTitle>
          <DialogContent>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
              <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="fullWidth">
                <Tab label="基本信息" />
                <Tab label="高级设置" />
              </Tabs>
            </Box>

            {activeTab === 0 && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="模型 ID"
                  fullWidth
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  placeholder="例如: gemini-2.5-flash"
                  size="small"
                />
                <TextField
                  label="提供商"
                  fullWidth
                  value={formData.owned_by}
                  onChange={(e) => setFormData({ ...formData, owned_by: e.target.value })}
                  placeholder="例如: google, anthropic"
                  size="small"
                />
                <TextField
                  label="描述"
                  fullWidth
                  multiline
                  minRows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="模型描述信息"
                  size="small"
                />
                <TextField
                  label="上下文长度"
                  fullWidth
                  value={formData.context_length}
                  onChange={(e) => setFormData({ ...formData, context_length: parseContextLength(e.target.value) })}
                  placeholder="例如: 1M, 128K, 4096"
                  helperText={`=${formatContextLength(formData.context_length)} tokens`}
                  size="small"
                />
                <TextField
                  label="最大输出Token"
                  fullWidth
                  value={formData.max_output_tokens}
                  onChange={(e) => setFormData({ ...formData, max_output_tokens: parseInt(e.target.value) || 8192 })}
                  placeholder="例如: 8192"
                  size="small"
                />
                <TextField
                  label="模型别名"
                  fullWidth
                  value={formData.aliases}
                  onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                  placeholder="用逗号分隔，例如: gpt-4, gpt4"
                  helperText="用户可以使用别名访问此模型"
                  size="small"
                />
              </Stack>
            )}

            {activeTab === 1 && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Alert severity="info" sx={{ mb: 1 }}>
                  以下为高级设置，可根据需要配置
                </Alert>
                
                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DollarSign size={16} /> 扣费规则（每1K token价格，美元）
                </Typography>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="输入价格 ($/1K tokens)"
                    type="number"
                    value={formData.pricing_input}
                    onChange={(e) => setFormData({ ...formData, pricing_input: parseFloat(e.target.value) || 0 })}
                    size="small"
                    inputProps={{ min: 0, step: 0.0001 }}
                  />
                  <TextField
                    label="输出价格 ($/1K tokens)"
                    type="number"
                    value={formData.pricing_output}
                    onChange={(e) => setFormData({ ...formData, pricing_output: parseFloat(e.target.value) || 0 })}
                    size="small"
                    inputProps={{ min: 0, step: 0.0001 }}
                  />
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Key size={16} /> API 配置（用于转发请求）
                </Typography>
                <TextField
                  label="API Key"
                  fullWidth
                  type="password"
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  placeholder="sk-..."
                  size="small"
                />
                <TextField
                  label="API Base URL"
                  fullWidth
                  value={formData.api_base_url}
                  onChange={(e) => setFormData({ ...formData, api_base_url: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  size="small"
                />

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Tag size={16} /> 支持的特性
                </Typography>
                <TextField
                  label="支持的特性"
                  fullWidth
                  value={formData.supported_features}
                  onChange={(e) => setFormData({ ...formData, supported_features: e.target.value })}
                  placeholder="chat, vision, function_calling"
                  helperText="用逗号分隔"
                  size="small"
                />
              </Stack>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseDialog}>取消</Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!formData.id.trim()}
            >
              {editingModel ? '保存' : '添加'}
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
          共 {models.length} 个模型
        </Typography>
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={() => handleOpenDialog()}
        >
          添加模型
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
              <TableCell>模型 ID</TableCell>
              <TableCell>提供商</TableCell>
              <TableCell>描述</TableCell>
              <TableCell align="right">上下文</TableCell>
              <TableCell align="right">输出限制</TableCell>
              <TableCell align="center">API配置</TableCell>
              <TableCell align="right">操作</TableCell>
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
                        <Tooltip title="已配置 API Key">
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
                      <Tooltip title="编辑">
                        <IconButton size="small" onClick={() => handleOpenDialog(model)}>
                          <Pencil size={16} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
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
        <DialogTitle>{editingModel ? '编辑模型' : '添加模型'}</DialogTitle>
        <DialogContent>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, mt: 1 }}>
            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
              <Tab label="基本信息" />
              <Tab label="高级设置" />
            </Tabs>
          </Box>

          {activeTab === 0 && (
            <Stack spacing={2}>
              <TextField
                label="模型 ID"
                fullWidth
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                placeholder="例如: gemini-2.5-flash"
              />
              <TextField
                label="提供商"
                fullWidth
                value={formData.owned_by}
                onChange={(e) => setFormData({ ...formData, owned_by: e.target.value })}
                placeholder="例如: google, anthropic"
              />
              <TextField
                label="描述"
                fullWidth
                multiline
                minRows={2}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="模型描述信息"
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="上下文长度"
                  fullWidth
                  value={formData.context_length}
                  onChange={(e) => setFormData({ ...formData, context_length: parseContextLength(e.target.value) })}
                  placeholder="例如: 1M, 128K, 4096"
                  helperText={`=${formatContextLength(formData.context_length)} tokens`}
                />
                <TextField
                  label="最大输出Token"
                  fullWidth
                  value={formData.max_output_tokens}
                  onChange={(e) => setFormData({ ...formData, max_output_tokens: parseInt(e.target.value) || 8192 })}
                  placeholder="例如: 8192"
                />
              </Stack>
              <TextField
                label="模型别名"
                fullWidth
                value={formData.aliases}
                onChange={(e) => setFormData({ ...formData, aliases: e.target.value })}
                placeholder="用逗号分隔，例如: gpt-4, gpt4"
                helperText="用户可以使用别名访问此模型"
              />
            </Stack>
          )}

          {activeTab === 1 && (
            <Stack spacing={2}>
              <Alert severity="info">
                以下为高级设置，可根据需要配置
              </Alert>
              
              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DollarSign size={16} /> 扣费规则（每1K token价格，美元）
              </Typography>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="输入价格 ($/1K tokens)"
                  type="number"
                  value={formData.pricing_input}
                  onChange={(e) => setFormData({ ...formData, pricing_input: parseFloat(e.target.value) || 0 })}
                  inputProps={{ min: 0, step: 0.0001 }}
                />
                <TextField
                  label="输出价格 ($/1K tokens)"
                  type="number"
                  value={formData.pricing_output}
                  onChange={(e) => setFormData({ ...formData, pricing_output: parseFloat(e.target.value) || 0 })}
                  inputProps={{ min: 0, step: 0.0001 }}
                />
              </Stack>

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Key size={16} /> API 配置（用于转发请求）
              </Typography>
              <TextField
                label="API Key"
                fullWidth
                type="password"
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                placeholder="sk-..."
              />
              <TextField
                label="API Base URL"
                fullWidth
                value={formData.api_base_url}
                onChange={(e) => setFormData({ ...formData, api_base_url: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />

              <Divider sx={{ my: 1 }} />

              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tag size={16} /> 支持的特性
              </Typography>
              <TextField
                label="支持的特性"
                fullWidth
                value={formData.supported_features}
                onChange={(e) => setFormData({ ...formData, supported_features: e.target.value })}
                placeholder="chat, vision, function_calling"
                helperText="用逗号分隔"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseDialog}>取消</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!formData.id.trim()}
          >
            {editingModel ? '保存' : '添加'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
