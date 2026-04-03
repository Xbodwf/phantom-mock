import { useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  Toolbar,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Divider,
  Button,
  Typography,
  useMediaQuery,
  useTheme,
  Tooltip,
  Avatar,
  Menu,
  MenuItem,
} from '@mui/material';
import { Menu as MenuIcon, LogOut, Settings as SettingsIcon, BookOpen, LayoutDashboard, Key, CreditCard, Activity, BarChart3, FileText, ShoppingBag, Zap, MessageSquare, ChevronLeft, ChevronRight, X, ChevronDown, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';

const DRAWER_WIDTH = 260;
const COLLAPSED_WIDTH = 72;

interface UserLayoutProps {
  children: React.ReactNode;
}

export function UserLayout({ children }: UserLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { mobileOpen, setMobileOpen, sidebarCollapsed, toggleSidebarCollapsed } = useSidebar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // 在非移动设备上导航时关闭侧边栏
  useEffect(() => {
    if (isMobile) {
      setMobileOpen(false);
    }
  }, [location.pathname, isMobile, setMobileOpen]);

  const isAdmin = user?.role === 'admin';

  const menuItems = [
    { label: t('userNav.dashboard'), path: '/dashboard', icon: <LayoutDashboard size={20} /> },
    { label: t('nav.modelMarketplace'), path: '/models', icon: <ShoppingBag size={20} /> },
    { label: t('userNav.chat', '聊天'), path: '/chat', icon: <MessageSquare size={20} /> },
    { label: t('actionMarketplace.title', 'Action Marketplace'), path: '/actions/marketplace', icon: <Zap size={20} /> },
    { label: t('userNav.apiKeys'), path: '/keys', icon: <Key size={20} /> },
    { label: t('userNav.invitation'), path: '/invitation', icon: <FileText size={20} /> },
    { label: t('userNav.requests'), path: '/requests', icon: <Activity size={20} /> },
    { label: t('userNav.usage'), path: '/usage', icon: <BarChart3 size={20} /> },
    { label: t('userNav.billing'), path: '/billing', icon: <CreditCard size={20} /> },
  ];

  const accountItems = [
    { label: t('userNav.profile'), path: '/profile', icon: <SettingsIcon size={20} /> },
    { label: t('userNav.actions'), path: '/actions', icon: <Zap size={20} /> },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);
  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };
  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {!isMobile && (
        <Box sx={{ 
          p: 1, 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}>
          <Tooltip title={sidebarCollapsed ? t('common.expand', '展开') : t('common.collapse', '折叠')}>
            <IconButton
              onClick={toggleSidebarCollapsed}
              size="small"
              sx={{
                color: 'text.secondary',
                '&:hover': {
                  backgroundColor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              {sidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* 主菜单 */}
      <List sx={{ flex: 1, py: 1, overflowY: 'auto' }}>
        {menuItems.map((item) => (
          <Tooltip key={item.path} title={sidebarCollapsed ? item.label : ''} placement="right">
            <ListItem disablePadding>
              <ListItemButton
                selected={location.pathname === item.path}
                onClick={() => handleNavigate(item.path)}
                sx={{
                  borderRadius: 2,
                  mx: sidebarCollapsed ? 1 : 1,
                  my: 0.5,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  px: sidebarCollapsed ? 1 : 1,
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: sidebarCollapsed ? 'auto' : 40, display: 'flex', justifyContent: 'center' }}>
                  {item.icon}
                </ListItemIcon>
                {!sidebarCollapsed && (
                  <ListItemText 
                    primary={item.label}
                    primaryTypographyProps={{ fontWeight: 500, fontSize: '0.875rem' }}
                  />
                )}
              </ListItemButton>
            </ListItem>
          </Tooltip>
        ))}

        {/* 账户菜单 */}
        {!sidebarCollapsed && <Divider sx={{ my: 1, mx: 2 }} />}
        {!sidebarCollapsed && (
          <Typography 
            variant="caption" 
            sx={{ 
              px: 3, 
              py: 1,
              color: 'text.secondary',
              fontSize: '0.75rem',
            }}
          >
            {t('user.account', 'Account')}
          </Typography>
        )}
        {accountItems.map((item) => (
          <Tooltip key={item.path} title={sidebarCollapsed ? item.label : ''} placement="right">
            <ListItem disablePadding>
              <ListItemButton
                selected={location.pathname === item.path}
                onClick={() => handleNavigate(item.path)}
                sx={{
                  borderRadius: 2,
                  mx: sidebarCollapsed ? 1 : 1,
                  my: 0.5,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  px: sidebarCollapsed ? 1 : 1,
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: sidebarCollapsed ? 'auto' : 40, display: 'flex', justifyContent: 'center' }}>
                  {item.icon}
                </ListItemIcon>
                {!sidebarCollapsed && (
                  <ListItemText 
                    primary={item.label}
                    primaryTypographyProps={{ fontWeight: 500, fontSize: '0.875rem' }}
                  />
                )}
              </ListItemButton>
            </ListItem>
          </Tooltip>
        ))}

        {/* 管理员控制台 */}
        {isAdmin && (
          <Tooltip key="admin-console" title={sidebarCollapsed ? t('userNav.adminConsole', '管理员控制台') : ''} placement="right">
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => handleNavigate('/console/dashboard')}
                sx={{
                  borderRadius: 2,
                  mx: sidebarCollapsed ? 1 : 1,
                  my: 0.5,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  px: sidebarCollapsed ? 1 : 1,
                  backgroundColor: 'secondary.main',
                  color: 'secondary.contrastText',
                  '&:hover': {
                    backgroundColor: 'secondary.dark',
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: sidebarCollapsed ? 'auto' : 40, display: 'flex', justifyContent: 'center', color: 'inherit' }}>
                  <SettingsIcon size={20} />
                </ListItemIcon>
                {!sidebarCollapsed && (
                  <ListItemText 
                    primary={t('userNav.adminConsole', '管理员控制台')}
                    primaryTypographyProps={{ fontWeight: 500, fontSize: '0.875rem' }}
                  />
                )}
              </ListItemButton>
            </ListItem>
          </Tooltip>
        )}
      </List>

      {/* 语言和主题切换 */}
      <Box sx={{ p: 2, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
          <ThemeSwitcher />
          <LanguageSwitcher />
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', maxWidth: '100vw', overflow: 'hidden' }}>
      {/* 桌面端顶部栏 - 折叠时显示 */}
      {!isMobile && sidebarCollapsed && (
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 'auto' }}>
            <LanguageSwitcher />
            <ThemeSwitcher />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={handleUserMenuOpen}>
              <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main' }}>
                {user?.username?.charAt(0)?.toUpperCase() || 'U'}
              </Avatar>
              <ChevronDown size={16} style={{ color: 'currentColor' }} />
            </Box>
          </Box>
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
            <MenuItem onClick={() => { handleNavigate('/profile'); handleUserMenuClose(); }}>
              <User size={18} style={{ marginRight: 12 }} />
              {t('userNav.profile')}
            </MenuItem>
            {isAdmin && (
              <MenuItem onClick={() => { handleNavigate('/console/dashboard'); handleUserMenuClose(); }}>
                <SettingsIcon size={18} style={{ marginRight: 12 }} />
                {t('userNav.adminConsole')}
              </MenuItem>
            )}
            <Divider />
            <MenuItem onClick={() => { handleLogout(); handleUserMenuClose(); }} sx={{ color: 'error.main' }}>
              <LogOut size={18} style={{ marginRight: 12 }} />
              {t('common.logout')}
            </MenuItem>
          </Menu>
        </Box>
      )}

      {/* 桌面端侧边栏 - 展开时显示 */}
      {!isMobile && !sidebarCollapsed && (
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
          {drawer}
        </Box>
      )}

      {/* 移动端抽屉 */}
      {isMobile && (
        <Drawer
          variant="temporary"
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
          {drawer}
        </Drawer>
      )}

      {/* 主内容区 */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          width: { xs: '100vw', md: '100%' },
          minHeight: '100vh',
          maxWidth: { xs: '100vw', md: '100%' },
          overflow: 'hidden',
        }}
      >
        {/* 顶部 AppBar - 聊天页面不显示，因为有自己的顶部栏 */}
        {location.pathname !== '/chat' && (
          <AppBar 
            position="sticky"
            elevation={0}
            sx={{
              backgroundColor: 'background.paper',
              color: 'text.primary',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              flexShrink: 0,
            }}
          >
            <Toolbar>
              {isMobile && (
                <IconButton
                  color="inherit"
                  edge="start"
                  onClick={() => setMobileOpen(true)}
                  sx={{ mr: 2 }}
                >
                  <MenuIcon size={24} />
                </IconButton>
              )}
              <Typography 
                variant="h6" 
                noWrap 
                component="div" 
                sx={{ 
                  flexGrow: 1,
                  fontWeight: 600,
                  color: 'text.primary',
                }}
              >
                {[...menuItems, ...accountItems].find((item) => item.path === location.pathname)?.label || 'Dashboard'}
              </Typography>
              {!isMobile && !sidebarCollapsed && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <LanguageSwitcher />
                  <ThemeSwitcher />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={handleUserMenuOpen}>
                    <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main' }}>
                      {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                    </Avatar>
                    <ChevronDown size={16} style={{ color: 'currentColor' }} />
                  </Box>
                </Box>
              )}
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
                <MenuItem onClick={() => { handleNavigate('/profile'); handleUserMenuClose(); }}>
                  <User size={18} style={{ marginRight: 12 }} />
                  {t('userNav.profile')}
                </MenuItem>
                {isAdmin && (
                  <MenuItem onClick={() => { handleNavigate('/console/dashboard'); handleUserMenuClose(); }}>
                    <SettingsIcon size={18} style={{ marginRight: 12 }} />
                    {t('userNav.adminConsole')}
                  </MenuItem>
                )}
                <Divider />
                <MenuItem onClick={() => { handleLogout(); handleUserMenuClose(); }} sx={{ color: 'error.main' }}>
                  <LogOut size={18} style={{ marginRight: 12 }} />
                  {t('common.logout')}
                </MenuItem>
              </Menu>
            </Toolbar>
          </AppBar>
        )}

        {/* 内容区域 */}
        <Box sx={{ 
          flex: 1, 
          display: 'flex',
          flexDirection: 'column',
          overflow: location.pathname === '/chat' ? 'hidden' : 'auto',
          width: '100%',
          minHeight: 0,
          height: 0,
          position: 'relative',
        }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
