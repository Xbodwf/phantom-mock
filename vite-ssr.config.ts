import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import reactSwc from '@vitejs/plugin-react-swc'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    reactSwc(),
    legacy({
      targets: ['Chrome >= 90'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  root: '.',
  publicDir: 'public',
  
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material'],
          'vendor-utils': ['axios', 'i18next', 'react-i18next'],
        },
      },
      onwarn(warning, warn) {
        if (warning.code === 'UNUSED_EXTERNAL_IMPORT') {
          return
        }
        warn(warning)
      },
    },
  },
  
  resolve: {
    alias: {
      '@': '/src/frontend',
    },
  },
})