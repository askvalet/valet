// Stocks, indices, currencies and crypto through Yahoo Finance's chart endpoint (no key): price, day change and the
// day's line behind each.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';
import type { StatItem } from '../shared/cards.ts';

export default defineIntegration({
  type: 'markets',
  name: 'Markets',
  config: z.object({
    // "AAPL", "BTC-USD", "^GSPC", "EURUSD=X", or { symbol, name } to label one
    symbols: z.array(z.union([z.string(), z.object({ symbol: z.string(), name: z.string().optional() })])).min(1)
      .transform(s => s.map(x => typeof x === 'string' ? { symbol: x } : x)),
    range: z.enum(['1d', '5d', '1mo', '6mo', '1y']).default('1d'),
    title: z.string().default('Markets'),
  }),
  create(cfg, ctx) {
    const interval = { '1d': '15m', '5d': '1h', '1mo': '1d', '6mo': '1d', '1y': '1wk' }[cfg.range];
    interface Quote { symbol: string; name: string; price: number; change: number; pct: number; currency: string; points: number[] }
    async function quotes(): Promise<Quote[]> {
      return (await Promise.all(cfg.symbols.map(async s => {
        try {
          const r = await ctx.http<any>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.symbol)}?range=${cfg.range}&interval=${interval}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Valet)' }, timeout: 10_000 });
          const res = r.chart?.result?.[0], m = res?.meta;
          if (!m) throw new Error(r.chart?.error?.description ?? 'no data');
          const closes = ((res.indicators?.quote?.[0]?.close ?? []) as (number | null)[]).filter((x): x is number => x != null);
          const price = m.regularMarketPrice as number, prev = (cfg.range === '1d' ? m.chartPreviousClose ?? m.previousClose : closes[0]) ?? price;
          return [{ symbol: s.symbol, name: s.name ?? m.shortName ?? s.symbol, price, change: price - prev, pct: prev ? (price - prev) / prev : 0, currency: m.currency ?? '', points: closes }];
        } catch (e) { ctx.log(`${s.symbol}: ${(e as Error).message}`); return []; }
      }))).flat();
    }
    const money = (q: Quote) => q.price >= 1000 ? q.price.toLocaleString('en', { maximumFractionDigits: 0 }) : q.price.toLocaleString('en', { maximumFractionDigits: q.price < 1 ? 4 : 2 });
    const signed = (q: Quote) => `${q.pct >= 0 ? '+' : ''}${(q.pct * 100).toFixed(2)}%`;
    const item = (q: Quote): StatItem => ({ label: q.name, value: money(q), unit: q.currency === 'USD' ? '$' : q.currency, sub: signed(q), tone: q.pct > 0 ? 'good' : q.pct < 0 ? 'bad' : 'neutral', trend: q.points });
    return {
      widgets: {
        quotes: {
          title: cfg.title, interval: 300_000,
          async fetch() {
            const list = await quotes();
            if (!list.length) throw new Error('no quotes (is Yahoo reachable?)');
            return { type: 'stats', title: cfg.title, icon: 'chart', items: list.map(item),
              summaries: list.slice(0, 4).map(q => ({ label: q.name, icon: 'chart', value: money(q), sub: signed(q), tone: q.pct > 0 ? 'good' as const : q.pct < 0 ? 'bad' as const : 'neutral' as const, trend: q.points })) };
          },
        },
      },
      tools: {
        market_quotes: {
          label: 'Checked the markets',
          followUps: ['How did it do this week?'],
          description: `Current price and day change for ${cfg.symbols.map(s => s.name ?? s.symbol).join(', ')}.`,
          access: 'read', input: z.object({}),
          async run() {
            const list = await quotes();
            return { data: list.map(q => ({ symbol: q.symbol, name: q.name, price: q.price, currency: q.currency, change: Number(q.change.toFixed(2)), changePct: Number((q.pct * 100).toFixed(2)) })),
              card: { type: 'stats', title: cfg.title, icon: 'chart', items: list.map(item) } };
          },
        },
      },
    };
  },
});
