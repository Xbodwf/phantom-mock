import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Container,
  Box,
  TextField,
  Button,
  Typography,
  Card,
  Alert,
  CircularProgress,
  Stack,
  AppBar,
  Toolbar,
} from '@mui/material';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 检查用户是否已登录，如果已登录则重定向
  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await axios.post('/api/auth/login', {
        username,
        password,
      });

      // 使用 AuthContext 的 login 方法
      login(response.data.token, response.data.user);

      // 所有用户登录后都跳转到用户仪表板
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AppBar position="sticky" sx={{ backgroundColor: 'background.paper', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Toolbar>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              color: 'primary.main',
              cursor: 'pointer',
              mr: 4,
            }}
            onClick={() => navigate('/login')}
          >
            Phantom Mock
          </Typography>
          <Box sx={{ ml: 'auto' }}>
            <LanguageSwitcher />
          </Box>
        </Toolbar>
      </AppBar>
      <Container maxWidth="sm" sx={{ display: 'flex', alignItems: 'center', minHeight: 'calc(100vh - 64px)' }}>
        <Box sx={{ width: '100%' }}>
          <Card sx={{ p: 4 }}>
            <Typography variant="h4" sx={{ mb: 1, fontWeight: 600, textAlign: 'center' }}>
              {t('auth.login')}
            </Typography>
            <Typography variant="body2" sx={{ mb: 3, textAlign: 'center', color: 'text.secondary' }}>
              {t('auth.signInDescription')}
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleLogin}>
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label={t('auth.username')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                />
                <TextField
                  fullWidth
                  label={t('auth.password')}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <Button
                  fullWidth
                  variant="contained"
                  type="submit"
                  disabled={loading}
                  sx={{ mt: 2 }}
                >
                  {loading ? <CircularProgress size={24} /> : t('auth.signIn')}
                </Button>
              </Stack>
            </form>

            <Typography variant="body2" sx={{ mt: 3, textAlign: 'center' }}>
              {t('auth.noAccount')}{' '}
              <Link to="/register" style={{ color: 'inherit', textDecoration: 'none' }}>
                <Typography component="span" sx={{ color: 'primary.main', cursor: 'pointer' }}>
                  {t('auth.registerHere')}
                </Typography>
              </Link>
            </Typography>
          </Card>
        </Box>
      </Container>
    </>
  );
}
