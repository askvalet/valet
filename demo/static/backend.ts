// The public demo needs no server: this answers the page's /api calls in the browser. What runs is the real thing where it
// can be: the demo's own made-up homelab, its scripted model, and Valet's chat, tools and approvals. The rest (the page's
// layout, the year in review) is taken from a real server when the site is built, so each visitor's changes live in their tab.
import './polyfill.ts';
import { z } from 'zod';
import { chatRoute } from '../../src/server/chat.ts';
import plugin from '../integrations/homelab.mjs';
import { reply, suggestions } from '../mock-model.mjs';

const snapshot = (name: string) => realFetch(`/snapshot/${name}.json`).then(r => r.json());
const realFetch = window.fetch.bind(window), json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms)), between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// where each picture lives on the site
const image = (ref: string) => /^cover-/.test(ref) ? `/art/covers/${ref.slice(6)}.jpg` : /^album\d$/.test(ref) ? `/art/album/${ref[5]}.jpg`
  : ref === 'article' ? '/art/article.jpg' : /^photo\d$/.test(ref) ? `/art/photos/${ref[5]}.jpg` : /^page\d$/.test(ref) ? `/art/pages/${ref[4]}.jpg`
  : /^doc\d$/.test(ref) ? `/art/docs/${ref[3]}.jpg` : `/art/cameras/${ref}`;

const integration = (plugin as any)({ z, defineIntegration: (i: unknown) => i });
const ctx = { image, http: () => Promise.reject(new Error('no network in the demo')), session: () => ({ get: async () => '', reset() {} }) };
const lab = integration.create(integration.config.parse({ art: '/art/cameras' }), ctx), instances = new Map([['lab', lab]]);
// anything that changes the house shows on the page straight away, as the server's refresh does
for (const t of Object.values<any>(lab.tools ?? {})) if (t.access !== 'read') { const run = t.run; t.run = async (...args: unknown[]) => { const out = await run(...args); void refreshAll(); return out; }; }

// the scripted model, behind the same door as a real one
const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
const asOpenAi = (prompt: any[]) => prompt.flatMap(m => m.role !== 'tool' ? [m] : m.content.filter((p: any) => p.type === 'tool-result').map((p: any) => ({
  role: 'tool', content: JSON.stringify(/denied/.test(p.output?.type ?? '') ? { denied: true } : p.output?.value ?? {}) })));
const model = {
  specificationVersion: 'v4', provider: 'demo', modelId: 'qwen3.8-27b', supportedUrls: {},
  async doGenerate() { throw new Error('the demo only streams'); },
  async doStream({ prompt, tools = [] }: any) {
    const r: any = reply({ messages: asOpenAi(prompt), tools: tools.map((t: any) => ({ function: { name: t.name } })) });
    return { stream: new ReadableStream({ async start(c) {
      c.enqueue({ type: 'stream-start', warnings: [] });
      // paced like a model on a home GPU, as mock-model.mjs is
      await sleep(between(900, 1600));
      if (r.call) c.enqueue({ type: 'tool-call', toolCallId: `call${Date.now()}`, toolName: r.call.name, input: r.call.args });
      else {
        c.enqueue({ type: 'text-start', id: 't' });
        for (const w of String(r.text).split(/(?<= )/)) { c.enqueue({ type: 'text-delta', id: 't', delta: w }); await sleep(between(28, 62) + (/[.,:;?!]\s*$/.test(w) ? between(80, 220) : 0)); }
        c.enqueue({ type: 'text-end', id: 't' });
      }
      const reason = r.call ? 'tool-calls' : 'stop';
      c.enqueue({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage });
      c.close();
    } }) };
  },
};

// the widgets: what the server's hub does, for one visitor
type Listener = (type: string, data: string) => void;
const listeners = new Set<Listener>(), known = new Map<string, any>();
const tell = (type: string, data: unknown) => { for (const l of listeners) l(type, JSON.stringify(data)); };
async function refresh(key: string) {
  const w = lab.widgets[key.split('.')[1]]; if (!w) return;
  try { const s = { key, card: await w.fetch(), at: Date.now() }; known.set(key, s); tell('widget', s); } catch (e) { tell('widget', { key, error: (e as Error).message, at: Date.now() }); }
}
const refreshAll = () => Promise.all([...known.keys()].map(refresh));
let started: Promise<void> | undefined;
const start = () => started ??= snapshot('page').then((page: any) => {
  for (const key of Object.keys(page.widgets)) { const w = lab.widgets[key.split('.')[1]]; if (!w) continue; known.set(key, { key, at: 0 }); void refresh(key); setInterval(() => { if (!document.hidden) void refresh(key); }, w.interval ?? 10_000); }
});

class Events {
  private on = new Map<string, ((e: { data: string }) => void)[]>(); private me: Listener; onopen?: () => void; onerror?: () => void;
  constructor() {
    this.me = (type, data) => this.on.get(type)?.forEach(f => f({ data })); listeners.add(this.me);
    void start().then(() => { this.onopen?.(); for (const s of known.values()) if (s.at) this.me('widget', JSON.stringify(s)); });
  }
  addEventListener(type: string, f: (e: { data: string }) => void) { this.on.set(type, [...this.on.get(type) ?? [], f]); }
  close() { listeners.delete(this.me); }
}
(window as any).EventSource = Events;

let chat: ((c: any) => Promise<Response>) | undefined;
async function answer(path: string, method: string, body: any, signal?: AbortSignal | null): Promise<Response> {
  const [, , route, a, b] = path.split('?')[0].split('/');
  if (route === 'auth') return json({ mode: 'none', user: { name: 'you' } });
  if (route === 'page') return json(await snapshot('page'));
  if (route === 'recap') return json(await snapshot('recap'));
  if (route === 'brief') return json({ text: null });
  if (route === 'suggest') { const s = await lab.widgets.services.fetch(); return json({ list: suggestions(s.items.some((i: any) => i.name === 'Mealie' && !i.ok)), wrong: [] }); }
  if (route === 'files') return json({ error: 'This demo keeps nothing, so it takes no files' }, 403);
  if (route === 'action') {
    const act = instances.get(a)?.actions?.[b]; if (!act) return json({ error: `no action ${a}.${b}` }, 404);
    const args = act.input.safeParse(body ?? {}); if (!args.success) return json({ error: args.error.issues[0]?.message }, 400);
    const result = await act.run(args.data); await refreshAll();
    return json({ ok: true, result: result ?? null });
  }
  if (route === 'confirm') {
    const [inst, name] = String(body?.tool ?? '').split('__'), t = instances.get(inst)?.tools?.[name], logo = '/api/icon/demo-homelab';
    return json(t?.confirm ? { logo, ...await t.confirm(body.input ?? {}) } : { logo });
  }
  if (route === 'chat') {
    const config = await snapshot('config');
    chat ??= chatRoute(config, instances as any, new Map([['lab', { type: 'demo-homelab', name: integration.name, integration }]]), { acting: true, redact: s => s, model: model as any });
    lab.onChat?.(); void refresh('lab.ai');
    return chat({ req: { json: async () => body, raw: { signal } }, get: () => 'you' });
  }
  if (route === 'live') { const [inst, name] = String(body?.tool ?? '').split('__'), t = instances.get(inst)?.tools?.[name]; return t ? json({ card: (await t.run(body.input)).card }) : json({ error: 'not a live card' }, 403); }
  return json({ error: 'not in the demo' }, 404);
}

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || /^\/api\/(icon|favicon|wallpaper)/.test(url.pathname)) return realFetch(input, init);
  const method = init?.method ?? 'GET', body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  return answer(url.pathname + url.search, method, body, init?.signal);
}) as typeof fetch;
