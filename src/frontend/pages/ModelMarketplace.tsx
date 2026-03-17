import { useState, useMemo } from 'react';
import {
  Box,
  Container,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Divider,
  Snackbar,
  InputAdornment,
} from '@mui/material';
import { Search, X } from 'lucide-react';
import { ModelCard } from '../components/ModelCard';
import { copyToClipboard } from '../utils/clipboard';
import type { Model } from '../../types.js';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../utils/currency';

interface ModelMarketplaceProps {
  models: Model[];
  onSelectModel?: (model: Model) => void;
}

export function ModelMarketplace({ models, onSelectModel }: ModelMarketplaceProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedFeature, setSelectedFeature] = useState<string>('all');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);

  // 获取唯一的提供商
  const providers = useMemo(() => {
    const unique = new Set(models.map(m => m.owned_by));
    return Array.from(unique).sort();
  }, [models]);

  // 获取所有分类
  const categories = useMemo(() => {
    const unique = new Set(models.map(m => m.category || 'other'));
    return Array.from(unique).sort();
  }, [models]);

  // 获取所有能力/特性
  const allFeatures = useMemo(() => {
    const features = new Set<string>();
    models.forEach(model => {
      model.supported_features?.forEach(f => features.add(f));
    });
    return Array.from(features).sort();
  }, [models]);

  // 过滤模型
  const filteredModels = useMemo(() => {
    return models.filter(model => {
      // 搜索过滤
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !model.id.toLowerCase().includes(query) &&
          !model.description?.toLowerCase().includes(query) &&
          !model.owned_by.toLowerCase().includes(query)
        ) {
          return false;
        }
      }

      // 分类过滤
      if (selectedCategory !== 'all' && (model.category || 'other') !== selectedCategory) {
        return false;
      }

      // 提供商过滤
      if (selectedProvider !== 'all' && model.owned_by !== selectedProvider) {
        return false;
      }

      // 能力过滤
      if (selectedFeature !== 'all') {
        if (!model.supported_features?.includes(selectedFeature)) {
          return false;
        }
      }

      // 价格过滤
      const inputPrice = model.pricing?.input || 0;
      if (inputPrice < priceRange[0] || inputPrice > priceRange[1]) {
        return false;
      }

      return true;
    });
  }, [models, searchQuery, selectedCategory, selectedProvider, selectedFeature, priceRange]);

  const handlePreview = (model: Model) => {
    setSelectedModel(model);
    setShowDetails(true);
  };

  const handleSelect = (model: Model) => {
    copyToClipboard(model.id)
      .then(() => setSnackbarOpen(true))
      .catch(() => console.warn('Failed to copy to clipboard'));

    if (onSelectModel) {
      onSelectModel(model);
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedProvider('all');
    setSelectedFeature('all');
    setPriceRange([0, 1]);
  };

  const hasActiveFilters = searchQuery || selectedCategory !== 'all' || selectedProvider !== 'all' || selectedFeature !== 'all';

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* 标题 */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          {t('models.title')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('models.subtitle', { count: models.length })}
        </Typography>
      </Box>

      {/* 搜索和过滤 */}
      <Box sx={{ mb: 4 }}>
        <Stack spacing={2}>
          {/* 搜索框 */}
          <TextField
            fullWidth
            placeholder={t('models.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={20} />
                </InputAdornment>
              ),
            }}
          />

          {/* 筛选按钮和清除按钮 */}
          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="outlined"
              onClick={() => setFilterDialogOpen(true)}
            >
              {t('models.filter')}
            </Button>
            {hasActiveFilters && (
              <Button
                variant="outlined"
                startIcon={<X size={16} />}
                onClick={handleClearFilters}
              >
                {t('models.clearFilters')}
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      {/* 结果计数 */}
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        {t('models.showing', { count: filteredModels.length, total: models.length })}
      </Typography>

      {/* 模型网格 */}
      {filteredModels.length > 0 ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 3 }}>
          {filteredModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              onSelect={handleSelect}
              onPreview={handlePreview}
            />
          ))}
        </Box>
      ) : (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            color: 'text.secondary',
          }}
        >
          <Typography variant="h6">{t('models.noModels')}</Typography>
          <Typography variant="body2">{t('models.tryAdjust')}</Typography>
        </Box>
      )}

      {/* 模型详情对话框 */}
      <Dialog open={showDetails} onClose={() => setShowDetails(false)} maxWidth="sm" fullWidth>
        {selectedModel && (
          <>
            <DialogTitle>{selectedModel.id}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 2 }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {t('models.details.provider')}
                  </Typography>
                  <Typography variant="body2">{selectedModel.owned_by}</Typography>
                </Box>

                <Divider />

                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {t('models.details.description')}
                  </Typography>
                  <Typography variant="body2">{selectedModel.description || t('models.noDescription')}</Typography>
                </Box>

                {selectedModel.pricing && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                        {t('models.details.pricing')}
                      </Typography>
                      <Stack spacing={0.5}>
                        {selectedModel.pricing.input && (
                          <Typography variant="body2">
                            {t('models.details.input')}: {formatCurrency(selectedModel.pricing.input)}/{selectedModel.pricing.unit || 'K'} {t('models.details.tokens')}
                          </Typography>
                        )}
                        {selectedModel.pricing.output && (
                          <Typography variant="body2">
                            {t('models.details.output')}: {formatCurrency(selectedModel.pricing.output)}/{selectedModel.pricing.unit || 'K'} {t('models.details.tokens')}
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  </>
                )}

                {selectedModel.supported_features && selectedModel.supported_features.length > 0 && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                        {t('models.details.features')}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {selectedModel.supported_features.map((feature) => (
                          <Chip key={feature} label={feature} size="small" />
                        ))}
                      </Box>
                    </Box>
                  </>
                )}

                {selectedModel.context_length && (
                  <>
                    <Divider />
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {t('models.details.contextLength')}
                      </Typography>
                      <Typography variant="body2">
                        {(selectedModel.context_length / 1000000).toFixed(1)}M {t('models.details.tokens')}
                      </Typography>
                    </Box>
                  </>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setShowDetails(false)}>{t('common.close')}</Button>
              <Button
                variant="contained"
                onClick={() => {
                  handleSelect(selectedModel);
                  setShowDetails(false);
                }}
              >
                {t('models.selectModel')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* 复制成功提示 */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={() => setSnackbarOpen(false)}
        message={t('models.copiedToClipboard')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      {/* 筛选对话框 */}
      <Dialog open={filterDialogOpen} onClose={() => setFilterDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('models.filter')}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            {/* 分类 */}
            <FormControl fullWidth>
              <InputLabel>{t('models.category')}</InputLabel>
              <Select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                label={t('models.category')}
              >
                <MenuItem value="all">{t('models.allCategories')}</MenuItem>
                {categories.map((cat) => (
                  <MenuItem key={cat} value={cat}>
                    {cat}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* 提供商 */}
            <FormControl fullWidth>
              <InputLabel>{t('models.provider')}</InputLabel>
              <Select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                label={t('models.provider')}
              >
                <MenuItem value="all">{t('models.allProviders')}</MenuItem>
                {providers.map((provider) => (
                  <MenuItem key={provider} value={provider}>
                    {provider}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* 能力/特性 */}
            <FormControl fullWidth>
              <InputLabel>{t('models.feature')}</InputLabel>
              <Select
                value={selectedFeature}
                onChange={(e) => setSelectedFeature(e.target.value)}
                label={t('models.feature')}
              >
                <MenuItem value="all">{t('models.allFeatures')}</MenuItem>
                {allFeatures.map((feature) => (
                  <MenuItem key={feature} value={feature}>
                    {feature}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* 价格范围 */}
            <FormControl fullWidth>
              <InputLabel>{t('models.priceRange')}</InputLabel>
              <Select
                value={`${priceRange[0]}-${priceRange[1]}`}
                onChange={(e) => {
                  const [min, max] = e.target.value.split('-').map(Number);
                  setPriceRange([min, max]);
                }}
                label={t('models.priceRange')}
              >
                <MenuItem value="0-1">{t('models.allPrices')}</MenuItem>
                <MenuItem value="0-0.1">Free - 🔮0.1</MenuItem>
                <MenuItem value="0.1-0.5">🔮0.1 - 🔮0.5</MenuItem>
                <MenuItem value="0.5-1">🔮0.5 - 🔮1</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFilterDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => setFilterDialogOpen(false)}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
