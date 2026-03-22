import { useState, useMemo, useEffect } from 'react';
import {
  Box,
  Container,
  TextField,
  Stack,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Divider,
  Snackbar,
  InputAdornment,
  Card,
  CardContent,
  Chip,
  Alert,
  Tabs,
  Tab,
} from '@mui/material';
import { Search, Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import type { Action } from '../../types.js';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import axios from 'axios';

interface ActionMarketplaceProps {
  onSelectAction?: (action: Action) => void;
}

// 从 metadata 中提取参数定义
function extractMetadataFromCode(code: string): any {
  try {
    // 匹配 export const metadata = { ... };
    const metadataMatch = code.match(/export\s+const\s+metadata\s*=\s*(\{[\s\S]*?\n\});/);
    if (metadataMatch) {
      const metadataStr = metadataMatch[1];
      // 使用 Function 构造器安全地解析对象
      const metadataObj = new Function(`return ${metadataStr}`)();
      return metadataObj;
    }
    return null;
  } catch (error) {
    console.error('Failed to extract metadata:', error);
    return null;
  }
}

// 从 metadata 或 JSDoc 注释中提取参数定义
function extractParametersFromCode(code: string): Array<{
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
}> {
  // 首先尝试从 metadata.inputs 中提取
  const metadata = extractMetadataFromCode(code);
  if (metadata?.inputs && typeof metadata.inputs === 'object') {
    return Object.entries(metadata.inputs).map(([name, input]: [string, any]) => ({
      name,
      type: input.type || 'string',
      required: input.required ?? true,
      description: input.description,
    }));
  }

  // 回退：从 JSDoc 注释中的 @param 标签提取
  const params: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    description?: string;
  }> = [];

  const paramRegex = /@param\s+\{(\w+)\}\s+(\w+)\s*-?\s*(.*?)(?=@|\*\/|$)/gs;
  let match;
  while ((match = paramRegex.exec(code)) !== null) {
    const type = match[1].toLowerCase() as 'string' | 'number' | 'boolean' | 'object' | 'array';
    const name = match[2];
    const description = match[3].trim();
    params.push({
      name,
      type: ['string', 'number', 'boolean', 'object', 'array'].includes(type) ? type : 'string',
      required: !description.includes('optional'),
      description: description || undefined,
    });
  }

  return params;
}

// 从 metadata 或代码中提取完整信息
function extractActionInfo(code: string): {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  tags?: string[];
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  schema?: Record<string, any>;
  config?: Record<string, any>;
} | null {
  return extractMetadataFromCode(code);
}

export function ActionMarketplace({ onSelectAction }: ActionMarketplaceProps) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailsTab, setDetailsTab] = useState(0);

  useEffect(() => {
    fetchPublicActions();
  }, [token]);

  const fetchPublicActions = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/v1/actions/models', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // 只获取公开的 actions
      const publicActions = (Array.isArray(response.data) ? response.data : response.data.actions || [])
        .filter((a: Action) => a.isPublic);
      setActions(publicActions);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  };

  // 过滤公开的 Actions
  const filteredActions = useMemo(() => {
    if (!searchQuery) return actions;

    const query = searchQuery.toLowerCase();
    return actions.filter(action => {
      return (
        action.name.toLowerCase().includes(query) ||
        action.description?.toLowerCase().includes(query) ||
        action.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    });
  }, [actions, searchQuery]);

  const handleSelectAction = (action: Action) => {
    setSelectedAction(action);
    setShowDetails(true);
  };

  const handleCopyId = async (id: string) => {
    try {
      await copyToClipboard(id);
      setCopiedId(id);
      setSnackbarOpen(true);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleConfirmSelect = () => {
    if (selectedAction && onSelectAction) {
      onSelectAction(selectedAction);
      setShowDetails(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          {t('actionMarketplace.title', 'Action Marketplace')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('actionMarketplace.description', 'Discover and use public actions created by the community')}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* 搜索栏 */}
          <Box sx={{ mb: 4 }}>
            <TextField
              fullWidth
              placeholder={t('actionMarketplace.search', 'Search actions...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={20} />
                  </InputAdornment>
                ),
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />
          </Box>

          {/* Actions 网格 */}
          {filteredActions.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                {searchQuery
                  ? t('actionMarketplace.noResults', 'No actions found matching your search')
                  : t('actionMarketplace.empty', 'No public actions available yet')}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 3 }}>
              {filteredActions.map((action) => (
                <Box key={action.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        boxShadow: 4,
                        transform: 'translateY(-4px)',
                      },
                    }}
                    onClick={() => handleSelectAction(action)}
                  >
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                        {action.id}
                      </Typography>

                      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2, minHeight: 40 }}>
                        {action.description}
                      </Typography>

                      {/* Tags */}
                      {action.tags && action.tags.length > 0 && (
                        <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          {action.tags.slice(0, 3).map((tag) => (
                            <Chip key={tag} label={tag} size="small" variant="outlined" />
                          ))}
                          {action.tags.length > 3 && (
                            <Chip label={`+${action.tags.length - 3}`} size="small" variant="outlined" />
                          )}
                        </Box>
                      )}

                      {/* Stats */}
                      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        {action.usageCount !== undefined && (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {t('actionMarketplace.usageCount', 'Used {{count}} times', {
                              count: action.usageCount,
                            })}
                          </Typography>
                        )}
                        {action.rating !== undefined && (
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            ⭐ {action.rating.toFixed(1)}
                          </Typography>
                        )}
                      </Box>
                    </CardContent>

                    <Divider />

                    <Box sx={{ p: 2 }}>
                      <Button
                        fullWidth
                        variant="contained"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectAction(action);
                        }}
                      >
                        {t('actionMarketplace.viewDetails', 'View Details')}
                      </Button>
                    </Box>
                  </Card>
                </Box>
              ))}
            </Box>
          )}
        </>
      )}

      {/* 详情对话框 */}
      <Dialog open={showDetails} onClose={() => { setShowDetails(false); setDetailsTab(0); }} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">{selectedAction?.id}</Typography>
          </Box>
        </DialogTitle>

        <Tabs value={detailsTab} onChange={(_, newValue) => setDetailsTab(newValue)} sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tab label={t('actionMarketplace.overview', 'Overview')} />
          <Tab label={t('actionMarketplace.inspector', 'Inspector')} />
          <Tab label={t('actionMarketplace.code', 'Code')} />
        </Tabs>

        <DialogContent sx={{ pt: 2 }}>
          {/* 概览标签页 */}
          {detailsTab === 0 && (() => {
            const metadata = selectedAction?.code ? extractMetadataFromCode(selectedAction.code) : null;
            return (
              <Stack spacing={2}>
                {/* Metadata 信息 */}
                {metadata && (
                  <>
                    {metadata.name && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                          {t('actionMarketplace.name', 'Name')}
                        </Typography>
                        <Typography variant="body2">{metadata.name}</Typography>
                      </Box>
                    )}

                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                        {t('actionMarketplace.description', 'Description')}
                      </Typography>
                      <Typography variant="body2">{metadata?.description || selectedAction?.description}</Typography>
                    </Box>

                    {metadata.version && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                          {t('actionMarketplace.version', 'Version')}
                        </Typography>
                        <Typography variant="body2">{metadata.version}</Typography>
                      </Box>
                    )}

                    {metadata.author && (
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                          {t('actionMarketplace.author', 'Author')}
                        </Typography>
                        <Typography variant="body2">{metadata.author}</Typography>
                      </Box>
                    )}
                  </>
                )}

                {!metadata && selectedAction?.description && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      {t('actionMarketplace.description', 'Description')}
                    </Typography>
                    <Typography variant="body2">{selectedAction.description}</Typography>
                  </Box>
                )}

                {(selectedAction?.tags || metadata?.tags) && (selectedAction?.tags?.length || metadata?.tags?.length) > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      {t('actionMarketplace.tags', 'Tags')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {(selectedAction?.tags || metadata?.tags || []).map((tag: string) => (
                        <Chip key={tag} label={tag} size="small" />
                      ))}
                    </Box>
                  </Box>
                )}

                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    {t('actionMarketplace.actionId', 'Action ID')}
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1.5,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      fontFamily: 'monospace',
                      fontSize: '0.875rem',
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {selectedAction?.id}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => selectedAction && handleCopyId(selectedAction.id)}
                      startIcon={copiedId === selectedAction?.id ? <Check size={16} /> : <Copy size={16} />}
                      sx={{ minWidth: 'auto' }}
                    >
                      {copiedId === selectedAction?.id ? 'Copied' : 'Copy'}
                    </Button>
                  </Box>
                </Box>

                {selectedAction?.usageCount !== undefined && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      {t('actionMarketplace.stats', 'Statistics')}
                    </Typography>
                    <Typography variant="body2">
                      {t('actionMarketplace.usageCount', 'Used {{count}} times', {
                        count: selectedAction.usageCount,
                      })}
                    </Typography>
                  </Box>
                )}
              </Stack>
            );
          })()}

          {/* 参数标签页 */}
          {detailsTab === 1 && (() => {
            const metadata = selectedAction?.code ? extractMetadataFromCode(selectedAction.code) : null;
            const config = metadata?.config;
            const inputs = metadata?.inputs;
            const outputs = metadata?.outputs;
            const hasConfig = config && Object.keys(config).length > 0;
            const hasInputs = inputs && Object.keys(inputs).length > 0;
            const hasOutputs = outputs && Object.keys(outputs).length > 0;

            const renderFieldList = (fields: Record<string, any>, title: string) => (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                  {title}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
                  {Object.entries(fields).map(([name, field]: [string, any]) => (
                    <Box
                      key={name}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 2,
                        bgcolor: 'background.paper',
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {name}
                        </Typography>
                        <Chip
                          label={field.type || 'any'}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                      {field.description && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                          {field.description}
                        </Typography>
                      )}
                      <Chip
                        label={field.required ? 'Required' : 'Optional'}
                        size="small"
                        color={field.required ? 'error' : 'default'}
                        variant="outlined"
                      />
                    </Box>
                  ))}
                </Box>
              </Box>
            );

            return (
              <Stack spacing={3}>
                {/* Config - 检查器配置 */}
                {hasConfig && renderFieldList(config, t('actionMarketplace.config', 'Config (Inspector Settings)'))}

                {/* Inputs - 输入格式 */}
                {hasInputs && renderFieldList(inputs, t('actionMarketplace.inputs', 'Inputs (Input Format)'))}

                {/* Outputs - 输出格式 */}
                {hasOutputs && renderFieldList(outputs, t('actionMarketplace.outputs', 'Outputs (Output Format)'))}

                {!hasConfig && !hasInputs && !hasOutputs && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('actionMarketplace.noMetadata', 'No config, inputs, or outputs defined in metadata')}
                  </Typography>
                )}
              </Stack>
            );
          })()}

          {/* 代码标签页 */}
          {detailsTab === 2 && (
            <Box
              sx={{
                bgcolor: '#f5f5f5',
                p: 2,
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                overflow: 'auto',
                maxHeight: 400,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <Typography
                component="pre"
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  margin: 0,
                  color: '#333',
                }}
              >
                {selectedAction?.code || 'No code available'}
              </Typography>
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={() => { setShowDetails(false); setDetailsTab(0); }}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" onClick={handleConfirmSelect}>
            {t('actionMarketplace.select', 'Select')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={() => setSnackbarOpen(false)}
        message={t('common.copied', 'Copied to clipboard')}
      />
    </Container>
  );
}
