import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH lets GitHub Pages serve the app from /<repo>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ttf,woff2,wasm,bcmap,pfb}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
      manifest: {
        name: 'PDF Editor',
        short_name: 'PDF Editor',
        description: 'Edit, fill and sign PDFs in your browser. Files never leave your device.',
        theme_color: '#1f2937',
        background_color: '#f3f4f6',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
