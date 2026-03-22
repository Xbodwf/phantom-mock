import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 从环境变量获取后端端口，默认 7143
const backendPort = parseInt(process.env.BACKEND_PORT || process.env.PORT || '7143')

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  server: {
    host: "0.0.0.0",
    port: 5173,
    // 将所有非前端请求代理到后端
    proxy: {
      '/api': `http://localhost:${backendPort}`,
      '/v1': `http://localhost:${backendPort}`,
      '/v1beta': `http://localhost:${backendPort}`,
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/frontend',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // 第三方库
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material'],
          'vendor-utils': ['axios', 'i18next', 'react-i18next'],

          // 页面组件
          'page-auth': ['./src/frontend/pages/LoginPage.tsx', './src/frontend/pages/RegisterPage.tsx'],
          'page-user': ['./src/frontend/pages/UserDashboard.tsx', './src/frontend/pages/UserApiKeysPage.tsx', './src/frontend/pages/UserProfilePage.tsx'],
          'page-admin': ['./src/frontend/pages/AdminDashboard.tsx', './src/frontend/pages/AdminUsersPage.tsx', './src/frontend/pages/AdminModelsPage.tsx'],
          'page-marketplace': ['./src/frontend/pages/ModelMarketplace.tsx', './src/frontend/pages/ActionMarketplace.tsx'],
          'page-actions': ['./src/frontend/pages/ActionsPage.tsx', './src/frontend/pages/ActionEditorPage.tsx'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src/frontend',
    },
  },
})
