// A verse of the day from a self-hosted Quran site (the static app's data/ folder): the Arabic, its English (Clear
// Quran), the surah and verse. One verse a day, the same for everyone that day; mid-passage fragments are skipped in
// favour of verses that read well on their own.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';

type Surah = { n: number; ar: string; en: string; meaning: string; verses: number };

export default defineIntegration({
  type: 'quran',
  name: 'Quran',
  config: z.object({ url: z.string().url(), href: z.string().optional() }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), web = (cfg.href ?? base).replace(/\/$/, '');
    let index: Surah[] | null = null;
    // the index stays; surah files are kept for the last few looked at (the whole Quran would be tens of MB in memory)
    const cache = new Map<string, any>();
    const get = async (path: string) => {
      if (cache.has(path)) { const v = cache.get(path); cache.delete(path); cache.set(path, v); return v; }
      const v = await ctx.http(`${base}/data/${path}`, { timeout: 15_000 });
      cache.set(path, v);
      for (const k of cache.keys()) { if (cache.size <= 9) break; if (k !== 'index.json') cache.delete(k); }
      return v;
    };
    // the word segments carry tajweed markup; keep the letters, drop verse-end glyphs from the private-use area
    const arabic = (words: any[]) => words.map(w => w.map((seg: any[]) => seg[0]).join('')).join(' ').replace(/[-]/g, '').replace(/\s*[ۖ-ۭ]+\s*$/u, '').trim();

    async function verse(s: number, v: number) {
      index ??= (await get('index.json')).surahs as Surah[];
      const [ar, en] = await Promise.all([get(`s/${s}.json`), get(`en/${s}.json`)]);
      const row = (ar as any[]).find(x => x[0] === v);
      return { surah: index.find(x => x.n === s)!, n: v, arabic: row ? arabic(row[1]) : '', english: String(en.v?.[v - 1] ?? '') };
    }
    async function today() {
      index ??= (await get('index.json')).surahs as Surah[];
      const total = index.reduce((t, s) => t + s.verses, 0);
      const d = new Date(), seed = d.getFullYear() * 1000 + Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 864e5);
      let k = Math.floor(Math.abs(Math.sin(seed) * 1e6)) % total;
      for (let tries = 0; tries < 300; tries++, k = (k + 97) % total) {
        let left = k, s = index[0];
        for (const x of index) { if (left < x.verses) { s = x; break; } left -= x.verses; }
        const v = await verse(s.n, left + 1);
        // reads on its own: a whole sentence of a comfortable length
        if (v.english.length >= 70 && v.english.length <= 240 && /^[A-Z“"˹]/.test(v.english) && /[.!?”"˺]$/.test(v.english.trim())) return v;
      }
      return verse(1, 1);
    }
    const card = (v: Awaited<ReturnType<typeof verse>>, title = 'Verse of the day') => ({
      type: 'verse' as const, title, icon: 'book', href: `${web}/#/${v.surah.n}/${v.n}`,
      arabic: v.arabic, english: v.english, reference: `${v.surah.en} ${v.surah.n}:${v.n}`, meaning: v.surah.meaning,
      summary: { label: 'Verse of the day', icon: 'book', value: `${v.surah.n}:${v.n}`, sub: v.surah.en },
    });
    return {
      widgets: {
        today: { title: 'Verse of the day', interval: 3_600_000, async fetch() { return card(await today()); } },
      },
      tools: {
        quran_verse: {
          description: 'A verse of the Quran with its English meaning (Clear Quran): a given surah and verse, or today\'s verse when none is given.',
          access: 'read', input: z.object({ surah: z.number().int().min(1).max(114).optional(), verse: z.number().int().min(1).optional() }),
          async run({ surah, verse: n }) {
            const v = surah ? await verse(surah, n ?? 1) : await today();
            return { data: { reference: `${v.surah.en} ${v.surah.n}:${v.n}`, arabic: v.arabic, english: v.english }, card: card(v, surah ? `${v.surah.en} ${v.surah.n}:${v.n}` : undefined) };
          },
        },
      },
    };
  },
});
