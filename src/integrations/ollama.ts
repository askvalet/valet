// Ollama: which local models are installed and which are loaded right now (and how much memory they hold).
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';

export default defineIntegration({
  type: 'ollama',
  name: 'Ollama',
  config: z.object({ url: z.string().url(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, '');
    const state = async () => {
      const [tags, ps] = await Promise.all([ctx.http<any>(`${base}/api/tags`), ctx.http<any>(`${base}/api/ps`)]);
      const loaded = new Map<string, any>((ps.models ?? []).map((m: any) => [m.name, m]));
      return (tags.models ?? []).map((m: any) => ({ name: m.name, size: m.size, params: m.details?.parameter_size, quant: m.details?.quantization_level,
        loaded: loaded.has(m.name), vram: loaded.get(m.name)?.size_vram })).sort((a: any, b: any) => Number(b.loaded) - Number(a.loaded) || b.size - a.size);
    };
    return {
      widgets: {
        models: {
          title: 'Ollama', interval: 30_000, card: 'list',
          async fetch() {
            const list = await state(), on = list.filter((m: any) => m.loaded);
            return {
              type: 'list', title: 'Ollama', icon: 'gpu', href: cfg.href, empty: 'No models installed',
              note: on.length ? `${on.length} loaded` : 'idle',
              summary: { label: 'Ollama', icon: 'gpu', value: on.length ? on[0].name : 'Idle', sub: `${list.length} models`, tone: on.length ? 'accent' : 'neutral' },
              buttons: on.map((m: any) => ({ label: `Unload ${m.name}`, action: 'unload', args: { model: m.name } })),
              items: list.map((m: any) => ({ title: m.name, subtitle: [m.params, m.quant, fmt.bytes(m.size)].filter(Boolean).join(' · '),
                meta: m.loaded ? `loaded · ${fmt.bytes(m.vram ?? 0)} VRAM` : '', tone: m.loaded ? 'accent' : 'neutral' })),
            };
          },
        },
      },
      actions: {
        unload: { description: 'Unload a model from memory', input: z.object({ model: z.string() }),
          run: ({ model }) => ctx.http(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }) },
      },
      tools: {
        ollama_unload: {
          label: 'Unloaded a model',
          confirm: ({ model }) => ({ title: `Unload ${model}?`, detail: 'Frees its memory until it is next used', icon: 'gpu', verb: 'Unload' }),
          description: 'Unload a model from Ollama\'s memory, freeing its VRAM.',
          access: 'control', input: z.object({ model: z.string() }),
          async run({ model }) {
            await ctx.http(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) });
            return { data: { unloaded: model }, card: { type: 'text', tone: 'good', text: `Unloaded ${model}.` } };
          },
        },
        ollama_models: {
          label: 'Checked models',
          description: 'Models installed in Ollama, their size, and which are loaded in memory now.',
          access: 'read', input: z.object({}),
          async run() { return { data: await state() }; },
        },
      },
    };
  },
});
