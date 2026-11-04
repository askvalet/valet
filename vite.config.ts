import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The service worker carries the build's version (a hash of every file the build wrote, whose names are hashes of
// their contents), so each new build is a new worker and browsers swap to it on the next visit.
const worker = (): Plugin => {
  const source = () => readFileSync(fileURLToPath(new URL('./src/web/sw.js', import.meta.url)), 'utf8');
  return {
    name: 'valet-sw',
    configureServer(server) { server.middlewares.use('/sw.js', (_, res) => { res.setHeader('Content-Type', 'text/javascript'); res.end(source().replaceAll('__VERSION__', 'dev')); }); },
    generateBundle(_, bundle) {
      const version = createHash('sha256').update(Object.keys(bundle).sort().join()).update(source()).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source().replaceAll('__VERSION__', version) });
    },
  };
};

export default defineConfig({
  root: 'src/web',
  publicDir: '../../public',
  plugins: [react(), tailwindcss(), worker()],
  // appearance.font.scale: text is sized in px all over, so every size is written once here as a multiple of one variable
  css: { postcss: { plugins: [{ postcssPlugin: 'font-scale', Declaration: { 'font-size': d => { if (!/(^|[^r])em\b|%|inherit|var\(--font-scale/.test(d.value)) d.value = `calc(${d.value} * var(--font-scale, 1))`; } } }] } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
  build: { outDir: '../../dist/web', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:7575' } },
});
