import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  IconButton,
  Chip,
} from '@mui/material';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import axios from 'axios';
import type { Action } from '../../types.js';

export function ActionsPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }

    fetchActions();
  }, [user, token, navigate]);

  const fetchActions = async () => {
    try {
      const response = await axios.get('/api/actions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setActions(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  };

  const handleEditAction = (action: Action) => {
    navigate(`/actions/edit/${action.id}`);
  };

  const handleDeleteAction = async (id: string) => {
    if (!confirm(t('actions.confirmDelete'))) return;

    try {
      await axios.delete(`/api/actions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchActions();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete action');
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
            {t('actions.title')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('actions.description')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={20} />}
          onClick={() => navigate('/actions/edit/new')}
        >
          {t('actions.createAction')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          {actions.length === 0 ? (
            <Typography sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              {t('actions.noActions')}
            </Typography>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: 'action.hover' }}>
                    <TableCell>{t('common.name')}</TableCell>
                    <TableCell>{t('actions.description')}</TableCell>
                    <TableCell>{t('common.created')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {actions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell sx={{ fontWeight: 500 }}>{action.name}</TableCell>
                      <TableCell>{action.description}</TableCell>
                      <TableCell>
                        {new Date(action.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={action.isPublic ? t('actions.public') : t('actions.private')}
                          color={action.isPublic ? 'primary' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleEditAction(action)}
                        >
                          <Edit2 size={18} />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteAction(action.id)}
                        >
                          <Trash2 size={18} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
