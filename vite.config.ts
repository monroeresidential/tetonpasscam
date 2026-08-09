import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// PWA plugin (vite-plugin-pwa) is wired up in a later task (SEO shell + PWA + offline).
export default defineConfig({
  root: '.',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
});
