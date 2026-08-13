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

// 获取模型名称的首字母缩写
function getModelInitials(modelId: string): string {
  // 移除常见前缀和特殊字符
  const cleanedId = modelId.replace(/^(gpt-|claude-|gemini-|deepseek-|llama-)/i, '');
  
  // 分割单词
  const words = cleanedId.split(/[-_]/);
  
  if (words.length >= 2) {
    // 取前两个单词的首字母
    return words.slice(0, 2).map(word => word.charAt(0).toUpperCase()).join('');
  } else if (cleanedId.length >= 2) {
    // 取前两个字符
    return cleanedId.substring(0, 2).toUpperCase();
  } else {
    // 返回单个字符
    return cleanedId.charAt(0).toUpperCase();
  }
}

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
        {/* 模型图标和名称 */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2 }}>
          {model.icon ? (
            <Box
              component="img"
              src={model.icon}
              alt={model.id}
              sx={{
                width: 48,
                height: 48,
                borderRadius: 1,
                backgroundColor: '#ffffff',
                padding: 0.5,
                flexShrink: 0,
                objectFit: 'contain',
              }}
            />
          ) : (
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#ffffff',
                fontSize: '1.2rem',
                fontWeight: 700,
                boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
              }}
            >
              {getModelInitials(model.id)}
            </Box>
          )}
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
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
          </Box>
        </Box>

        {/* 描述 */}
        <Typography 
          variant="body2" 
          sx={{ 
            mb: 2, 
            color: 'text.secondary', 
            minHeight: 60,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            lineHeight: 1.5,
          }}
        >
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
          ) : model.pricing?.type === 'tiered' && model.pricing?.tieredPricing ? (
            <>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t('models.tieredPricing', '阶梯计费')} ({model.pricing.tieredPricing.baseOn === 'total' ? t('models.tieredBaseTotal', '总Token') : model.pricing.tieredPricing.baseOn === 'input' ? t('models.tieredBaseInput', '输入Token') : t('models.tieredBaseOutput', '输出Token')})
              </Typography>
              {model.pricing.tieredPricing.tiers.slice(0, 3).map((tier, index) => (
                <Typography key={index} variant="caption" color="text.secondary">
                  {tier.min.toLocaleString()}-{tier.max ? tier.max.toLocaleString() : '∞'}: {tier.pricePerToken !== undefined
                    ? `${formatCurrency(tier.pricePerToken)}/K tokens`
                    : `in x${tier.inputMultiplier ?? 1}, out x${tier.outputMultiplier ?? 1}`}
                </Typography>
              ))}
              {model.pricing.tieredPricing.tiers.length > 3 && (
                <Typography variant="caption" color="text.secondary">
                  +{model.pricing.tieredPricing.tiers.length - 3} {t('models.moreTiers', '更多阶梯')}
                </Typography>
              )}
            </>
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
              {model.pricing?.cacheRead ? (
                <Typography variant="caption">
                  {t('models.details.cacheRead')}: {formatPrice(model.pricing.cacheRead, model.pricing.unit)}
                </Typography>
              ) : null}
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
