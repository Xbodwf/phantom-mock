import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  TextField,
  Button,
  Stack,
  Typography,
  Alert,
  Paper,
  IconButton,
  Tabs,
  Tab,
  Divider,
} from '@mui/material';
import { ArrowLeft, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { CodeEditor } from '../components/CodeEditor';
import { DEFAULT_ACTION_CODE } from '../constants/actionTemplates';
import { injectMetadata, mergeMetadata } from '../utils/actionCodeUtils';
import axios from 'axios';

interface ActionMetadata {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  tags?: string[];
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  models?: Record<string, any>;
  schema?: Record<string, any>;
  config?: Record<string, any>;
}

export function ActionEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [action, setAction] = useState({
    name: '',
    description: '',
    code: DEFAULT_ACTION_CODE,
  });
  const [metadata, setMetadata] = useState<ActionMetadata>({});

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }

    if (id && id !== 'new') {
      fetchAction();
    } else {
      // 新建时，从代码中提取元数据
      extractMetadata(DEFAULT_ACTION_CODE);
    }
  }, [id, user, token, navigate]);

  const fetchAction = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/actions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAction({
        name: response.data.name,
        description: response.data.description || '',
        code: response.data.code,
      });
      extractMetadata(response.data.code);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load action');
    } finally {
      setLoading(false);
    }
  };

  const extractMetadata = (code: string) => {
    try {
      // 调用后端 API 来验证代码并提取 metadata
      axios.post('/api/actions/validate', { code }, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(response => {
        if (response.data.metadata) {
          setMetadata(response.data.metadata);
        }
      }).catch(err => {
        console.error('Failed to extract metadata:', err);
      });
    } catch (err) {
      console.error('Failed to extract metadata:', err);
    }
  };

  const handleCodeChange = (value: string | undefined) => {
    setAction({ ...action, code: value || '' });
    extractMetadata(value || '');
  };

  const handleMetadataChange = (key: string, value: any) => {
    setMetadata({ ...metadata, [key]: value });
  };

  const handleSave = async () => {
    if (!action.name.trim() || !action.code.trim()) {
      setError(t('actions.nameAndCodeRequired'));
      return;
    }

    try {
      setLoading(true);
      setError('');

      // 先验证代码并获取代码中的 metadata
      const validationResponse = await axios.post('/api/actions/validate', { code: action.code }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!validationResponse.data.valid) {
        setError(validationResponse.data.details || 'Code validation failed');
        setLoading(false);
        return;
      }

      // 获取代码中的 metadata
      const codeMetadata = validationResponse.data.metadata || {};

      // 合并：用户在 Inspector 中的修改会覆盖代码中的 metadata
      const mergedMetadata = mergeMetadata(codeMetadata, metadata);

      // 将合并后的 metadata 注入到代码中
      const updatedCode = injectMetadata(action.code, mergedMetadata);

      const actionToSave = {
        ...action,
        code: updatedCode,
      };

      if (id && id !== 'new') {
        await axios.put(
          `/api/actions/${id}`,
          actionToSave,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } else {
        await axios.post(
          '/api/actions',
          actionToSave,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/actions');
      }, 1000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save action');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return <LoadingSpinner />;
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          py: 2,
          px: 3,
        }}
      >
        <Container maxWidth="xl">
          <Stack direction="row" alignItems="center" spacing={2}>
            <IconButton onClick={() => navigate('/actions')} size="small">
              <ArrowLeft size={20} />
            </IconButton>
            <Typography variant="h6" sx={{ flex: 1 }}>
              {id && id !== 'new' ? t('actions.editAction') : t('actions.createAction')}
            </Typography>
            <Button
              variant="contained"
              startIcon={<Save size={18} />}
              onClick={handleSave}
              disabled={loading}
            >
              {t('common.save')}
            </Button>
          </Stack>
        </Container>
      </Paper>

      {/* Tabs */}
      <Paper elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Container maxWidth="xl">
          <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
            <Tab label={t('actions.code')} />
            <Tab label={t('actions.metadata')} />
            <Tab label={t('actions.documentation')} />
          </Tabs>
        </Container>
      </Paper>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 3 }}>
        <Container maxWidth="xl">
          <Stack spacing={3}>
            {error && (
              <Alert severity="error" onClose={() => setError('')}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success">
                {t('actions.savedSuccessfully')}
              </Alert>
            )}

            {/* Code Tab */}
            {tabValue === 0 && (
              <Stack spacing={3}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label={t('actions.name')}
                    value={action.name}
                    onChange={(e) => setAction({ ...action, name: e.target.value })}
                    fullWidth
                    required
                  />
                  <TextField
                    label={t('actions.description')}
                    value={action.description}
                    onChange={(e) => setAction({ ...action, description: e.target.value })}
                    fullWidth
                  />
                </Stack>

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('actions.code')} *
                  </Typography>
                  <Paper
                    variant="outlined"
                    sx={{
                      height: 'calc(100vh - 350px)',
                      minHeight: 400,
                      overflow: 'hidden',
                    }}
                  >
                    <CodeEditor
                      value={action.code}
                      onChange={handleCodeChange}
                      language="typescript"
                      height="100%"
                    />
                  </Paper>
                </Box>
              </Stack>
            )}

            {/* Metadata Tab */}
            {tabValue === 1 && (
              <Stack spacing={3}>
                <Typography variant="h6">{t('actions.inspector')}</Typography>
                <Divider />

                {/* Basic Metadata Fields */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {t('common.name')}
                  </Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2 }}>
                    <Box sx={{ gridColumn: "span 1" }}>
                      <TextField
                        label={t('actions.name')}
                        value={metadata.name || ''}
                        onChange={(e) => handleMetadataChange('name', e.target.value)}
                        fullWidth
                        size="small"
                      />
                    </Box>
                    <Box sx={{ gridColumn: "span 1" }}>
                      <TextField
                        label={t('actions.version')}
                        value={metadata.version || ''}
                        onChange={(e) => handleMetadataChange('version', e.target.value)}
                        fullWidth
                        size="small"
                      />
                    </Box>
                    <Box sx={{ gridColumn: "span 1" }}>
                      <TextField
                        label={t('actions.author')}
                        value={metadata.author || ''}
                        onChange={(e) => handleMetadataChange('author', e.target.value)}
                        fullWidth
                        size="small"
                      />
                    </Box>
                    <Box sx={{ gridColumn: "span 1" }}>
                      <TextField
                        label={t('actions.category')}
                        value={metadata.category || ''}
                        onChange={(e) => handleMetadataChange('category', e.target.value)}
                        fullWidth
                        size="small"
                      />
                    </Box>
                    <Box>
                      <TextField
                        label={t('actions.description')}
                        value={metadata.description || ''}
                        onChange={(e) => handleMetadataChange('description', e.target.value)}
                        fullWidth
                        multiline
                        rows={3}
                        size="small"
                      />
                    </Box>
                    <Box>
                      <TextField
                        label={t('actions.tags')}
                        value={Array.isArray(metadata.tags) ? metadata.tags.join(', ') : ''}
                        onChange={(e) =>
                          handleMetadataChange('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))
                        }
                        fullWidth
                        size="small"
                        helperText={t('actions.commaSeparatedTags')}
                      />
                    </Box>
                  </Box>
                </Box>

                {/* Dynamic Configuration Fields from Schema */}
                {metadata.schema && Object.keys(metadata.schema).length > 0 && (
                  <Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                      {t('actions.config')}
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2 }}>
                      {Object.entries(metadata.schema).map(([key, fieldSchema]: [string, any]) => {
                        const currentValue = metadata.config?.[key];

                        // Handle object type (nested properties)
                        if (fieldSchema.type === 'object' && fieldSchema.properties) {
                          return (
                            <Box key={key} sx={{ gridColumn: 'span 1' }}>
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
                                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                                  {fieldSchema.label || key}
                                </Typography>
                                {fieldSchema.description && (
                                  <Typography variant="caption" sx={{ display: 'block', mb: 2, color: 'text.secondary' }}>
                                    {fieldSchema.description}
                                  </Typography>
                                )}
                                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 2 }}>
                                  {Object.entries(fieldSchema.properties).map(([propKey, propSchema]: [string, any]) => (
                                    <Box key={propKey}>
                                      <TextField
                                        label={propSchema.label || propKey}
                                        value={currentValue?.[propKey] || propSchema.default || ''}
                                        onChange={(e) => {
                                          const newConfig = { ...metadata.config };
                                          if (!newConfig[key]) newConfig[key] = {};
                                          newConfig[key][propKey] = e.target.value;
                                          handleMetadataChange('config', newConfig);
                                        }}
                                        fullWidth
                                        size="small"
                                        helperText={propSchema.description}
                                      />
                                    </Box>
                                  ))}
                                </Box>
                              </Box>
                            </Box>
                          );
                        }

                        // Handle number type
                        if (fieldSchema.type === 'number') {
                          return (
                            <Box key={key}>
                              <TextField
                                label={fieldSchema.label || key}
                                type="number"
                                value={currentValue ?? fieldSchema.default ?? ''}
                                onChange={(e) => {
                                  const newConfig = { ...metadata.config };
                                  newConfig[key] = parseFloat(e.target.value);
                                  handleMetadataChange('config', newConfig);
                                }}
                                fullWidth
                                size="small"
                                helperText={fieldSchema.description}
                                inputProps={{
                                  min: fieldSchema.min,
                                  max: fieldSchema.max,
                                  step: fieldSchema.step,
                                }}
                              />
                            </Box>
                          );
                        }

                        // Handle string type
                        if (fieldSchema.type === 'string') {
                          return (
                            <Box key={key}>
                              <TextField
                                label={fieldSchema.label || key}
                                value={currentValue ?? fieldSchema.default ?? ''}
                                onChange={(e) => {
                                  const newConfig = { ...metadata.config };
                                  newConfig[key] = e.target.value;
                                  handleMetadataChange('config', newConfig);
                                }}
                                fullWidth
                                size="small"
                                helperText={fieldSchema.description}
                              />
                            </Box>
                          );
                        }

                        // Handle boolean type
                        if (fieldSchema.type === 'boolean') {
                          return (
                            <Box key={key}>
                              <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                                <Typography variant="body2" sx={{ mr: 2 }}>
                                  {fieldSchema.label || key}
                                </Typography>
                                <input
                                  type="checkbox"
                                  checked={currentValue ?? fieldSchema.default ?? false}
                                  onChange={(e) => {
                                    const newConfig = { ...metadata.config };
                                    newConfig[key] = e.target.checked;
                                    handleMetadataChange('config', newConfig);
                                  }}
                                />
                              </Box>
                            </Box>
                          );
                        }

                        return null;
                      })}
                    </Box>
                  </Box>
                )}

                {/* Inputs Configuration (Read-only) */}
                {metadata.inputs && (
                  <Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                      {t('actions.inputs')}
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                      <pre style={{ fontSize: '12px', overflow: 'auto', margin: 0 }}>
                        {JSON.stringify(metadata.inputs, null, 2)}
                      </pre>
                    </Paper>
                  </Box>
                )}

                {/* Outputs Configuration (Read-only) */}
                {metadata.outputs && (
                  <Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                      {t('actions.outputs')}
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                      <pre style={{ fontSize: '12px', overflow: 'auto', margin: 0 }}>
                        {JSON.stringify(metadata.outputs, null, 2)}
                      </pre>
                    </Paper>
                  </Box>
                )}
              </Stack>
            )}

            {/* Documentation Tab */}
            {tabValue === 2 && (
              <Stack spacing={3}>
                <Typography variant="h6">{t('actions.sandboxDocumentation')}</Typography>
                <Divider />

                <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1, overflow: 'auto', maxHeight: '600px' }}>
                  <Typography variant="body2" component="pre" sx={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {`# Action 沙箱接口文档

## 内置函数

### callChatCompletion(params)
调用 Chat Completion API

参数:
- model: string - 模型名称
- messages: Array<{role: string, content: string}> - 消息列表
- temperature?: number - 温度参数 (0-2)
- max_tokens?: number - 最大令牌数
- top_p?: number - Top P 采样参数

返回: Promise<string> - 模型的响应文本

示例:
const response = await callChatCompletion({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7
});

## 全局对象

- console: 标准控制台对象 (log, error, warn, info)
- JSON: JSON 序列化和反序列化
- Math: 数学函数和常数
- Date: 日期和时间
- Array, Object, String, Number, Boolean: 标准 JavaScript 类型
- Promise: 异步操作支持
- setTimeout, setInterval: 定时器函数

## 元数据对象

### metadata
包含 Action 的配置信息:
- name: string - Action 名称
- description: string - 描述
- version: string - 版本
- author: string - 作者
- category: string - 分类
- tags: string[] - 标签
- schema: object - 配置 schema
- config: object - 当前配置值
- inputs: object - 输入定义
- outputs: object - 输出定义

## 导出函数

### onInit(config)
Action 初始化函数，在首次加载时调用

### onConfigChange(config)
配置变更函数，当配置在 Inspector 中被修改时调用

### execute(input)
Action 主执行函数，处理输入并返回输出`}
                  </Typography>
                </Box>
              </Stack>
            )}
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
