import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import { Copy, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { copyToClipboard } from '../utils/clipboard';
import axios from 'axios';

export function UserProfilePage() {
  const navigate = useNavigate();
  const { user, token, updateUser: updateAuthUser } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [uid, setUid] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedUid, setCopiedUid] = useState(false);

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
      return;
    }
    setEmail(user.email);
    setUid(user.uid || '');
  }, [user, token, navigate]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await axios.put(
        '/api/user/profile',
        { email },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      updateAuthUser({ ...user!, email: response.data.email });
      setSuccess(t('user.profileUpdated'));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSetUid = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!uid.trim()) {
      setError(t('user.uidRequired'));
      return;
    }

    setLoading(true);

    try {
      const response = await axios.put(
        '/api/user/uid',
        { uid: uid.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      updateAuthUser({ ...user!, uid: response.data.uid });
      setUid(response.data.uid);
      setSuccess(t('user.uidSetSuccess'));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to set UID');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUid = () => {
    if (user?.uid) {
      copyToClipboard(`@${user.uid}`);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    if (newPassword.length < 6) {
      setError(t('auth.passwordTooShort'));
      return;
    }

    setLoading(true);

    try {
      await axios.put(
        '/api/user/password',
        { oldPassword, newPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSuccess(t('user.passwordChanged'));
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          {t('user.profileSettings')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('user.manageAccountInfo')}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          {success}
        </Alert>
      )}

      {/* 基本信息 */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
            {t('user.basicInformation')}
          </Typography>

          <form onSubmit={handleUpdateProfile}>
            <Stack spacing={2}>
              <TextField
                fullWidth
                label={t('auth.username')}
                value={user?.username || ''}
                disabled
              />
              <TextField
                fullWidth
                label={t('auth.email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
              <Button
                variant="contained"
                type="submit"
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : t('user.updateProfile')}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>

      {/* UID 设置 */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
            {t('user.uidSettings')}
          </Typography>

          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('user.uidDescription')}
          </Typography>

          {user?.uid ? (
            <Stack spacing={2}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 2,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                }}
              >
                <Typography
                  variant="body1"
                  sx={{
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    flex: 1,
                  }}
                >
                  @{user.uid}
                </Typography>
                <Button
                  size="small"
                  onClick={handleCopyUid}
                  startIcon={copiedUid ? <Check size={16} /> : <Copy size={16} />}
                  sx={{ minWidth: 'auto' }}
                >
                  {copiedUid ? t('common.copied') : t('common.copy')}
                </Button>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('user.uidChangeCooldown', 'UID can be changed every 30 days')}
              </Typography>
            </Stack>
          ) : (
            <form onSubmit={handleSetUid}>
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label={t('user.uid')}
                  placeholder={t('user.uidPlaceholder')}
                  value={uid}
                  onChange={(e) => setUid(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  disabled={loading}
                  helperText={t('user.uidHelper')}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">@</InputAdornment>
                    ),
                  }}
                />
                <Button
                  variant="contained"
                  type="submit"
                  disabled={loading || !uid.trim()}
                >
                  {loading ? <CircularProgress size={24} /> : t('user.setUid')}
                </Button>
              </Stack>
            </form>
          )}
        </CardContent>
      </Card>

      {/* 修改密码 */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
            {t('user.changePassword')}
          </Typography>

          <form onSubmit={handleChangePassword}>
            <Stack spacing={2}>
              <TextField
                fullWidth
                label={t('user.currentPassword')}
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                disabled={loading}
              />
              <TextField
                fullWidth
                label={t('user.newPassword')}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
              />
              <TextField
                fullWidth
                label={t('user.confirmNewPassword')}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
              />
              <Button
                variant="contained"
                type="submit"
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : t('user.changePassword')}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Container>
  );
}
