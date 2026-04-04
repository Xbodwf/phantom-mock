import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  useMediaQuery,
  useTheme,
  IconButton,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  Stack,
  Avatar,
  Collapse,
  Tooltip,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  LayoutDashboard,
  Cpu,
  Users,
  Bell,
  Ticket,
  Settings,
  Server,
  Network,
  LogOut,
  Menu as MenuIcon,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Home,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';

const DRAWER_WIDTH = 260;
const COLLAPSED_WIDTH = 72;

export function AdminNavBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { sidebarCollapsed, toggleSidebarCollapsed } = useSidebar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);

  const mainMenuItems = [
    { label: t('nav.dashboard'), path: '/console/dashboard', icon: <LayoutDashboard size={20} /> },
    { label: t('nav.models'), path: '/console/models', icon: <Cpu size={20} /> },
    { label: t('nav.users'), path: '/console/users', icon: <Users size={20} /> },
    { label: t('nav.notifications'), path: '/console/notifications', icon: <Bell size={20} /> },
    { label: t('nav.redeemCodes'), path: '/console/redeem-codes', icon: <Ticket size={20} /> },
    { label: t('nav.providers'), path: '/console/providers', icon: <Server size={20} /> },
    { label: t('nav.nodes'), path: '/console/nodes', icon: <Network size={20} /> },
    { label: t('nav.loginSettings'), path: '/console/settings', icon: <Settings size={20} /> },
  ];

  const accountMenuItems = [
    { label: t('common.logout'), action: handleLogout, icon: <LogOut size={20} /> },
  ];

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', py: 1 }}>
        <List disablePadding>
          {mainMenuItems.map((item) => (
            <Tooltip key={item.path} title={sidebarCollapsed ? item.label : ''} placement="right">
              <ListItemButton
                            selected={location.pathname === item.path}
                            onClick={() => handleNavigate(item.path)}
                            sx={{
                              mx: sidebarCollapsed ? 1 : 2,
                              mb: 1,
                              borderRadius: 2,
                              py: 2,
                              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                              px: sidebarCollapsed ? 1.5 : 2,
                              backgroundColor: location.pathname === item.path ? 'primary.main' : 'transparent',
                              color: location.pathname === item.path ? '#ffffff' : 'text.primary',
                              fontWeight: location.pathname === item.path ? 600 : 400,
                              
                              '&:hover': {
                                backgroundColor: location.pathname === item.path ? 'primary.dark' : 'action.hover',
                              },
                            }}
                          >
                            <Stack direction="row" alignItems="center" spacing={sidebarCollapsed ? 0 : 2} sx={{ width: '100%' }}>
                              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                {item.icon}
                              </Box>
                              {!sidebarCollapsed && (
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {item.label}
                                </Typography>
                              )}
                            </Stack>
                          </ListItemButton>            </Tooltip>
          ))}
        </List>
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        <List disablePadding>
          <Tooltip title={sidebarCollapsed ? user?.username || '' : ''} placement="right">
            <ListItemButton
              onClick={(e) => {
                if (!isMobile) {
                  handleUserMenuOpen(e);
                } else {
                  setUserMenuOpen(!userMenuOpen);
                }
              }}
              sx={{
                mx: sidebarCollapsed ? 1 : 2,
                my: 1,
                borderRadius: 2,
                py: 2,
                px: sidebarCollapsed ? 1.5 : 2,
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              }}
            >
              <Stack 
                direction="row" 
                alignItems="center" 
                spacing={sidebarCollapsed ? 0 : 2} 
                sx={{ width: '100%', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}
              >
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                  {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                </Avatar>
                {!sidebarCollapsed && (
                  <Stack sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {user?.username}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('nav.admin')}
                    </Typography>
                  </Stack>
                )}
                {!sidebarCollapsed && (
                  <ChevronDown size={16} style={{ color: 'currentColor' }} />
                )}
              </Stack>
            </ListItemButton>
          </Tooltip>

          <Collapse in={userMenuOpen && !sidebarCollapsed}>
            <List disablePadding sx={{ pb: 2 }}>
              {accountMenuItems.map((item, index) => (
                <ListItemButton
                  key={index}
                  onClick={item.action}
                  sx={{
                    mx: 2,
                    mb: 1,
                    borderRadius: 2,
                    py: 2,
                    pl: 6,
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={2}>
                    {item.icon}
                    <Typography variant="body2">{item.label}</Typography>
                  </Stack>
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          <Divider />

          {!sidebarCollapsed && (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <LanguageSwitcher />
              <ThemeSwitcher />
            </Box>
          )}
        </List>
        
        {/* 桌面端用户下拉菜单 */}
        {!isMobile && (
          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={handleUserMenuClose}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
            sx={{ mt: 2 }}
          >
            <MenuItem onClick={() => { navigate('/dashboard'); handleUserMenuClose(); }}>
              <Home size={18} style={{ marginRight: 12 }} />
              {t('userNav.dashboard')}
            </MenuItem>
            <MenuItem onClick={() => { handleNavigate('/profile'); handleUserMenuClose(); }}>
              <User size={18} style={{ marginRight: 12 }} />
              {t('userNav.profile')}
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { handleLogout(); handleUserMenuClose(); }} sx={{ color: 'error.main' }}>
              <LogOut size={18} style={{ marginRight: 12 }} />
              {t('common.logout')}
            </MenuItem>
          </Menu>
        )}
      </Box>
    </Box>
  );

  if (isMobile) {
    return (
      <>
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: (theme) => theme.zIndex.appBar,
            backgroundColor: 'background.paper',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            px: 2,
            py: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <IconButton
            onClick={() => setMobileOpen(true)}
            color="inherit"
            sx={{ mr: 2 }}
          >
            <MenuIcon size={24} />
          </IconButton>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: 'auto' }}>
            <LanguageSwitcher />
            <ThemeSwitcher />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={handleUserMenuOpen}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                {user?.username?.charAt(0)?.toUpperCase() || 'U'}
              </Avatar>
              <ChevronDown size={14} style={{ color: 'currentColor' }} />
            </Box>
          </Stack>
          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={handleUserMenuClose}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
          >
            <MenuItem onClick={() => { navigate('/dashboard'); handleUserMenuClose(); }}>
              <Home size={18} style={{ marginRight: 12 }} />
              {t('userNav.dashboard')}
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { handleLogout(); handleUserMenuClose(); }} sx={{ color: 'error.main' }}>
              <LogOut size={18} style={{ marginRight: 12 }} />
              {t('common.logout')}
            </MenuItem>
          </Menu>
        </Box>

        <Drawer
          anchor="left"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          PaperProps={{ sx: { width: DRAWER_WIDTH } }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2 }}>
            <Typography variant="h6">{t('nav.menu')}</Typography>
            <IconButton onClick={() => setMobileOpen(false)}>
              <X size={24} />
            </IconButton>
          </Box>
          {drawerContent}
        </Drawer>
      </>
    );
  }

  return (
    <>
      {/* 桌面端顶部栏 - 折叠时显示 */}
      {sidebarCollapsed && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: (theme) => theme.zIndex.appBar,
            backgroundColor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            px: 2,
            py: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <IconButton
            onClick={toggleSidebarCollapsed}
            color="inherit"
            sx={{ mr: 1 }}
          >
            <MenuIcon size={24} />
          </IconButton>
          <Stack direction="row" spacing={1} alignItems="center">
            <LanguageSwitcher />
            <ThemeSwitcher />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', ml: 'auto' }} onClick={handleUserMenuOpen}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                {user?.username?.charAt(0)?.toUpperCase() || 'U'}
              </Avatar>
              <ChevronDown size={14} style={{ color: 'currentColor' }} />
            </Box>
          </Stack>
          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={handleUserMenuClose}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
          >
            <MenuItem onClick={() => { navigate('/dashboard'); handleUserMenuClose(); }}>
              <Home size={18} style={{ marginRight: 12 }} />
              {t('userNav.dashboard')}
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { handleLogout(); handleUserMenuClose(); }} sx={{ color: 'error.main' }}>
              <LogOut size={18} style={{ marginRight: 12 }} />
              {t('common.logout')}
            </MenuItem>
          </Menu>
        </Box>
      )}

      {/* 桌面端侧边栏 - 展开时显示 */}
      {!sidebarCollapsed && (
        <Box
          sx={{
            width: DRAWER_WIDTH,
            height: '100vh',
            position: 'fixed',
            left: 0,
            top: 0,
            backgroundColor: 'background.paper',
            borderRight: '1px solid',
            borderColor: 'divider',
            zIndex: (theme) => theme.zIndex.drawer,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2 }}>
            <Typography variant="h6">{t('nav.menu')}</Typography>
            <IconButton onClick={toggleSidebarCollapsed}>
              <X size={24} />
            </IconButton>
          </Box>
          {drawerContent}
        </Box>
      )}
    </>
  );
}
