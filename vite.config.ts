import { resolve } from 'node:path';
import process from 'node:process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        // Splat-runtime bench used to settle DWEA-55 (OD-3).
        bench: resolve(__dirname, 'bench.html'),
      },
    },
  },
});
