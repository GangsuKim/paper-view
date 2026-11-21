import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDemo = mode === 'demo' || env.VITE_DEMO_MODE === 'true';
  const apiTarget = `http://127.0.0.1:${env.PAPERVIEW_PORT || '8787'}`;

  const rollupOutput = {
    assetFileNames: (assetInfo: { name?: string }) => {
      if (assetInfo.name && assetInfo.name.endsWith('.mjs')) {
        return 'assets/[name]-[hash].js';
      }
      return 'assets/[name]-[hash][extname]';
    },
  };

  return {
    plugins: [react()],
    ...(isDemo
      ? {
          base: './',
          define: {
            'import.meta.env.VITE_DEMO_MODE': JSON.stringify('true'),
          },
          build: {
            outDir: '../docs',
            emptyOutDir: false,
            rollupOptions: { output: rollupOutput },
          },
        }
      : {
          build: {
            rollupOptions: { output: rollupOutput },
          },
        }),
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/demo-data': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
