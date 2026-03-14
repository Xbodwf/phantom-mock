import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Box,
  Typography,
  Card,
  CardContent,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import RequestList from '../components/RequestList';

export function UserRequestsPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { t } = useTranslation();

  useEffect(() => {
    if (!user || !token) {
      navigate('/login');
    }
  }, [user, token, navigate]);

  if (!user) {
    return <LoadingSpinner />;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          {t('nav.requests')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('requests.description')}
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <RequestList />
        </CardContent>
      </Card>
    </Container>
  );
}
