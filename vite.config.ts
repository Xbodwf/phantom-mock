import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import reactSwc from '@vitejs/plugin-react-swc'
import legacy from '@vitejs/plugin-legacy'

// 从环境变量获取后端端口，默认 7143
const backendPort = parseInt(process.env.BACKEND_PORT || process.env.PORT || '7143')

// 编译器选择：通过环境变量 VITE_REACT_COMPILER 切换
// - 'swc' (默认): 使用 @vitejs/plugin-react-swc (SWC，更快)
// - 'babel': 使用 @vitejs/plugin-react (Babel)
const reactCompiler = process.env.VITE_REACT_COMPILER || 'swc'

export default defineConfig({
  plugins: [
    reactCompiler === 'swc' ? reactSwc() : react(),
    legacy({
      targets: ['Chrome >= 90'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  root: '.',
  publicDir: 'public',
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    cors: true,
    allowedHosts: 'all',
    // 将所有非前端请求代理到后端
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/v1': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/v1beta': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
        changeOrigin: true,
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
