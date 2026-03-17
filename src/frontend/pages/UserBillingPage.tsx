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
  Chip,
  Alert,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import axios from 'axios';
import type { Invoice } from '../../types.js';
import { formatCurrency } from '../utils/currency';

interface BillingInfo {
  balance: number;
  invoices: Invoice[];
}

export function UserBillingPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }

    fetchBillingInfo();
  }, [user, token, navigate]);

  const fetchBillingInfo = async () => {
    try {
      const response = await axios.get('/api/user/billing', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBillingInfo(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load billing info');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): 'success' | 'warning' | 'error' | 'default' => {
    switch (status) {
      case 'paid':
        return 'success';
      case 'pending':
        return 'warning';
      case 'overdue':
        return 'error';
      default:
        return 'default';
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          {t('billing.title')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('billing.description')}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* 账户余额 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 3, mb: 4 }}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              {t('billing.currentBalance')}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 600, color: 'primary.main' }}>
              {formatCurrency(billingInfo?.balance || 0, 2)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
              {t('billing.availableForUsage')}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* 发票列表 */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            {t('billing.invoices')}
          </Typography>
          {billingInfo && billingInfo.invoices.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell>{t('billing.period')}</TableCell>
                    <TableCell align="right">{t('billing.usage')}</TableCell>
                    <TableCell align="right">{t('dashboard.totalCost')}</TableCell>
                    <TableCell>{t('billing.status')}</TableCell>
                    <TableCell>{t('billing.created')}</TableCell>
                    <TableCell>{t('billing.dueDate')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {billingInfo.invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell sx={{ fontWeight: 500 }}>{invoice.period}</TableCell>
                      <TableCell align="right">{invoice.totalUsage}</TableCell>
                      <TableCell align="right">{formatCurrency(invoice.totalCost)}</TableCell>
                      <TableCell>
                        <Chip
                          label={invoice.status}
                          color={getStatusColor(invoice.status)}
                          size="small"
                          sx={{ textTransform: 'capitalize' }}
                        />
                      </TableCell>
                      <TableCell>
                        {new Date(invoice.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {new Date(invoice.dueDate).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              {t('billing.noInvoices')}
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* 计费说明 */}
      <Card sx={{ mt: 4 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            {t('billing.billingInformation')}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            • {t('billing.prepaidModel')}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            • {t('billing.apiRequestDeduction')}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            • {t('billing.invoicesGenerated')}
          </Typography>
          <Typography variant="body2">
            • {t('billing.contactSupport')}
          </Typography>
        </CardContent>
      </Card>
    </Container>
  );
}
