// Speedtest Tracker: the latest result as the headline, and download and upload over the last days as a chart, with
// ping and any failed runs beside it. The assistant can read the history and, with write access, run a test now.
// API v1 (Speedtest Tracker 1.x): a token with "Read results", and "Run speedtest" for the second.
import { z } from 'zod';
import { bounded, defineIntegration, fmt } from '../server/core.ts';
import { Every } from '../server/config.ts';
import type { ChartCard, StatItem, Summary } from '../shared/cards.ts';

interface Result { id: number; at: number; down?: number; up?: number; ping?: number; status: string; healthy?: boolean | null; server?: string; isp?: string }

const n = (v: unknown) => v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);
const mbps = (v?: number) => v == null ? '–' : `${Math.round(v)} Mbps`;
const ms = (v?: number) => v == null ? '–' : `${Math.round(v)} ms`;
// bytes a second, except where it already says bits
const bits = (raw: any, key: 'download' | 'upload') => { const b = n(raw?.[`${key}_bits`]); if (b != null) return b / 1e6; const v = n(raw?.[key]); return v == null ? undefined : v * 8 / 1e6; };
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
/** At most `max` points, each the mean of its share of the runs: a month of tests every ten minutes still reads. */
function thin(list: Result[], max = 120) {
  if (list.length <= max) return list;
  const size = list.length / max;
  return Array.from({ length: max }, (_, i) => {
    const part = list.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    const mean = (k: 'down' | 'up' | 'ping') => avg(part.flatMap(r => r[k] != null ? [r[k]!] : []));
    return { ...part.at(-1)!, down: mean('down'), up: mean('up'), ping: mean('ping') };
  });
}

export default defineIntegration({
  type: 'speedtest-tracker',
  name: 'Speedtest Tracker',
  config: z.object({
    url: z.string().url(), href: z.string().optional(), every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(),
    key: z.string(),                                                   // an API token (Settings, API tokens) that can read results
    days: z.number().int().min(1).max(90).default(7),                  // how far back the chart goes
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), href = cfg.href ?? cfg.url, insecure = cfg.insecure === true;
    const every = Every.safeParse(cfg.every ?? 60).data ?? 60_000;
    const source = { name: 'Speedtest Tracker', icon: '/api/icon/speedtest-tracker' };
    async function api(path: string, method: 'GET' | 'POST' = 'GET') {
      const r = await ctx.http<Response>(`${base}/api/v1/${path}`, { as: 'response', method, insecure, timeout: 15_000, headers: { Accept: 'application/json', Authorization: `Bearer ${cfg.key}` } });
      if (r.status === 404 && path === 'results/latest') return null;   // no result yet
      if (!r.ok) throw new Error(`Speedtest Tracker answered ${r.status}${r.status === 401 ? ': is the token right?' : r.status === 403 ? ': the token lacks that ability' : ''}`);
      return JSON.parse(await bounded(r) || '{}');
    }
    const parse = (raw: any): Result => ({ id: n(raw?.id) ?? 0, at: new Date(raw?.created_at ?? raw?.updated_at ?? 0).getTime(), down: bits(raw, 'download'), up: bits(raw, 'upload'), ping: n(raw?.ping),
      status: String(raw?.status ?? 'completed').toLowerCase(), healthy: raw?.healthy, server: raw?.data?.server?.name, isp: raw?.data?.isp });
    // the docs show it bare, older versions wrapped it in `data`
    const latest = async () => { const j = await api('results/latest'); const raw = j?.data && !Array.isArray(j.data) && j.data.id != null ? j.data : j; return raw?.id != null ? parse(raw) : undefined; };
    async function history(days: number) {
      const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const j = await api(`results?${new URLSearchParams({ 'filter[start_at]': from, sort: '-created_at', 'per.page': '500' })}`);
      return (Array.isArray(j?.data) ? j.data : []).map(parse).filter((r: Result) => Number.isFinite(r.at)).sort((a: Result, b: Result) => a.at - b.at) as Result[];
    }
    const good = (r: Result) => r.status === 'completed' && r.down != null;
    const line = (r: Result) => `↑ ${mbps(r.up)} · ${ms(r.ping)}`;

    function chart(list: Result[], days: number): ChartCard {
      const done = list.filter(good), last = done.at(-1), failed = list.filter(r => r.status === 'failed').length, points = thin(done);
      const pings = done.flatMap(r => r.ping != null ? [r.ping] : []), slow = last?.healthy === false;
      const summary: Summary = last ? { label: 'Internet speed', icon: 'chart', value: mbps(last.down), sub: line(last), tone: list.at(-1)?.status === 'failed' ? 'bad' : slow ? 'warn' : 'good', trend: points.map(r => Math.round(r.down ?? 0)) }
        : { label: 'Internet speed', icon: 'chart', value: 'No tests yet' };
      return { type: 'chart', style: 'line', title: 'Internet speed', icon: 'chart', href, source, unit: 'Mbps',
        headline: last ? mbps(last.down) : undefined, span: last ? line(last) : undefined, window: `last ${days === 1 ? '24 h' : `${days} days`}`,
        ...(points.length ? { from: points[0].at, to: points.at(-1)!.at } : {}),
        series: [{ name: 'Download', tone: 'accent', points: points.map(r => Math.round(r.down ?? 0)) }, { name: 'Upload', points: points.map(r => Math.round(r.up ?? 0)) }],
        facts: [...(pings.length ? [{ label: 'Ping', value: `${ms(Math.min(...pings))} to ${ms(Math.max(...pings))}` }] : []), ...(done.length ? [{ label: 'Average', value: `${mbps(avg(done.map(r => r.down!)))} ↓ · ${mbps(avg(done.flatMap(r => r.up != null ? [r.up] : [])))} ↑` }] : []),
          ...(failed ? [{ label: 'Failed', value: String(failed) }] : []), ...(slow ? [{ label: 'Below your benchmark' }] : [])],
        summary };
    }
    const DAYS = z.object({ days: z.number().int().min(1).max(90).optional().describe('how far back, 7 by default') });

    return {
      widgets: {
        status: {
          title: 'Speedtest Tracker', interval: every, card: 'stats',
          async fetch() {
            const t = await latest(), items: StatItem[] = [{ label: 'Download', value: mbps(t?.down) }, { label: 'Upload', value: mbps(t?.up) }, { label: 'Ping', value: ms(t?.ping) }];
            return { type: 'stats', title: 'Speedtest Tracker', icon: 'chart', href, source, items, summary: { label: 'Speedtest Tracker', icon: 'chart', value: items[0].value, sub: 'Download' } };
          },
        },
        speed: { title: 'Internet speed', interval: Math.max(every, 300_000), fetch: async () => chart(await history(cfg.days), cfg.days) },
      },
      tools: {
        speed_history: {
          label: 'Checked the internet speed', followUps: ['Is it slower than usual?'],
          description: 'Internet speed tests from Speedtest Tracker: the latest result, and download, upload and ping over the last days (7 by default), with averages, the slowest run and any failed runs. Speeds are in Mbps. Use for "is the internet slow", "how fast is my connection", "has it been dropping".',
          access: 'read', input: DAYS,
          async run({ days = cfg.days }) {
            const list = await history(days), done = list.filter(good), last = done.at(-1), slowest = [...done].sort((a, b) => a.down! - b.down!)[0];
            const at = (r?: Result) => r && new Date(r.at).toISOString();
            return { data: { latest: last && { at: at(last), download: mbps(last.down), upload: mbps(last.up), ping: ms(last.ping), server: last.server, isp: last.isp, belowBenchmark: last.healthy === false || undefined },
              tests: list.length, failed: list.filter(r => r.status === 'failed').length, averageDownload: mbps(avg(done.map(r => r.down!))), averageUpload: mbps(avg(done.flatMap(r => r.up != null ? [r.up] : []))),
              averagePing: ms(avg(done.flatMap(r => r.ping != null ? [r.ping] : []))), slowest: slowest && { at: at(slowest), download: mbps(slowest.down) } }, card: chart(list, days) };
          },
        },
        speedtest_run: {
          label: 'Ran a speed test',
          confirm: () => ({ title: 'Run a speed test now?', detail: 'Speedtest Tracker fills your connection for about half a minute. The result shows up when it finishes.', verb: 'Run', logo: '/api/icon/speedtest-tracker' }),
          description: 'Start a speed test in Speedtest Tracker now. It queues the test and returns at once; the result takes about a minute: read speed_history afterwards.',
          access: 'write', input: z.object({}),
          async run() {
            const j = await api('speedtests/run', 'POST');
            return { data: { queued: true, id: j?.data?.id, status: j?.data?.status }, card: { type: 'text', tone: 'good', text: 'Speed test started. It takes about a minute.' } };
          },
        },
      },
    };
  },
});
