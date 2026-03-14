import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Button,
  Chip,
  Alert,
  Paper,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import axios from 'axios';
import type { UsageRecord } from '../../types.js';

export function AdminUserRequestsPage() {
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();
  const { user, token } = useAuth();
  const [requests, setRequests] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userName, setUserName] = useState('');

  useEffect(() => {
    if (!user || !token || user.role !== 'admin') {
      navigate('/login');
      return;
    }

    fetchUserRequests();
  }, [user, token, navigate, userId]);

  const fetchUserRequests = async () => {
    try {
      const [requestsRes, userRes] = await Promise.all([
        axios.get(`/api/admin/users/${userId}/usage`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`/api/admin/users/${userId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setRequests(requestsRes.data);
      setUserName(userRes.data.username);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
            {userName} 的请求记录
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            查看用户的所有 API 请求历史
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate('/console/users')}>
          返回用户列表
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          {requests.length === 0 ? (
            <Typography sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              暂无请求记录
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell>时间</TableCell>
                    <TableCell>模型</TableCell>
                    <TableCell>端点</TableCell>
                    <TableCell align="right">Prompt Tokens</TableCell>
                    <TableCell align="right">Completion Tokens</TableCell>
                    <TableCell align="right">总 Tokens</TableCell>
                    <TableCell align="right">费用</TableCell>
                    <TableCell>请求 ID</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell>{formatDate(req.timestamp)}</TableCell>
                      <TableCell>
                        <Chip label={req.model} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={req.endpoint}
                          size="small"
                          color={req.endpoint === 'chat' ? 'primary' : req.endpoint === 'image' ? 'secondary' : 'default'}
                        />
                      </TableCell>
                      <TableCell align="right">{req.promptTokens.toLocaleString()}</TableCell>
                      <TableCell align="right">{req.completionTokens.toLocaleString()}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 500 }}>
                        {req.totalTokens.toLocaleString()}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 500, color: 'primary.main' }}>
                        ${req.cost.toFixed(6)}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {req.requestId.substring(0, 8)}...
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {requests.length > 0 && (
        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            共 {requests.length} 条记录
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Paper variant="outlined" sx={{ px: 2, py: 1 }}>
              <Typography variant="caption" color="text.secondary">
                总 Tokens
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {requests.reduce((sum, r) => sum + r.totalTokens, 0).toLocaleString()}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ px: 2, py: 1 }}>
              <Typography variant="caption" color="text.secondary">
                总费用
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
                ${requests.reduce((sum, r) => sum + r.cost, 0).toFixed(4)}
              </Typography>
            </Paper>
          </Box>
        </Box>
      )}
    </Container>
  );
}
