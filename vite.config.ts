import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// 从环境变量获取后端端口，默认 7143
const backendPort = parseInt(process.env.BACKEND_PORT || process.env.PORT || '7143')

export default defineConfig({
  plugins: [
    react(),
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
    minify: 'oxc', // 使用oxc进行代码压缩（最快）
    outDir: 'dist/frontend',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 第三方库
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react';
            }
            if (id.includes('@mui')) {
              return 'vendor-mui';
            }
            if (id.includes('axios') || id.includes('i18next') || id.includes('react-i18next')) {
              return 'vendor-utils';
            }
          }
          // 页面组件
          if (id.includes('/pages/LoginPage.tsx') || id.includes('/pages/RegisterPage.tsx')) {
            return 'page-auth';
          }
          if (id.includes('/pages/UserDashboard.tsx') || id.includes('/pages/UserApiKeysPage.tsx') || id.includes('/pages/UserProfilePage.tsx')) {
            return 'page-user';
          }
          if (id.includes('/pages/AdminDashboard.tsx') || id.includes('/pages/AdminUsersPage.tsx') || id.includes('/pages/AdminModelsPage.tsx')) {
            return 'page-admin';
          }
          if (id.includes('/pages/ModelMarketplace.tsx') || id.includes('/pages/ActionMarketplace.tsx')) {
            return 'page-marketplace';
          }
          if (id.includes('/pages/ActionsPage.tsx') || id.includes('/pages/ActionEditorPage.tsx')) {
            return 'page-actions';
          }
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
