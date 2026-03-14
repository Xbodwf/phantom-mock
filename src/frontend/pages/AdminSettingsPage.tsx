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
  Switch,
  FormControlLabel,
  Stack,
  Alert,
  Divider,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import axios from 'axios';

interface EmailSettings {
  emailVerificationEnabled: boolean;
  emailjs?: {
    serviceId: string;
    templateId: string;
    publicKey: string;
    privateKey: string;
  };
}

export function AdminSettingsPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [settings, setSettings] = useState<EmailSettings>({
    emailVerificationEnabled: false,
    emailjs: {
      serviceId: '',
      templateId: '',
      publicKey: '',
      privateKey: '',
    },
  });

  useEffect(() => {
    if (!user || !token || user.role !== 'admin') {
      navigate('/login');
      return;
    }

    fetchSettings();
  }, [user, token, navigate]);

  const fetchSettings = async () => {
    try {
      const response = await axios.get('/api/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSettings({
        emailVerificationEnabled: response.data.emailVerificationEnabled || false,
        emailjs: response.data.emailjs || {
          serviceId: '',
          templateId: '',
          publicKey: '',
          privateKey: '',
        },
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await axios.put(
        '/api/settings',
        settings,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess(t('admin.settingsSaved'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          {t('admin.loginSettings')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('admin.loginSettingsDesc')}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Stack spacing={3}>
            {/* 邮箱验证开关 */}
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.emailVerificationEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, emailVerificationEnabled: e.target.checked })
                    }
                  />
                }
                label={t('admin.enableEmailVerification')}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t('admin.emailVerificationHelper')}
              </Typography>
            </Box>

            <Divider />

            {/* EmailJS 配置 */}
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {t('admin.emailjsConfig')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('admin.emailjsConfigDesc')}
              </Typography>

              <Stack spacing={2}>
                <TextField
                  label={t('admin.serviceId')}
                  value={settings.emailjs?.serviceId || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      emailjs: { ...settings.emailjs!, serviceId: e.target.value },
                    })
                  }
                  fullWidth
                  disabled={!settings.emailVerificationEnabled}
                  helperText={t('admin.serviceIdHelper')}
                />

                <TextField
                  label={t('admin.templateId')}
                  value={settings.emailjs?.templateId || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      emailjs: { ...settings.emailjs!, templateId: e.target.value },
                    })
                  }
                  fullWidth
                  disabled={!settings.emailVerificationEnabled}
                  helperText={t('admin.templateIdHelper')}
                />

                <TextField
                  label={t('admin.publicKey')}
                  value={settings.emailjs?.publicKey || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      emailjs: { ...settings.emailjs!, publicKey: e.target.value },
                    })
                  }
                  fullWidth
                  disabled={!settings.emailVerificationEnabled}
                  helperText={t('admin.publicKeyHelper')}
                />

                <TextField
                  label={t('admin.privateKey')}
                  type="password"
                  value={settings.emailjs?.privateKey || ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      emailjs: { ...settings.emailjs!, privateKey: e.target.value },
                    })
                  }
                  fullWidth
                  disabled={!settings.emailVerificationEnabled}
                  helperText={t('admin.privateKeyHelper')}
                />
              </Stack>
            </Box>

            <Divider />

            {/* 模板说明 */}
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {t('admin.templateInstructions')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('admin.templateVariables')}
              </Typography>
              <Box
                component="pre"
                sx={{
                  p: 2,
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontSize: '0.875rem',
                  overflow: 'auto',
                }}
              >
                {`{{to_email}} - 收件人邮箱
{{to_name}} - 收件人名称
{{verification_code}} - 验证码`}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('admin.templateExample')}
              </Typography>
              <Box
                component="pre"
                sx={{
                  p: 2,
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  fontSize: '0.875rem',
                  overflow: 'auto',
                }}
              >
                {`您好 {{to_name}}，

您的验证码是：{{verification_code}}

验证码有效期为 5 分钟，请尽快完成验证。

如果这不是您的操作，请忽略此邮件。`}
              </Box>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button variant="outlined" onClick={() => navigate('/console/dashboard')}>
          {t('admin.back')}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? t('admin.saving') : t('admin.saveSettings')}
        </Button>
      </Box>
    </Container>
  );
}
