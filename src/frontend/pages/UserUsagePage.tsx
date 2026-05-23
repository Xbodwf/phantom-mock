import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
} from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import api from '../utils/api';
import { formatDateTime, getDatePart } from '../utils/dateUtils';
import { formatCurrency } from '../utils/currency';

interface UsageRecord {
  id: string;
  userId: string;
  apiKeyId: string;
  model: string;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  timestamp: number;
  requestId: string;
}

interface DailyUsage {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export function UserUsagePage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('all');

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }
    fetchUsageRecords();
  }, [user, token, navigate]);

  const fetchUsageRecords = async () => {
    try {
      const response = await api.get('/api/user/usage/records');
      setRecords(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load usage records');
    } finally {
      setLoading(false);
    }
  };

  const allModels = [...new Set(records.map(r => r.model))];
  const allEndpoints = [...new Set(records.map(r => r.endpoint))];

  const getTimeRangeStart = () => {
    const now = Date.now();
    switch (timeRange) {
      case '7d': return now - 7 * 24 * 60 * 60 * 1000;
      case '30d': return now - 30 * 24 * 60 * 60 * 1000;
      case '90d': return now - 90 * 24 * 60 * 60 * 1000;
      default: return 0;
    }
  };

  const filteredRecords = records.filter(record => {
    const timeStart = getTimeRangeStart();
    if (timeRange !== 'all' && record.timestamp < timeStart) return false;
    if (selectedModel !== 'all' && record.model !== selectedModel) return false;
    if (selectedEndpoint !== 'all' && record.endpoint !== selectedEndpoint) return false;
    return true;
  });

  const dailyUsageMap = new Map<string, DailyUsage>();
  filteredRecords.forEach(record => {
    const date = getDatePart(record.timestamp);
    const existing = dailyUsageMap.get(date) || { date, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    existing.requests += 1;
    existing.inputTokens += record.promptTokens;
    existing.outputTokens += record.completionTokens;
    existing.cost += record.cost;
    dailyUsageMap.set(date, existing);
  });

  const dailyUsage = Array.from(dailyUsageMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  const dailyCharts = Array.from(dailyUsageMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const summary = {
    totalRequests: filteredRecords.length,
    totalInputTokens: filteredRecords.reduce((sum, r) => sum + r.promptTokens, 0),
    totalOutputTokens: filteredRecords.reduce((sum, r) => sum + r.completionTokens, 0),
    totalCost: filteredRecords.reduce((sum, r) => sum + r.cost, 0),
  };

  const byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }> = {};
  filteredRecords.forEach(record => {
    if (!byModel[record.model]) {
      byModel[record.model] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    }
    byModel[record.model].requests += 1;
    byModel[record.model].inputTokens += record.promptTokens;
    byModel[record.model].outputTokens += record.completionTokens;
    byModel[record.model].cost += record.cost;
  });

  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const formatDateTimeDisplay = (timestamp: number) => {
    return formatDateTime(timestamp);
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  const showCharts = timeRange !== 'all' && dailyCharts.length > 0;

  const chartData = dailyCharts.map(d => ({
    label: formatDateDisplay(d.date),
    requests: d.requests,
    input: d.inputTokens,
    output: d.outputTokens,
    total: d.inputTokens + d.outputTokens,
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <Box sx={{ bgcolor: 'background.paper', p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, boxShadow: 3 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>{label}</Typography>
        {payload.map((entry: any, i: number) => (
          <Typography key={i} variant="caption" sx={{ display: 'block', color: entry.color }}>
            {entry.name}: {entry.value.toLocaleString()}
          </Typography>
        ))}
      </Box>
    );
  };

  const TokenTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <Box sx={{ bgcolor: 'background.paper', p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, boxShadow: 3 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>{label}</Typography>
        {payload.map((entry: any, i: number) => (
          <Typography key={i} variant="caption" sx={{ display: 'block', color: entry.color }}>
            {entry.name}: {entry.value.toLocaleString()}
          </Typography>
        ))}
      </Box>
    );
  };

  return (
    <Container maxWidth="lg" sx={{ px: { xs: 1, sm: 2, md: 3 }, py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          {t('usage.title')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('usage.description')}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl size="small" sx={{}}>
              <InputLabel>{t('usage.timeRange')}</InputLabel>
              <Select
                value={timeRange}
                label={t('usage.timeRange')}
                onChange={(e) => setTimeRange(e.target.value as any)}
              >
                <MenuItem value="7d">{t('usage.last7Days')}</MenuItem>
                <MenuItem value="30d">{t('usage.last30Days')}</MenuItem>
                <MenuItem value="90d">{t('usage.last90Days')}</MenuItem>
                <MenuItem value="all">{t('usage.allTime')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{}}>
              <InputLabel>{t('usage.model')}</InputLabel>
              <Select
                value={selectedModel}
                label={t('usage.model')}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <MenuItem value="all">{t('usage.allModels')}</MenuItem>
                {allModels.map(model => (
                  <MenuItem key={model} value={model}>{model}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{}}>
              <InputLabel>{t('usage.endpoint')}</InputLabel>
              <Select
                value={selectedEndpoint}
                label={t('usage.endpoint')}
                onChange={(e) => setSelectedEndpoint(e.target.value)}
              >
                <MenuItem value="all">{t('usage.allEndpoints')}</MenuItem>
                {allEndpoints.map(endpoint => (
                  <MenuItem key={endpoint} value={endpoint} sx={{ textTransform: 'capitalize' }}>
                    {endpoint}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 4 }}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              {t('usage.totalRequests')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {summary.totalRequests.toLocaleString()}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              {t('usage.promptTokens', '输入 Tokens')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {summary.totalInputTokens.toLocaleString()}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              {t('usage.completionTokens', '输出 Tokens')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {summary.totalOutputTokens.toLocaleString()}
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              {t('usage.totalCost')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              {formatCurrency(summary.totalCost)}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {showCharts && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3, mb: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                {t('usage.requestsTrend', '请求频率')}
              </Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#888' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="requests" fill="#667eea" radius={[4, 4, 0, 0]} name={t('usage.requests', '请求数')} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                {t('usage.tokensTrend', 'Token 用量')}
              </Typography>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#888' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#888' }} />
                  <Tooltip content={<TokenTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="input" stackId="tokens" fill="#667eea" radius={[0, 0, 0, 0]} name={t('usage.promptTokens', '输入')} />
                  <Bar dataKey="output" stackId="tokens" fill="#764ba2" radius={[4, 4, 0, 0]} name={t('usage.completionTokens', '输出')} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Box>
      )}

      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            {t('usage.usageByModel')}
          </Typography>
          {Object.keys(byModel).length > 0 ? (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table sx={{}}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" }, padding: { xs: "8px 4px", sm: "16px" } }}>{t('usage.model')}</TableCell>
                    <TableCell align="right">{t('usage.requests')}</TableCell>
                    <TableCell align="right">{t('usage.promptTokens', '输入')}</TableCell>
                    <TableCell align="right">{t('usage.completionTokens', '输出')}</TableCell>
                    <TableCell align="right">{t('usage.cost')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(byModel).map(([model, data]) => (
                    <TableRow key={model}>
                      <TableCell sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" }, padding: { xs: "8px 4px", sm: "16px" } }}>{model}</TableCell>
                      <TableCell align="right">{data.requests.toLocaleString()}</TableCell>
                      <TableCell align="right">{data.inputTokens.toLocaleString()}</TableCell>
                      <TableCell align="right">{data.outputTokens.toLocaleString()}</TableCell>
                      <TableCell align="right">{formatCurrency(data.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography sx={{ color: 'text.secondary' }}>{t('usage.noUsageData')}</Typography>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            {t('usage.detailedRecords')}
          </Typography>
          {filteredRecords.length > 0 ? (
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{}}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" }, padding: { xs: "8px 4px", sm: "16px" } }}>{t('usage.time')}</TableCell>
                    <TableCell sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" }, padding: { xs: "8px 4px", sm: "16px" } }}>{t('usage.model')}</TableCell>
                    <TableCell sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" }, padding: { xs: "8px 4px", sm: "16px" } }}>{t('usage.endpoint')}</TableCell>
                    <TableCell align="right">{t('usage.promptTokens', '输入')}</TableCell>
                    <TableCell align="right">{t('usage.completionTokens', '输出')}</TableCell>
                    <TableCell align="right">{t('usage.cost')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredRecords.slice(0, 100).map((record) => (
                    <TableRow key={record.id}>
                      <TableCell sx={{ fontSize: '0.85rem' }}>
                        {formatDateTimeDisplay(record.timestamp)}
                      </TableCell>
                      <TableCell sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" }, padding: { xs: "8px 4px", sm: "16px" } }}>{record.model}</TableCell>
                      <TableCell sx={{ textTransform: 'capitalize' }}>{record.endpoint}</TableCell>
                      <TableCell align="right">{record.promptTokens.toLocaleString()}</TableCell>
                      <TableCell align="right">{record.completionTokens.toLocaleString()}</TableCell>
                      <TableCell align="right">{formatCurrency(record.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredRecords.length > 100 && (
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2, textAlign: 'center' }}>
                  {t('usage.showingFirst100', { total: filteredRecords.length })}
                </Typography>
              )}
            </TableContainer>
          ) : (
            <Typography sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
              {t('usage.noUsageData')}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
