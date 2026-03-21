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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
} from '@mui/material';
import { Plus, Trash2, Edit2, Upload, X } from 'lucide-react';
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
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedActionForPublish, setSelectedActionForPublish] = useState<Action | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

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

  const handlePublishClick = (action: Action) => {
    setSelectedActionForPublish(action);
    setPublishDialogOpen(true);
  };

  const handlePublishConfirm = async () => {
    if (!selectedActionForPublish) return;

    try {
      const response = await axios.post(
        `/api/actions/${selectedActionForPublish.id}/publish`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSnackbarMessage(
        t('actions.publishSuccess', 'Action published as {{name}}', {
          name: response.data.publishedName,
        })
      );
      setSnackbarOpen(true);
      setPublishDialogOpen(false);
      await fetchActions();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to publish action';
      setSnackbarMessage(errorMsg);
      setSnackbarOpen(true);
    }
  };

  const handleUnpublish = async (id: string) => {
    if (!confirm(t('actions.confirmUnpublish', 'Unpublish this action?'))) return;

    try {
      await axios.post(
        `/api/actions/${id}/unpublish`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSnackbarMessage(t('actions.unpublishSuccess', 'Action unpublished'));
      setSnackbarOpen(true);
      await fetchActions();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to unpublish action';
      setSnackbarMessage(errorMsg);
      setSnackbarOpen(true);
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
                          title={t('common.edit')}
                        >
                          <Edit2 size={18} />
                        </IconButton>
                        {!action.isPublic ? (
                          <IconButton
                            size="small"
                            color="success"
                            onClick={() => handlePublishClick(action)}
                            title={t('actions.publish', 'Publish')}
                          >
                            <Upload size={18} />
                          </IconButton>
                        ) : (
                          <IconButton
                            size="small"
                            color="warning"
                            onClick={() => handleUnpublish(action.id)}
                            title={t('actions.unpublish', 'Unpublish')}
                          >
                            <X size={18} />
                          </IconButton>
                        )}
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteAction(action.id)}
                          title={t('common.delete')}
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

      {/* 发布确认对话框 */}
      <Dialog open={publishDialogOpen} onClose={() => setPublishDialogOpen(false)}>
        <DialogTitle>{t('actions.publishConfirm', 'Publish Action')}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t(
              'actions.publishMessage',
              'Publishing this action will make it available to all users in the Action Marketplace. The action will be named: @{{uid}}/{{name}}',
              {
                uid: user?.uid || 'username',
                name: selectedActionForPublish?.name || '',
              }
            )}
          </Typography>
          <Alert severity="info">
            {t(
              'actions.publishNote',
              'Once published, other users can discover and use your action. You can unpublish it anytime.'
            )}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" onClick={handlePublishConfirm}>
            {t('actions.publish', 'Publish')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />
    </Container>
  );
}
