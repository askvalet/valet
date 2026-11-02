// The demo as plain files: Valet's own page, with demo/static/backend.ts answering in place of a server.
import base from '../../vite.config.ts';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';

const here = f => fileURLToPath(new URL(f, import.meta.url));
export default mergeConfig(base, {
  build: { outDir: here('./dist'), emptyOutDir: false },
  define: { 'process.env': '({})', 'process.argv': '([])' },
  plugins: [{
    name: 'valet-demo', enforce: 'pre',
    resolveId(id) { return id.startsWith('node:') ? here('./stub.ts') : null; },
    transform(code, id) { return id.endsWith('src/web/main.tsx') ? `import ${JSON.stringify(here('./backend.ts'))};\n${code}` : null; },
  }],
});
