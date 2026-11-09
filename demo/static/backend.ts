// The public demo needs no server: this answers the page's /api calls in the browser. What runs is the real thing where it
// can be: the demo's own made-up homelab, its scripted model, and Valet's chat, tools and approvals. The rest (the page's
// layout, the year in review) is taken from a real server when the site is built, so each visitor's changes live in their tab.
import './polyfill.ts';
import { z } from 'zod';
import { chatRoute } from '../../src/server/chat.ts';
import { Backups, backupParts } from '../../src/server/backups.ts';
import { fmt } from '../../src/server/core.ts';
import { ownInstance } from '../../src/server/own.ts';
import { Watches } from '../../src/server/watches.ts';
import { findDocs, type DocIndex } from '../../src/shared/docs.ts';
import plugin from '../integrations/homelab.mjs';
import { modelList, reply, suggestions } from '../mock-model.mjs';
import { discovery } from '../../src/server/model.ts';
import { voiceKey } from '../../src/shared/speech.ts';

const snapshot = (name: string) => realFetch(`/snapshot/${name}.json`).then(r => r.json());
const realFetch = window.fetch.bind(window), json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms)), between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// where each picture lives on the site
const image = (ref: string) => /^cover-/.test(ref) ? `/art/covers/${ref.slice(6)}.jpg` : /^album\d$/.test(ref) ? `/art/album/${ref[5]}.jpg`
  : ref === 'article' ? '/art/article.jpg' : /^photo\d$/.test(ref) ? `/art/photos/${ref[5]}.jpg` : /^page\d$/.test(ref) ? `/art/pages/${ref[4]}.jpg`
  : /^doc\d$/.test(ref) ? `/art/docs/${ref[3]}.jpg` : /^meal\d$/.test(ref) ? `/art/meals/${ref[4]}.jpg` : `/art/cameras/${ref}`;

const integration = (plugin as any)({ z, fmt, defineIntegration: (i: unknown) => i });
const ctx = { image, http: () => Promise.reject(new Error('no network in the demo')), session: () => ({ get: async () => '', reset() {} }) };
const lab = integration.create(integration.config.parse({ art: '/art/cameras' }), ctx);
// Valet's own Backups card and tool, gathered from the made-up homelab as the server would
const backups = new Backups();
backups.sources = () => [{ id: 'lab', name: integration.name, instance: lab }];
const bk = backupParts(backups), valet = { widgets: { backups: bk.widget }, tools: { backups_status: bk.tool } };
const instances = new Map<string, any>([['lab', lab], ['valet', valet]]);
// anything that changes the house shows on the page straight away, as the server's refresh does
for (const t of Object.values<any>(lab.tools ?? {})) if (t.access !== 'read') { const run = t.run; t.run = async (...args: unknown[]) => { const out = await run(...args); void refreshAll(); return out; }; }

// the scripted model, behind the same door as a real one
// what a real model would report: about one token for every four characters it was given and wrote, so the chat's context meter fills as it would
const tokens = (v: unknown) => Math.round(JSON.stringify(v ?? '').length / 4);
const usageOf = (prompt: unknown, tools: unknown, said: number) => { const input = tokens(prompt) + tokens(tools);
  return { inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: said, text: said, reasoning: 0 } }; };
const asOpenAi = (prompt: any[]) => prompt.flatMap(m => m.role !== 'tool' ? [m] : m.content.filter((p: any) => p.type === 'tool-result').map((p: any) => ({
  role: 'tool', content: JSON.stringify(/denied/.test(p.output?.type ?? '') ? { denied: true } : p.output?.value ?? {}) })));
const model = {
  specificationVersion: 'v4', provider: 'demo', modelId: 'qwen3.8-27b', supportedUrls: {},
  // one call without tools: the summary Valet writes when a chat is long, or when /compact asks
  async doGenerate({ prompt }: any) {
    const r: any = reply({ messages: asOpenAi(prompt) }), text = String(r.text ?? '');
    return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage: usageOf(prompt, [], tokens(text)), warnings: [] };
  },
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
      c.enqueue({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage: usageOf(prompt, tools, r.call ? tokens(r.call) : tokens(r.text)) });
      c.close();
    } }) };
  },
};

// the widgets: what the server's hub does, for one visitor
type Listener = (type: string, data: string) => void;
const listeners = new Set<Listener>(), known = new Map<string, any>();
const tell = (type: string, data: unknown) => { for (const l of listeners) l(type, JSON.stringify(data)); };
async function refresh(key: string) {
  const [inst, name] = key.split('.'), w = instances.get(inst)?.widgets[name]; if (!w) return;
  try { const s = { key, card: await w.fetch(), at: Date.now() }; known.set(key, s); tell('widget', s); watches.check([...known.values()]); } catch (e) {
    // as the hub does: a widget that stops answering keeps the last card it had, which the page marks stale
    const s = { key, error: (e as Error).message, at: Date.now(), card: known.get(key)?.card }; known.set(key, s); tell('widget', s);
  }
}
const refreshAll = () => Promise.all([...known.keys()].map(refresh));
// "tell me when…": Valet's own reminders and its watch_add tool, checked each time a card changes (the server checks every
// half minute). When one fires the page gets the notice the server would send. The made-up downloads are half an hour
// long, so the one asked about finishes in a few seconds (the homelab's hurry), and the reminder arrives while you look
const watches = new Watches([], w => tell('notice', { key: w.widget, text: w.say, icon: 'pulse', tone: 'accent', at: Date.now() }));
const remind = () => {
  const t = ownInstance({ watches, hub: () => ({ widget: (k: string) => known.get(k)?.card }) as any, widgets: [...known.keys()], timeline: {} as any, activity: {} as any, rules: {} as any, recap: () => snapshot('recap'), undo: async () => '' }).tools!.watch_add;
  const run = t.run;
  t.run = async (input: any) => {
    const out = await run(input);
    if (out.data?.set && input.widget === 'lab.downloads' && input.on === 'ends' && input.name && lab.hurry?.(input.name)) void refresh('lab.downloads');
    return out;
  };
  return t;
};
let started: Promise<void> | undefined;
const start = () => started ??= snapshot('page').then((page: any) => {
  for (const key of Object.keys(page.widgets)) { const [inst, name] = key.split('.'), w = instances.get(inst)?.widgets[name]; if (!w) continue; known.set(key, { key, at: 0 }); void refresh(key); setInterval(() => { if (!document.hidden) void refresh(key); }, w.interval ?? 10_000); }
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

// assistant.models: every choice, configured or listed, is the same scripted model; the stand-in's server list is answered
// here, so `auto` lists what it would and the menu is the searchable one
const models = new Proxy({}, { get: () => model }) as Record<string, any>;
const listing = (async (u: RequestInfo | URL) => /\/models(\?|$)/.test(String(u instanceof Request ? u.url : u)) ? json(modelList()) : json({ error: 'no network in the demo' }, 404)) as typeof fetch;
let listed: ReturnType<typeof discovery> | undefined;
let chat: ((c: any) => Promise<Response>) | undefined, docs: Promise<DocIndex> | undefined, voices: Promise<{ clips: Record<string, string> }> | undefined;
async function answer(path: string, method: string, body: any, signal?: AbortSignal | null): Promise<Response> {
  const [, , route, a, b] = path.split('?')[0].split('/');
  if (route === 'auth') return json({ mode: 'none', user: { name: 'you' } });
  if (route === 'page') return json(await snapshot('page'));
  if (route === 'recap') return json(await snapshot('recap'));
  if (route === 'brief') return json({ text: null });
  if (route === 'suggest') {
    // the speed card, once added from chat, is no longer worth suggesting
    const s = await lab.widgets.services.fetch(), added = (await lab.widgets.speed.fetch()).series.length > 0;
    return json({ list: suggestions(s.items.some((i: any) => i.name === 'Mealie' && !i.ok)).filter(q => !added || !/speed/.test(q)), wrong: [] });
  }
  // ⌘K: the look-only commands (Valet's backups, the made-up calendar's meetings), as the server lists and runs them
  if (route === 'commands') return json({ commands: [...bk.commands.map((c, n) => ({ id: `valet:${n}`, say: c.say, label: c.label, service: 'Valet', kind: 'tool', access: 'read' })),
    ...(lab.commands ?? []).map((c: any, n: number) => ({ id: `lab:${n}`, say: c.say, label: c.label, service: integration.name, kind: 'tool', access: 'read' }))] });
  if (route === 'command') {
    if (body?.id === 'valet:0') return json({ tool: 'valet__backups_status', input: {}, card: (await bk.tool.run()).card });
    const c = /^lab:\d+$/.test(body?.id ?? '') ? lab.commands?.[Number(body.id.slice(4))] : undefined, name = c?.run.replace('tool:', ''), t = lab.tools?.[name];
    if (!t || t.access !== 'read') return json({ error: 'no command matches that' }, 404);
    const out = await t.run(c.input ?? {});
    return json({ tool: `lab__${name}`, input: c.input ?? {}, card: out.card, ...(c.open && typeof out.open === 'string' && out.open.startsWith('https://') ? { open: out.open } : {}) });
  }
  // ⌘K's docs, from the pages saved when the site was built
  if (route === 'docs') { docs ??= snapshot('docs').catch(() => ({ parts: [], integrations: [] })); return json({ docs: findDocs(await docs, new URLSearchParams(path.split('?')[1] ?? '').get('q') ?? '') }); }
  if (route === 'files') return json({ error: 'This demo keeps nothing, so it takes no files' }, 403);
  if (route === 'push') return method === 'GET' ? json({ ready: false, why: 'demo' }) : json({ error: 'The demo can\'t send notifications', why: 'demo' }, 403);
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
    await start(); (valet.tools as Record<string, unknown>).watch_add ??= remind();
    chat ??= chatRoute(config, instances as any, new Map<string, any>([['lab', { type: 'demo-homelab', name: integration.name, integration }], ['valet', { type: 'valet', name: 'Valet', integration: { type: 'valet', name: 'Valet' } }]]), { acting: true, redact: s => s, model: model as any, models, fetch: listing });
    lab.onChat?.(); void refresh('lab.ai');
    return chat({ req: { json: async () => body, raw: { signal } }, get: () => 'you', json });   // json: /compact's answer, and a refusal
  }
  if (route === 'models') {
    // as the server's /api/models: each model's id, a name where there is one, and its heading
    listed ??= discovery((await snapshot('config')).assistant, { fetch: listing });
    const l = await listed.list(new URLSearchParams(path.split('?')[1] ?? '').get('fresh') === '1');
    return json({ ok: l.ok, at: l.at, servers: l.servers, models: l.models.map(m => ({ id: m.id, ...(m.id !== m.model ? { model: m.model } : {}), ...(m.label ? { label: m.label } : {}), group: m.group })) });
  }
  // voice: no server to listen, so the mic only says where voice is set up and never records; answers are read aloud from
  // clips recorded ahead (`npm run demo:voices`), found by their words, and the browser's own voice says the rest (204)
  if (route === 'voice') {
    if (a !== 'speak' || method !== 'POST') return json({ error: 'Voice runs on your own Valet' }, 403);
    voices ??= realFetch('/voices/manifest.json').then(r => r.ok ? r.json() : { clips: {} }).catch(() => ({ clips: {} }));
    const file = (await voices).clips[await voiceKey(String(body?.text ?? ''))];
    return file ? realFetch(`/voices/${file}`) : new Response(null, { status: 204 });
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
