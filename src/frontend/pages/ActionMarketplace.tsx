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

  const handleCopyId = (id: string) => {
    copyToClipboard(id);
    setCopiedId(id);
    setSnackbarOpen(true);
    setTimeout(() => setCopiedId(null), 2000);
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
                        {action.name}
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
      <Dialog open={showDetails} onClose={() => setShowDetails(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">{selectedAction?.name}</Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('actionMarketplace.description', 'Description')}
              </Typography>
              <Typography variant="body2">{selectedAction?.description}</Typography>
            </Box>

            {selectedAction?.tags && selectedAction.tags.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t('actionMarketplace.tags', 'Tags')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {selectedAction.tags.map((tag) => (
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
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setShowDetails(false)}>
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
