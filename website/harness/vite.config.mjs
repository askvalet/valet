// Valet's real cards, built on their own for the screenshots. This lives outside src/web on purpose: Valet's vite.config.ts
// has one entry, src/web/index.html, so nothing here can reach a production build.
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const at = p => fileURLToPath(new URL(p, import.meta.url));
export default {
  root: at('.'),
  publicDir: false,
  plugins: [react(), tailwindcss()],
  // the same font-scale step as vite.config.ts, or text sizes come out different
  css: { postcss: { plugins: [{ postcssPlugin: 'font-scale', Declaration: { 'font-size': d => { if (!/(^|[^r])em\b|%|inherit|var\(--font-scale/.test(d.value)) d.value = `calc(${d.value} * var(--font-scale, 1))`; } } }] } },
  resolve: { alias: { '@': at('../../src/web') } },
  build: { outDir: at('../.cache/harness'), emptyOutDir: true, target: 'es2022', minify: false, chunkSizeWarningLimit: 4000 },
};
