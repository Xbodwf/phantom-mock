import { useState } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import type { Theme } from '@mui/material';
import { createTheme } from '@mui/material/styles';
import { ServerProvider } from './contexts/ServerContext';
import Layout from './components/Layout';
import RequestList from './components/RequestList';
import ModelManager from './components/ModelManager';
import SettingsPage from './components/SettingsPage';
import ApiKeyManager from './components/ApiKeyManager';

// Material Design 3 风格主题
const darkTheme: Theme = createTheme({
  cssVariables: true,
  colorSchemes: {
    dark: true,
  },
  palette: {
    mode: 'dark',
    primary: {
      main: '#a8c7fa',
      contrastText: '#001f2e',
    },
    secondary: {
      main: '#d1e8ff',
      contrastText: '#001d35',
    },
    background: {
      default: '#0b0d10',
      paper: '#14161a',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
    h6: {
      fontWeight: 500,
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          textTransform: 'none',
          fontWeight: 500,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundImage: 'none',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: 16,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 12,
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 28,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 28,
          margin: '4px 12px',
          '&.Mui-selected': {
            backgroundColor: 'rgba(168, 199, 250, 0.16)',
          },
        },
      },
    },
  },
});

function AppContent() {
  const [currentPage, setCurrentPage] = useState('requests');

  const renderPage = () => {
    switch (currentPage) {
      case 'requests':
        return <RequestList />;
      case 'models':
        return <ModelManager />;
      case 'apikeys':
        return <ApiKeyManager />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <RequestList />;
    }
  };

  return (
    <Layout currentPage={currentPage} onPageChange={setCurrentPage}>
      {renderPage()}
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <ServerProvider>
        <AppContent />
      </ServerProvider>
    </ThemeProvider>
  );
}

export default App;