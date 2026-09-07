import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const proxyConfig = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
  '/health': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
};

const isTunnelMode = process.env.VITE_API_URL !== undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    ...(isTunnelMode ? { allowedHosts: ['.trycloudflare.com'] } : {}),
    proxy: proxyConfig,
  },
  preview: {
    ...(isTunnelMode ? { allowedHosts: ['.trycloudflare.com'] } : {}),
    proxy: proxyConfig,
  },
});
