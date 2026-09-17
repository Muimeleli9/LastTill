import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const pages = ['index', 'register', 'login', 'auth-callback', 'reset-password', 'onboarding',
  'dashboard', 'budget', 'expense', 'savings', 'emergency', 'tillcheck', 'profile', 'settings'];
export default defineConfig({
  root: 'frontend', envDir: '..', base: './',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../dist', emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(pages.map(page => [page, resolve('frontend', `${page}.html`)])) }
  }
});
