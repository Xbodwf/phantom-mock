import {
  Card,
  CardContent,
  CardActions,
  Box,
  Typography,
  Chip,
  Button,
  Stack,
} from '@mui/material';
import { Zap, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Model } from '../../types.js';
import { formatCurrency } from '../utils/currency';

interface ModelCardProps {
  model: Model;
  onSelect?: (model: Model) => void;
  onPreview?: (model: Model) => void;
}

export function ModelCard({ model, onSelect, onPreview }: ModelCardProps) {
  const { t } = useTranslation();

  const formatPrice = (price?: number, unit?: string, type?: string) => {
    if (!price) return t('models.free');
    if (type === 'request') {
      return `${formatCurrency(price)}/request`;
    }
    const unitLabel = unit === 'M' ? '/M tokens' : '/K tokens';
    return `${formatCurrency(price)}${unitLabel}`;
  };

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'all 0.3s ease',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 3,
        },
      }}
    >
      <CardContent sx={{ flex: 1 }}>
        {/* 模型名称和标签 */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {model.id}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('models.by')} {model.owned_by}
            </Typography>
          </Box>
          {model.isComposite && (
            <Chip
              icon={<Zap size={14} />}
              label={t('models.composite')}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
        </Box>

        {/* 描述 */}
        <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary', minHeight: 40 }}>
          {model.description || t('models.noDescription')}
        </Typography>

        {/* 特性标签 */}
        {model.supported_features && model.supported_features.length > 0 && (
          <Box sx={{ mb: 2, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {model.supported_features.map((feature) => (
              <Chip key={feature} label={feature} size="small" variant="outlined" />
            ))}
          </Box>
        )}

        {/* 模型标签 */}
        {model.tags && model.tags.length > 0 && (
          <Box sx={{ mb: 2, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {model.tags.slice(0, 3).map((tag) => (
              <Chip key={tag} label={tag} size="small" />
            ))}
          </Box>
        )}

        {/* 价格信息 */}
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          {model.pricing?.type === 'request' && model.pricing?.perRequest ? (
            <Typography variant="caption">
              {t('models.details.pricing')}: {formatPrice(model.pricing.perRequest, undefined, 'request')}
            </Typography>
          ) : (
            <>
              {model.pricing?.input && (
                <Typography variant="caption">
                  {t('models.details.input')}: {formatPrice(model.pricing.input, model.pricing.unit)}
                </Typography>
              )}
              {model.pricing?.output && (
                <Typography variant="caption">
                  {t('models.details.output')}: {formatPrice(model.pricing.output, model.pricing.unit)}
                </Typography>
              )}
            </>
          )}
        </Stack>

        {/* 上下文长度 */}
        {model.context_length && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('models.context')}: {(model.context_length / 1000).toFixed(0)}K {t('models.details.tokens')}
          </Typography>
        )}
      </CardContent>

      <CardActions sx={{ pt: 0 }}>
        {onPreview && (
          <Button
            size="small"
            startIcon={<Eye size={16} />}
            onClick={() => onPreview(model)}
          >
            {t('models.preview')}
          </Button>
        )}
        {onSelect && (
          <Button
            size="small"
            variant="contained"
            onClick={() => onSelect(model)}
            sx={{ ml: 'auto' }}
          >
            {t('models.select')}
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
