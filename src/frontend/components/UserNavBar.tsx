import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Box,
  Button,
  Typography,
  useMediaQuery,
  useTheme,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
} from '@mui/material';
import { Menu as MenuIcon, LogOut, Settings } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';

export function UserNavBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.role === 'admin';

  const menuItems = [
    { label: t('userNav.dashboard'), path: '/dashboard' },
    { label: t('nav.modelMarketplace'), path: '/models' },
    { label: t('userNav.apiKeys'), path: '/keys' },
    { label: t('userNav.invitation'), path: '/invitation' },
    { label: t('userNav.requests'), path: '/requests' },
    { label: t('userNav.usage'), path: '/usage' },
    { label: t('userNav.billing'), path: '/billing' },
    { label: t('userNav.profile'), path: '/profile' },
    { label: t('userNav.actions'), path: '/actions' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const drawer = (
    <Box sx={{ width: 250 }}>
      <Box sx={{ p: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
          {t('nav.home')}
        </Typography>
      </Box>
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => handleNavigate(item.path)}
            >
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
        {isAdmin && (
          <>
            <Divider sx={{ my: 1 }} />
            <ListItem disablePadding>
              <ListItemButton onClick={() => handleNavigate('/console/dashboard')}>
                <ListItemText primary={t('userNav.adminConsole', '管理员控制台')} />
              </ListItemButton>
            </ListItem>
          </>
        )}
      </List>
      <Box sx={{ p: 2, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<LogOut size={18} />}
          onClick={handleLogout}
        >
          {t('common.logout')}
        </Button>
      </Box>
    </Box>
  );

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
            onClick={() => navigate('/dashboard')}
          >
            Phantom Mock
          </Typography>

          {!isMobile && (
            <Box sx={{ display: 'flex', gap: 1, flex: 1 }}>
              {menuItems.map((item) => (
                <Button
                  key={item.path}
                  color="inherit"
                  onClick={() => navigate(item.path)}
                  sx={{
                    textTransform: 'none',
                    color: location.pathname === item.path ? 'primary.main' : 'text.primary',
                    borderBottom: location.pathname === item.path ? '2px solid' : 'none',
                    borderColor: 'primary.main',
                    borderRadius: 0,
                    pb: 1,
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Box>
          )}

          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            {!isMobile && (
              <>
                <Typography variant="body2" sx={{ mr: 2 }}>
                  {user?.username}
                </Typography>
                {isAdmin && (
                  <Button
                    variant="outlined"
                    size="small"
                    color="secondary"
                    startIcon={<Settings size={18} />}
                    onClick={() => navigate('/console/dashboard')}
                  >
                    {t('userNav.adminConsole', '控制台')}
                  </Button>
                )}
                <ThemeSwitcher />
                <LanguageSwitcher />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<LogOut size={18} />}
                  onClick={handleLogout}
                >
                  {t('common.logout')}
                </Button>
              </>
            )}

            {isMobile && (
              <IconButton
                color="inherit"
                onClick={() => setMobileOpen(true)}
              >
                <MenuIcon size={24} />
              </IconButton>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {isMobile && (
        <Drawer
          anchor="right"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
        >
          {drawer}
        </Drawer>
      )}
    </>
  );
}