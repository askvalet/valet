import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  publicDir: '../../public',
  plugins: [react(), tailwindcss()],
  // appearance.font.scale: text is sized in px all over, so every size is written once here as a multiple of one variable
  css: { postcss: { plugins: [{ postcssPlugin: 'font-scale', Declaration: { 'font-size': d => { if (!/(^|[^r])em\b|%|inherit|var\(--font-scale/.test(d.value)) d.value = `calc(${d.value} * var(--font-scale, 1))`; } } }] } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
  build: { outDir: '../../dist/web', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:7575' } },
});
