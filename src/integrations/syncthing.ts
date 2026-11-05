// Syncthing: each folder with its state and how complete it is, each device connected or not and how far behind,
// anything out of sync first. The assistant can read it, and with write access ask for a folder to be rescanned.
// /rest/db/status is the expensive call (Syncthing's docs say so), so the folders card refreshes every couple of minutes.
import { z } from 'zod';
import { bounded, defineIntegration, fmt } from '../server/core.ts';
import { tally } from '../server/service.ts';
import { Every } from '../server/config.ts';
import type { ListItem, Tone } from '../shared/cards.ts';

interface Folder { id: string; label: string; path?: string; paused: boolean; state: string; global: number; inSync: number; need: number; needFiles: number; errors: number; localChanges: number; files: number; error?: string }
interface Device { id: string; name: string; connected: boolean; paused: boolean; completion?: number; need?: number; lastSeen?: number; address?: string }

const n = (v: unknown) => Number(v) || 0;
const ago = (t: number) => fmt.ago(t);
const BUSY = new Set(['syncing', 'sync-preparing', 'scanning', 'scan-waiting', 'sync-waiting', 'cleaning', 'clean-waiting']);
// Syncthing says "never" with the zero time
const seen = (t: unknown) => { const v = new Date(String(t ?? '')).getTime(); return Number.isFinite(v) && v > 0 && new Date(v).getUTCFullYear() > 1970 ? v : undefined; };

function folderTone(f: Folder): Tone | undefined {
  if (f.paused) return undefined;
  if (f.state === 'error' || f.errors) return 'bad';
  if (f.need || f.localChanges) return 'warn';
  return undefined;
}
function folderWords(f: Folder) {
  if (f.paused) return 'Paused';
  if (f.state === 'error') return f.error ? `Error: ${f.error.slice(0, 100)}` : 'Error';
  if (f.errors) return `${f.errors.toLocaleString('en')} file${f.errors === 1 ? '' : 's'} failed to sync`;
  if (f.state === 'syncing' || f.state === 'sync-preparing') return `Syncing · ${fmt.bytes(f.need)} to go`;
  if (f.state.startsWith('scan')) return 'Scanning';
  if (f.need) return `Out of sync · ${fmt.bytes(f.need)} to go`;
  if (f.localChanges) return `${f.localChanges.toLocaleString('en')} local change${f.localChanges === 1 ? '' : 's'} not sent`;
  return `Up to date · ${f.files.toLocaleString('en')} files`;
}
const pctOf = (f: Folder) => f.global > 0 ? Math.min(Math.max(f.inSync / f.global, 0), 1) : 1;

export default defineIntegration({
  type: 'syncthing',
  name: 'Syncthing',
  config: z.object({
    url: z.string().url(), href: z.string().optional(), every: z.union([z.string(), z.number()]).optional(), insecure: z.boolean().optional(),
    key: z.string(),                                                   // Actions, Settings, API key
  }),
  create(cfg, ctx) {
    const base = cfg.url.replace(/\/$/, ''), href = cfg.href ?? cfg.url, insecure = cfg.insecure === true;
    const every = Every.safeParse(cfg.every ?? 60).data ?? 60_000;
    const source = { name: 'Syncthing', icon: '/api/icon/syncthing' };
    async function api<T = any>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
      const r = await ctx.http<Response>(`${base}/rest/${path}`, { as: 'response', method, insecure, timeout: 15_000, headers: { Accept: 'application/json', 'X-API-Key': cfg.key } });
      if (!r.ok) throw new Error(`Syncthing answered ${r.status}${r.status === 403 || r.status === 401 ? ': is the API key right?' : ''}`);
      const text = await bounded(r);
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const list = (v: unknown): any[] => Array.isArray(v) ? v : [];

    // the cheap half: what's configured and who's connected
    async function overview() {
      const [folders, devices, connections, status] = await Promise.all([api<any[]>('config/folders'), api<any[]>('config/devices'), api<any>('system/connections'), api<any>('system/status').catch(() => undefined)]);
      return { folders: list(folders), devices: list(devices).filter(d => d.deviceID !== status?.myID), connections: connections ?? {} };
    }
    let cached: { at: number; p: Promise<{ folders: Folder[]; devices: Device[]; moved: number }> } | undefined;
    function load() {
      if (cached && Date.now() - cached.at < 20_000) return cached.p;
      const p = (async () => {
        const o = await overview(), conns = o.connections.connections ?? {};
        const stats = await api<Record<string, any>>('stats/device').catch(() => ({}) as Record<string, any>);
        const folders = await Promise.all(o.folders.map(async (f): Promise<Folder> => {
          const s = f.paused ? undefined : await api<any>(`db/status?folder=${encodeURIComponent(String(f.id))}`).catch(() => undefined);
          return { id: String(f.id), label: String(f.label || f.id), path: f.path, paused: !!f.paused, state: String(s?.state ?? (f.paused ? 'paused' : 'unknown')), global: n(s?.globalBytes), inSync: n(s?.inSyncBytes), need: n(s?.needBytes),
            needFiles: n(s?.needFiles), errors: n(s?.pullErrors), localChanges: n(s?.receiveOnlyChangedFiles), files: n(s?.globalFiles), error: s?.error || undefined };
        }));
        const devices = await Promise.all(o.devices.map(async (d): Promise<Device> => {
          const id = String(d.deviceID), c = conns[id] ?? {};
          const done = c.connected ? await api<any>(`db/completion?device=${encodeURIComponent(id)}`).catch(() => undefined) : undefined;
          return { id, name: String(d.name || id.slice(0, 7)), connected: !!c.connected, paused: !!(d.paused || c.paused), completion: done ? n(done.completion) / 100 : undefined, need: done ? n(done.needBytes) : undefined,
            lastSeen: c.connected ? undefined : seen(stats?.[id]?.lastSeen), address: c.connected ? c.address : undefined };
        }));
        return { folders, devices, moved: n(o.connections.total?.inBytesTotal) + n(o.connections.total?.outBytesTotal) };
      })();
      cached = { at: Date.now(), p };
      p.catch(() => { if (cached?.p === p) cached = undefined; });
      return p;
    }

    const devTone = (d: Device): Tone | undefined => d.paused ? undefined : !d.connected ? 'warn' : (d.completion ?? 1) < 1 ? 'warn' : undefined;
    const devWords = (d: Device) => d.paused ? 'Paused' : !d.connected ? `Disconnected${d.lastSeen ? ` · last seen ${ago(d.lastSeen)}` : ''}` : (d.completion ?? 1) < 1 ? `Connected · ${fmt.bytes(d.need ?? 0)} behind` : 'Connected · up to date';
    const fRank = (f: Folder) => folderTone(f) === 'bad' ? 0 : folderTone(f) ? 1 : f.paused ? 3 : 2;
    const dRank = (d: Device) => devTone(d) ? 0 : d.paused ? 2 : 1;
    function rows(folders: Folder[], devices: Device[]): ListItem[] {
      return [
        ...[...folders].sort((a, b) => fRank(a) - fRank(b) || a.label.localeCompare(b.label)).map(f => ({ id: `f/${f.id}`, section: 'Folders', title: f.label, subtitle: folderWords(f), dot: folderTone(f), tone: folderTone(f),
          ...(!f.paused && pctOf(f) < 1 ? { meta: fmt.pct(pctOf(f)), pct: pctOf(f) } : {}) })),
        ...[...devices].sort((a, b) => dRank(a) - dRank(b) || a.name.localeCompare(b.name)).map(d => ({ id: `d/${d.id}`, section: 'Devices', title: d.name, subtitle: devWords(d), dot: d.connected && !devTone(d) ? 'good' as const : devTone(d),
          ...(d.completion != null && d.completion < 1 ? { meta: fmt.pct(d.completion), pct: d.completion } : {}) })),
      ];
    }
    async function syncCard() {
      const { folders, devices } = await load(), broken = folders.filter(f => folderTone(f) === 'bad'), behind = folders.filter(f => folderTone(f) === 'warn');
      const online = devices.filter(d => d.connected).length, away = devices.filter(d => !d.connected && !d.paused);
      const tone: Tone = broken.length ? 'bad' : behind.length || away.length ? 'warn' : 'good';
      const value = broken.length ? `${broken.length} failing` : behind.length ? `${behind.length} out of sync` : 'In sync';
      const sub = broken.length ? broken.map(f => f.label).join(', ') : behind.length ? behind.map(f => f.label).join(', ') : `${online} of ${devices.length} devices online`;
      return { type: 'list' as const, title: 'Syncthing', icon: 'disk', href, source, items: rows(folders, devices), empty: 'No folders shared yet', summary: { label: 'Syncthing', icon: 'disk', value, sub, tone } };
    }
    async function findFolder(q: string) {
      const all = (await overview()).folders.map(f => ({ id: String(f.id), label: String(f.label || f.id), path: f.path as string | undefined, paused: !!f.paused })), s = q.trim().toLowerCase();
      const exact = all.filter(f => f.id === q.trim() || f.label.toLowerCase() === s);
      const hits = exact.length ? exact : all.filter(f => f.label.toLowerCase().includes(s) || f.id.toLowerCase().includes(s));
      if (hits.length === 1) return hits[0];
      if (!hits.length) throw new Error(`no folder like "${q}". There are: ${all.map(f => f.label).join(', ') || 'none'}`);
      throw new Error(`"${q}" could be ${hits.map(f => `${f.label} (${f.id})`).join(', ')}. Say which by its id`);
    }

    return {
      async recap() {
        const moved = (await load()).moved;
        return tally(moved, { id: 'sync.moved', theme: 'files', icon: 'disk', kicker: 'Your devices passed around', value: fmt.bytes(moved), scope: 'Since Syncthing last restarted', line: 'From one to the next, with no cloud account holding the copy.' });
      },
      widgets: {
        status: {
          title: 'Syncthing', interval: every, card: 'stats',
          async fetch() {
            const o = await overview(), peers = o.devices.map(d => o.connections.connections?.[d.deviceID] ?? {}), online = peers.filter(p => p.connected).length;
            return { type: 'stats', title: 'Syncthing', icon: 'disk', href, source, summary: { label: 'Syncthing', icon: 'disk', value: online, sub: 'Devices online' },
              items: [{ label: 'Devices online', value: online, sub: `of ${peers.length}` }, { label: 'Folders', value: o.folders.length },
                { label: 'Received', value: fmt.bytes(n(o.connections.total?.inBytesTotal)) }, { label: 'Sent', value: fmt.bytes(n(o.connections.total?.outBytesTotal)) }] };
          },
        },
        sync: { title: 'Syncthing', interval: Math.max(every, 120_000), fetch: syncCard },
      },
      tools: {
        sync_status: {
          label: 'Checked Syncthing', live: true, followUps: ['Why is that folder out of sync?'],
          description: 'Syncthing: every shared folder with its state (idle, scanning, syncing, error), how complete it is, what is left to sync and files that failed; every other device, whether it is connected, how far behind it is, and when a disconnected one was last seen. Use for "is my phone synced", "why aren\'t my files showing up".',
          access: 'read', input: z.object({}),
          async run() {
            const { folders, devices } = await load();
            return { data: { folders: folders.map(f => ({ id: f.id, label: f.label, state: f.paused ? 'paused' : f.state, complete: fmt.pct(pctOf(f)), toSync: f.need ? fmt.bytes(f.need) : undefined, filesToSync: f.needFiles || undefined, failedFiles: f.errors || undefined, localChangesNotSent: f.localChanges || undefined, error: f.error })),
              devices: devices.map(d => ({ name: d.name, connected: d.connected, paused: d.paused || undefined, complete: d.completion != null ? fmt.pct(d.completion) : undefined, behind: d.need ? fmt.bytes(d.need) : undefined, lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : undefined })) },
            card: await syncCard() };
          },
        },
        folder_rescan: {
          label: 'Rescanned a folder',
          description: 'Ask Syncthing to rescan one folder now, by its label or id, so a change on disk is picked up without waiting for the next scan. It changes no files.',
          access: 'write', input: z.object({ folder: z.string().min(1).max(200) }),
          async confirm({ folder }) {
            try { const f = await findFolder(folder); return { title: `Rescan ${f.label}?`, detail: [f.path, f.paused && 'It is paused, so the scan waits until it is resumed'].filter(Boolean).join('. ') || undefined, verb: 'Rescan', logo: '/api/icon/syncthing' }; }
            catch (e) { return { title: `Can't rescan "${folder}"`, detail: (e as Error).message, logo: '/api/icon/syncthing' }; }
          },
          async run({ folder }) {
            const f = await findFolder(folder);
            await api(`db/scan?folder=${encodeURIComponent(f.id)}`, 'POST');
            cached = undefined;
            return { data: { rescanning: f.label }, card: { type: 'text', tone: 'good', text: `Rescanning ${f.label}.` } };
          },
        },
      },
    };
  },
});
