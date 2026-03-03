import { useState } from 'react';
import {
  AppBar,
  Box,
  Container,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Badge,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Inbox,
  Settings,
  Cable,
  Settings2,
  Key,
} from 'lucide-react';
import { useServer } from '../contexts/ServerContext';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}

const DRAWER_WIDTH = 280;

export default function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isSmall = useMediaQuery(theme.breakpoints.down('sm'));
  const { connected, pendingRequests } = useServer();

  const menuItems = [
    { id: 'requests', label: '请求队列', icon: <Inbox size={20} /> },
    { id: 'models', label: '模型管理', icon: <Settings size={20} /> },
    { id: 'apikeys', label: 'API 密钥', icon: <Key size={20} /> },
    { id: 'settings', label: '系统设置', icon: <Settings2 size={20} /> },
  ];

  const pendingCount = pendingRequests.size;

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Typography 
          variant="h6" 
          sx={{ 
            fontWeight: 600,
            color: 'primary.main',
            letterSpacing: '-0.5px',
          }}
        >
          Fake OpenAI Server
        </Typography>
        <Typography variant="caption" color="text.secondary">
          管理控制台
        </Typography>
      </Box>
      <List sx={{ flex: 1, pt: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.id} disablePadding>
            <ListItemButton
              selected={currentPage === item.id}
              onClick={() => {
                onPageChange(item.id);
                setMobileOpen(false);
              }}
            >
              <ListItemIcon>
                {item.id === 'requests' ? (
                  <Badge badgeContent={pendingCount} color="error">
                    {item.icon}
                  </Badge>
                ) : (
                  item.icon
                )}
              </ListItemIcon>
              <ListItemText 
                primary={item.label} 
                primaryTypographyProps={{ fontWeight: 500 }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Box sx={{ p: 2, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1,
          p: 1.5,
          borderRadius: 3,
          backgroundColor: connected ? 'rgba(168, 199, 250, 0.08)' : 'rgba(255, 107, 107, 0.08)',
        }}>
          <Cable size={18} style={{ color: connected ? '#a8c7fa' : '#ff6b6b' }} />
          <Typography 
            variant="body2" 
            sx={{ 
              color: connected ? 'primary.main' : 'error.main',
              fontWeight: 500,
            }}
          >
            {connected ? '已连接' : '未连接'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              backgroundColor: 'background.paper',
            },
          }}
        >
          {drawer}
        </Drawer>
      )}

      {/* 移动端抽屉 */}
      {isMobile && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: DRAWER_WIDTH,
            },
          }}
        >
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
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          minHeight: '100vh',
        }}
      >
        {/* 顶部 AppBar */}
        <AppBar 
          position="sticky"
          elevation={0}
          sx={{
            backgroundColor: 'background.paper',
            color: 'text.primary',
          }}
        >
          <Toolbar>
            {isMobile && (
              <IconButton
                color="inherit"
                edge="start"
                onClick={() => setMobileOpen(!mobileOpen)}
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
                fontSize: isSmall ? '1rem' : '1.25rem',
              }}
            >
              {menuItems.find((item) => item.id === currentPage)?.label || 'Dashboard'}
            </Typography>
            {/* 桌面端连接状态 */}
            {!isMobile && (
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1,
                px: 2,
                py: 0.75,
                borderRadius: 3,
                backgroundColor: connected ? 'rgba(168, 199, 250, 0.08)' : 'rgba(255, 107, 107, 0.08)',
              }}>
                <Cable size={18} style={{ color: connected ? '#a8c7fa' : '#ff6b6b' }} />
                <Typography 
                  variant="body2" 
                  sx={{ 
                    color: connected ? 'primary.main' : 'error.main',
                    fontWeight: 500,
                  }}
                >
                  {connected ? '已连接' : '未连接'}
                </Typography>
              </Box>
            )}
          </Toolbar>
        </AppBar>

        {/* 内容区域 */}
        <Box sx={{ 
          flex: 1, 
          p: { xs: 1.5, sm: 2, md: 3 },
        }}>
          <Container 
            maxWidth="lg" 
            disableGutters={isSmall}
            sx={{ height: '100%' }}
          >
            {children}
          </Container>
        </Box>
      </Box>
    </Box>
  );
}