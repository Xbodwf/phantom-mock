import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Container,
  TextField,
  Button,
  Stack,
  Typography,
  Alert,
  Paper,
  IconButton,
} from '@mui/material';
import { ArrowLeft, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { CodeEditor } from '../components/CodeEditor';
import { DEFAULT_ACTION_CODE } from '../constants/actionTemplates';
import axios from 'axios';

export function ActionEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [action, setAction] = useState({
    name: '',
    description: '',
    code: DEFAULT_ACTION_CODE,
  });

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }

    if (id && id !== 'new') {
      fetchAction();
    }
  }, [id, user, token, navigate]);

  const fetchAction = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/actions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAction({
        name: response.data.name,
        description: response.data.description || '',
        code: response.data.code,
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load action');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!action.name.trim() || !action.code.trim()) {
      setError(t('actions.nameAndCodeRequired'));
      return;
    }

    try {
      setLoading(true);
      setError('');

      if (id && id !== 'new') {
        await axios.put(
          `/api/actions/${id}`,
          action,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } else {
        await axios.post(
          '/api/actions',
          action,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/actions');
      }, 1000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save action');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return <LoadingSpinner />;
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          py: 2,
          px: 3,
        }}
      >
        <Container maxWidth="xl">
          <Stack direction="row" alignItems="center" spacing={2}>
            <IconButton onClick={() => navigate('/actions')} size="small">
              <ArrowLeft size={20} />
            </IconButton>
            <Typography variant="h6" sx={{ flex: 1 }}>
              {id && id !== 'new' ? t('actions.editAction') : t('actions.createAction')}
            </Typography>
            <Button
              variant="contained"
              startIcon={<Save size={18} />}
              onClick={handleSave}
              disabled={loading}
            >
              {t('common.save')}
            </Button>
          </Stack>
        </Container>
      </Paper>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 3 }}>
        <Container maxWidth="xl">
          <Stack spacing={3}>
            {error && (
              <Alert severity="error" onClose={() => setError('')}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success">
                {t('actions.savedSuccessfully')}
              </Alert>
            )}

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                label={t('actions.name')}
                value={action.name}
                onChange={(e) => setAction({ ...action, name: e.target.value })}
                fullWidth
                required
              />
              <TextField
                label={t('actions.description')}
                value={action.description}
                onChange={(e) => setAction({ ...action, description: e.target.value })}
                fullWidth
              />
            </Stack>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('actions.code')} *
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  height: 'calc(100vh - 350px)',
                  minHeight: 400,
                  overflow: 'hidden',
                }}
              >
                <CodeEditor
                  value={action.code}
                  onChange={(value) => setAction({ ...action, code: value || '' })}
                  language="typescript"
                  height="100%"
                />
              </Paper>
            </Box>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
