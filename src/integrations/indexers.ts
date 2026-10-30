// Prowlarr and Bazarr: the plumbing behind downloads. Which indexers are failing (and until when they're paused), and
// how many episodes and movies are still missing subtitles.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

export default defineIntegration({
  type: 'indexers',
  name: 'Prowlarr / Bazarr',
  config: z.object({
    prowlarr: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }).optional(),
    bazarr: z.object({ url: z.string().url(), apiKey: z.string(), href: z.string().optional() }).optional(),
  }),
  create(cfg, ctx) {
    async function state() {
      const out: { indexers?: { name: string; ok: boolean; until?: string }[]; subs?: { episodes: number; movies: number; providers: number } } = {};
      if (cfg.prowlarr) {
        const p = cfg.prowlarr, h = { 'X-Api-Key': p.apiKey }, b = p.url.replace(/\/$/, '');
        const [list, status] = await Promise.all([ctx.http<any[]>(`${b}/api/v1/indexer`, { headers: h }), ctx.http<any[]>(`${b}/api/v1/indexerstatus`, { headers: h })]);
        const failing = new Map(status.filter(s => s.disabledTill && Date.parse(s.disabledTill) > Date.now()).map(s => [s.indexerId, s.disabledTill]));
        out.indexers = list.filter(i => i.enable).map(i => ({ name: i.name, ok: !failing.has(i.id), until: failing.get(i.id) }));
      }
      if (cfg.bazarr) {
        const z = cfg.bazarr;
        const b = await ctx.http<any>(`${z.url.replace(/\/$/, '')}/api/badges`, { headers: { 'X-API-KEY': z.apiKey } });
        out.subs = { episodes: b.episodes ?? 0, movies: b.movies ?? 0, providers: b.providers ?? 0 };
      }
      return out;
    }
    const until = (iso?: string) => iso ? `paused till ${new Date(iso).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}` : 'failing';
    return {
      widgets: {
        health: {
          title: 'Indexers', interval: 900_000,
          async fetch() {
            const s = await state(), bad = s.indexers?.filter(i => !i.ok) ?? [], missing = (s.subs?.episodes ?? 0) + (s.subs?.movies ?? 0);
            return {
              type: 'status', title: 'Indexers', icon: 'search', href: cfg.prowlarr?.href ?? cfg.prowlarr?.url,
              note: s.subs ? (missing ? `${missing} missing subtitles` : 'subtitles complete') : undefined,
              summary: { label: 'Indexers', icon: 'search', value: s.indexers ? `${s.indexers.length - bad.length}/${s.indexers.length}` : '–', tone: bad.length ? 'warn' : 'good',
                sub: bad.length ? `${bad.map(b => b.name).join(', ')} failing` : 'All working', detail: s.subs ? (missing ? `${missing} subs missing` : 'subs complete') : undefined },
              items: (s.indexers ?? []).map(i => ({ name: i.name, ok: i.ok, detail: i.ok ? undefined : until(i.until), quiet: !i.ok })),
              buttons: bad.length && cfg.prowlarr ? [{ label: 'Test again', action: 'retest' }] : undefined,
            };
          },
        },
      },
      actions: {
        retest: { description: 'Test every indexer again', input: z.object({}),
          run: () => ctx.http(`${cfg.prowlarr!.url.replace(/\/$/, '')}/api/v1/indexer/testall`, { method: 'POST', headers: { 'X-Api-Key': cfg.prowlarr!.apiKey }, as: 'response' }) },
      },
      tools: {
        indexers_retest: {
          description: 'Ask Prowlarr to test every indexer again (clears failures that have recovered).',
          access: 'control', input: z.object({}),
          async run() {
            if (!cfg.prowlarr) return { data: { error: 'Prowlarr is not configured' } };
            await ctx.http(`${cfg.prowlarr.url.replace(/\/$/, '')}/api/v1/indexer/testall`, { method: 'POST', headers: { 'X-Api-Key': cfg.prowlarr.apiKey }, as: 'response' });
            const s = await state();
            return { data: s, card: { type: 'status', title: 'Indexers', icon: 'search', items: (s.indexers ?? []).map(i => ({ name: i.name, ok: i.ok })) } };
          },
        },
        indexer_health: {
          description: 'Which torrent indexers (Prowlarr) are working or failing, and how many episodes/movies still lack subtitles (Bazarr). Use when downloads aren\'t being found.',
          access: 'read', input: z.object({}),
          async run() { return { data: await state() }; },
        },
      },
    };
  },
});
