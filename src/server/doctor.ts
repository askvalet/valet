// `node dist/server.js doctor`: what's wrong with this install, and what to do about each thing. It only looks: the
// config is read, every placed widget is fetched once, and addresses are asked whether they answer. Nothing is written,
// no action or tool runs, and nothing is sent anywhere unless --send-test asks for one test message per channel.
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { flags } from './cli.ts';
import { Config, explain, substitute, usedSecrets } from './config.ts';
import type { Integration } from './core.ts';
import { base, choices, readList, servers } from './model.ts';
import { request, type Channel } from './notify.ts';
import { loadPlugins } from './plugins.ts';
import { redactor } from './security.ts';
import { check } from './site.ts';
import { voiceOf } from './voice.ts';

export interface Finding {
  group: 'Config' | 'Integrations' | 'Assistant' | 'Notifications' | 'Install';
  status: 'ok' | 'warn' | 'fail' | 'info';   // info is worth knowing and nothing to fix
  check: string;
  problem?: string;
  fix?: string;
  ms?: number;
}
export interface Options {
  path: string;                          // config.yaml
  data: string;                          // the data folder
  registry: Record<string, Integration>;
  fetch?: typeof fetch;                  // for the doctor's own asks; widgets go through their integration
  sendTest?: boolean;
  timeout?: number;                      // ms each ask may take
  overall?: number;                      // ms for the lot; what hasn't started by then is reported as not checked
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const within = <T>(p: Promise<T>, ms: number) => {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), ms); })]).finally(() => clearTimeout(t));
};
async function pool<T>(jobs: (() => Promise<T>)[], cap: number) {
  const out: T[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(cap, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}

/** A failure as a person can act on it: what happened in plain words, and what to look at. */
export function advise(e: unknown, o: { url?: string; insecure?: boolean; key?: string } = {}): { problem: string; fix: string } {
  const err = e as any, msg = String(err?.message ?? e), cause = err?.cause ?? {}, all = `${msg} ${cause.code ?? err?.code ?? ''} ${cause.message ?? ''}`;
  const host = o.url ? hostOf(o.url) : cause.hostname ?? (cause.address ? `${cause.address}:${cause.port}` : /^(\S+) answered \d{3}$/.exec(msg)?.[1]);
  const at = host ?? 'its address', key = o.key ?? 'its key, token or password';
  if (err?.name === 'TimeoutError' || /UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|ETIMEDOUT|timed out/i.test(all))
    return { problem: `${at} didn't answer in time`, fix: 'It may be slow, asleep or behind a firewall. Check the address and port, and that Valet\'s machine can reach it.' };
  if (/ENOTFOUND|EAI_AGAIN/.test(all))
    return { problem: `the name ${at} can't be found`, fix: 'Check the spelling of the address. A container\'s name only works on a Docker network Valet shares; otherwise use the machine\'s address.' };
  if (/ECONNREFUSED/.test(all))
    return { problem: `nothing answers at ${at}`, fix: 'Check the address and the port, and that the service is running. Inside Docker, localhost is Valet\'s own container: use the service\'s container name or the machine\'s address.' };
  if (/ERR_SSL_WRONG_VERSION_NUMBER|EPROTO|packet length too long/i.test(all))
    return { problem: `${at} doesn't speak https on that port`, fix: 'Change https:// to http:// in its address, or use its https port.' };
  if (/CERT_HAS_EXPIRED/.test(all))
    return { problem: `the certificate of ${at} has expired`, fix: 'Renew it on the service, or use its http:// address on your own network.' };
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|certificate/i.test(all))
    return { problem: `the certificate of ${at} isn't one Valet trusts`, fix: o.insecure ? 'For a self-signed certificate add insecure: true to this block, or use its http:// address.' : 'Use its http:// address on your own network, or give Node your CA with NODE_EXTRA_CA_CERTS.' };
  if (/bad port/.test(all))
    return { problem: `Node won't connect to the port of ${at}: browsers and fetch block it, as one used by other protocols`, fix: 'Move the service to another port, or put it behind a proxy on a usual one.' };
  if (/EHOSTUNREACH|ENETUNREACH|ECONNRESET|UND_ERR_SOCKET|fetch failed/.test(all))
    return { problem: `${at} can't be reached`, fix: 'Check the address, and that Valet\'s machine or container has a route to it (the same Docker network, VPN or VLAN).' };
  const status = Number(/(?:^|[^\d.:])(\d{3})\)?$/.exec(msg)?.[1] ?? (/refused the sign-in|gave no session|sign-in failed/i.test(msg) ? 401 : 0));
  if (status === 401 || status === 403)
    return { problem: `${at} refused ${key} (${status})`, fix: `Check ${key} in .env: copied whole, and still valid.${status === 403 ? ' A 403 often means the key is right and may not read this: give it read permission.' : ''}` };
  if (status === 404)
    return { problem: `${at} answered 404: the address is right, the path isn't`, fix: 'Check the base address: usually the service\'s root with no path, plus its subpath if it runs under one (and /v1 for a model server).' };
  if (status === 429) return { problem: `${at} says too many requests (429)`, fix: 'Wait a little, or use a key with a higher limit.' };
  if (status >= 500) return { problem: `${at} failed on its own side (${status})`, fix: 'Look at that service\'s log; Valet reached it.' };
  if (status >= 300) return { problem: `${at} answered ${status}`, fix: 'Check the address: a redirect or a refusal usually means a proxy or a sign-in page is in the way.' };
  if (/didn't send JSON|Unexpected token|not valid JSON|no list/.test(msg))
    return { problem: `${at} answered with something that isn't its API`, fix: 'The address probably points at a web page, a sign-in proxy or another app. Use the service\'s own address.' };
  return { problem: msg, fix: 'Open its address from the machine Valet runs on, and check this block against the service\'s page in the docs.' };
}

// The config as the doctor reads it: every unset ${NAME} is listed rather than stopping at the first, and each gets a
// stand-in so the rest of the file can still be checked. What depends on a stand-in is left alone until it's set.
const REF = /(\\?)\$\{([A-Z0-9_]+)\}/g;
function unsetIn(v: unknown, path: string, out: Map<string, string[]>) {
  if (typeof v === 'string') { for (const m of v.matchAll(REF)) if (!m[1] && process.env[m[2]] === undefined && !process.env[`${m[2]}_FILE`]) out.set(m[2], [...(out.get(m[2]) ?? []), path]); }
  else if (Array.isArray(v)) v.forEach((x, i) => unsetIn(x, `${path}.${i}`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) unsetIn(x, path ? `${path}.${k}` : k, out);
}

async function readConfig(path: string, out: Finding[]) {
  const say = (status: Finding['status'], check: string, problem?: string, fix?: string) => { out.push({ group: 'Config', status, check, problem, fix }); };
  let text: string, raw: unknown;
  try { text = await readFile(path, 'utf8'); }
  catch (e) { say('fail', path, (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'there is no config file here' : `it can't be read (${(e as NodeJS.ErrnoException).code})`, 'Run `init` to write one, or start Valet once and it writes a starter. VALET_CONFIG says where it lives.'); return; }
  try { raw = parse(text) ?? {}; }
  catch (e) { say('fail', path, `it isn't valid YAML: ${(e as Error).message.split('\n')[0]}`, 'Fix that line; indentation is spaces, and a value with a colon or a # needs quotes.'); return; }
  const unset = new Map<string, string[]>(), asUrl = new Set<string>();
  unsetIn(raw, '', unset);
  for (const [name, at] of unset) say('fail', `\${${name}}`, `${name} isn't set (${at.slice(0, 3).join(', ')}${at.length > 3 ? '…' : ''})`, `Add ${name}=… to .env (or point ${name}_FILE at a file holding it) and restart Valet. In Docker the container needs it: env_file: .env.`);
  const waits = (prefix: string) => [...unset].filter(([, at]) => at.some(p => p === prefix || p.startsWith(`${prefix}.`))).map(([n]) => n);
  // a stand-in passes as a long token; where the schema wants an address there, it gets one on the second go
  const read = () => Config.safeParse(substitute(raw, name => asUrl.has(name) ? 'http://unset.invalid' : `unset-${name}-`.padEnd(40, 'x')));
  let r: ReturnType<typeof read>;
  try {
    r = read();
    if (!r.success && unset.size) { for (const i of r.error.issues) for (const n of waits(i.path.join('.'))) asUrl.add(n); r = read(); }
  } catch (e) { say('fail', path, (e as Error).message.replace(/^config: /, ''), 'A ${secret:…} or ${file:…} names a file Valet must be able to read.'); return; }
  if (!r.success) {
    for (const i of r.error.issues) if (!waits(i.path.join('.')).length) say('fail', i.path.join('.') || path, explain(i), 'Every option is in docs/configuration.md.');
    return;
  }
  return { config: r.data, raw: raw as Record<string, any>, waits, unset: unset.size };
}

const canWrite = (p: string) => access(p, constants.W_OK).then(() => true, () => false);
const exists = (p: string) => access(p).then(() => true, () => false);

async function install(o: Options, config: Config | undefined): Promise<Finding[]> {
  // something worth knowing has no problem, only perhaps a thing to do
  const out: Finding[] = [], say = (status: Finding['status'], check: string, problem?: string, fix?: string) => { out.push(status === 'info' ? { group: 'Install', status, check, fix: problem } : { group: 'Install', status, check, problem, fix }); };
  const data = resolve(o.data);
  if (await exists(data)) {
    if (await canWrite(data)) say('ok', `data folder ${data} can be written`);
    else say('fail', `data folder ${data}`, 'Valet can\'t write to it', 'Accounts, pins, history and notifications are kept there. Mount it writable and owned by the user Valet runs as.');
  } else if (await canWrite(dirname(data))) say('info', `data folder ${data} isn't there yet; Valet makes it when it starts`);
  else say('fail', `data folder ${data}`, 'it isn\'t there and can\'t be made', 'Create it, or mount a volume there, writable by the user Valet runs as. VALET_DATA says where it lives.');
  if (!config) return out;

  const folder = dirname(resolve(o.path)), saves = !!config.assistant?.access.config && config.assistant.access.config !== 'none';
  const writable = await canWrite(folder) && await canWrite(resolve(o.path));
  if (writable) say('ok', `config folder ${folder} can be written`);
  else if (saves) say('fail', `config folder ${folder}`, 'it\'s read-only, and assistant.access.config lets the assistant save edits', 'Mount the folder (not only the file) writable, or set assistant.access.config to none.');
  else say('info', `config folder ${folder} is read-only: fine, since nothing saves edits to it`);

  const { auth } = config;
  if (auth.mode === 'none' && !auth.trustNetwork) say('info', 'no sign-in (auth.mode: none): the page is read-only, with no buttons and no changes by the assistant', 'For controls, turn on sign-in (auth: { mode: local }) or say the network is private (trustNetwork: true).');
  else if (auth.mode === 'none') say('info', 'no sign-in, and trustNetwork is on: anyone who can reach the page can use its controls');
  else if (auth.mode === 'local') {
    const users = await readFile(resolve(data, 'users.json'), 'utf8').then(t => JSON.parse(t), () => []).catch(() => []);
    if (Array.isArray(users) && users.length) say('ok', `sign-in: ${users.length} local account${users.length > 1 ? 's' : ''}`);
    else say('info', 'sign-in is local and there are no accounts yet', 'Open the page with the setup code from the log, or run: node dist/server.js user add <name>');
  } else if (auth.mode === 'proxy') say('info', `sign-in is your proxy's: the ${auth.proxy.header} header is believed from ${auth.proxy.trusted.join(', ')}`);
  // the page's own address is only known for oidc, where the provider must send people back to it
  const named = (u?: string) => { try { const h = new URL(u ?? '').hostname; return h && h !== 'localhost' && !/^[\d.]+$/.test(h) && !h.includes(':') ? h : undefined; } catch { return undefined; } };
  const own = named(auth.oidc?.redirectUrl), allowed = (h: string) => config.allowedHosts.some(a => a.toLowerCase() === h.toLowerCase() || (a.startsWith('*.') && h.toLowerCase().endsWith(a.slice(1).toLowerCase())));
  if (own && !allowed(own)) say('fail', 'allowedHosts', `${own} isn't in it, and that's where sign-in sends people back`, `Add it: allowedHosts: [${own}]`);
  else if (!config.allowedHosts.length) say('info', 'allowedHosts is empty: Valet answers to localhost and IP addresses only', 'If you open it by a name, add the name: allowedHosts: [valet.example.com]. Otherwise it says "Valet doesn\'t answer to …".');
  if (config.mcpServer) say('ok', `mcpServer: a token is set (${config.mcpServer.token.length} characters)`);
  return out;
}

/** Whether an address answers at all: any reply counts, since the question is only whether it's there. */
async function reach(get: typeof fetch, url: string, ms: number) {
  const t0 = performance.now(), r = await within(get(url, { redirect: 'manual', headers: { 'User-Agent': 'Valet' }, signal: AbortSignal.timeout(ms) }), ms);
  await r.body?.cancel().catch(() => {});
  return { status: r.status, ms: Math.round(performance.now() - t0) };
}

async function assistant(config: Config, waits: (p: string) => string[], get: typeof fetch, ms: number): Promise<Finding[]> {
  const out: Finding[] = [], a = config.assistant;
  const say = (status: Finding['status'], check: string, problem?: string, fix?: string, took?: number) => { out.push({ group: 'Assistant', status, check, problem, fix, ms: took }); };
  if (!a) return [{ group: 'Assistant', status: 'info', check: 'no assistant: block, so no chat; the page needs none' }];
  if (waits('assistant').length || waits('voice').length) return out;   // named above; asking with a stand-in key would only mislead
  // each server is asked once, however many models it holds
  const lists = new Map<string, Promise<{ ids?: string[]; error?: unknown; ms: number }>>();
  const list = (s: typeof a) => {
    const k = `${s.provider} ${base(s)} ${s.apiKey ?? ''}`, t0 = performance.now();
    if (!lists.has(k)) lists.set(k, within(readList(s, get), ms).then(l => ({ ids: l.map(m => m.id), ms: Math.round(performance.now() - t0) }), error => ({ error, ms: Math.round(performance.now() - t0) })));
    return lists.get(k)!;
  };
  const asks = [{ what: 'assistant', s: a, model: a.model as string | undefined }, ...choices(a).slice(1).map(c => ({ what: `assistant.models "${c.id}"`, s: c.settings, model: c.settings.model as string | undefined })),
    ...servers(a).map(s => ({ what: `assistant.models auto (${s.title})`, s: s.settings, model: undefined as string | undefined }))];
  // asked together, reported in the config's order
  const said = await Promise.all(asks.map(async ({ what, s, model }) => ({ what, s, model, l: await list(s) })));
  for (const { what, s, model, l } of said) {
    const host = hostOf(base(s));
    if (l.error) { const ad = advise(l.error, { url: base(s), key: s.apiKey || s.provider === 'anthropic' ? 'apiKey' : 'the request (the server wants an apiKey)' }); say('fail', what, ad.problem, ad.fix, l.ms); }
    else if (model && l.ids!.length && !l.ids!.includes(model)) say('warn', what, `${host} answers and doesn't list "${model}"`, `Check the spelling of model, or load it on the server. It lists: ${l.ids!.slice(0, 6).join(', ')}${l.ids!.length > 6 ? '…' : ''}.`, l.ms);
    else say('ok', `${what}: ${model ? `${model} on ${host}` : `${host} lists ${l.ids!.length} model${l.ids!.length === 1 ? '' : 's'}`}`, undefined, undefined, l.ms);
  }
  const probe = async (what: string, url: string) => {
    try { const r = await reach(get, url, ms); say('ok', `${what}: ${hostOf(url)} answers`, undefined, undefined, r.ms); }
    catch (e) { const ad = advise(e, { url }); say('fail', what, ad.problem, ad.fix); }
  };
  if (a.agent) await probe('assistant.agent', `${a.agent.baseURL.replace(/\/$/, '')}/models`);
  const v = voiceOf(config);
  if (v?.stt) await probe('voice.stt', `${v.stt.url}/models`);
  if (v?.tts && v.tts.url !== v.stt?.url) await probe('voice.tts', `${v.tts.url}/models`);
  if (a.telegram) {
    // getMe only reads who the bot is; the token is in the address, so the answer is all that's ever reported
    try {
      const r = await within(get(`https://api.telegram.org/bot${a.telegram.token}/getMe`, { signal: AbortSignal.timeout(ms) }), ms), body: any = await r.json().catch(() => ({}));
      if (r.ok && body?.ok) say('ok', `assistant.telegram: the bot is @${String(body.result?.username ?? '?').slice(0, 64)}, and ${a.telegram.users.length} ${a.telegram.users.length === 1 ? 'person' : 'people'} may talk to it`);
      else say('fail', 'assistant.telegram', `Telegram refused the bot's token (${r.status})`, 'Copy the token again from @BotFather into .env; /revoke there makes a new one.');
    } catch (e) { const ad = advise(e, { url: 'https://api.telegram.org' }); say('fail', 'assistant.telegram', ad.problem, ad.fix); }
  }
  return out;
}

/** What the schema can't say about a channel: the shape its service expects. */
function shape(c: Channel): string | undefined {
  if (c.type === 'ntfy' && !new URL(c.url).pathname.replace(/\//g, '')) return 'the url needs its topic on the end, like https://ntfy.sh/my-topic';
  if (c.type === 'telegram' && !/^\d+:[\w-]{30,}$/.test(c.token)) return 'the token doesn\'t look like one from @BotFather (digits, a colon, then letters)';
  if (c.type === 'discord' && !/\/api\/webhooks\/\d+\/./.test(c.url)) return 'the url isn\'t a webhook: https://discord.com/api/webhooks/<id>/<token>';
  if (c.type === 'pushover' && !(/^[a-z0-9]{30}$/i.test(c.token) && /^[a-z0-9]{30}$/i.test(c.user))) return 'token and user are 30 letters and digits each';
  return undefined;
}
const TEST = { title: 'Valet test message', text: 'Sent by `doctor --send-test`. Nothing is wrong, and nothing else will be sent.' };

async function notify(config: Config, waits: (p: string) => string[], get: typeof fetch, ms: number, sendTest: boolean): Promise<Finding[]> {
  const out: Finding[] = [];
  await Promise.all(config.notify.channels.map(async (c, i) => {
    const what = `notify.channels[${i}] (${c.type})`, say = (status: Finding['status'], check: string, problem?: string, fix?: string, took?: number) => { out[i] = { group: 'Notifications', status, check, problem, fix, ms: took }; };
    if (waits(`notify.channels.${i}`).length) return;
    const odd = shape(c);
    if (odd) return say('warn', what, odd, 'Compare it with what the service gave you.');
    const { url, init } = request(c, TEST), host = hostOf(url);
    try {
      if (!sendTest) { const r = await reach(get, new URL(url).origin, ms); return say('ok', `${what}: ${host} answers (nothing sent; --send-test sends one test message)`, undefined, undefined, r.ms); }
      const t0 = performance.now(), r = await within(get(url, { ...init, signal: AbortSignal.timeout(ms) }), ms);
      await r.body?.cancel().catch(() => {});
      if (r.ok) say('ok', `${what}: a test message went to ${host}`, undefined, undefined, Math.round(performance.now() - t0));
      else { const ad = advise(new Error(`${host} answered ${r.status}`), { url, key: 'its token' }); say('fail', what, ad.problem, r.status === 404 ? 'Check the url: the topic, webhook or key on the end of it is not one the service knows.' : ad.fix); }
    } catch (e) { const ad = advise(e, { url }); say('fail', what, ad.problem, ad.fix); }
  }));
  return out.filter(Boolean);
}

const typeName = (registry: Record<string, Integration>, type: string) => registry[type]?.name ?? type;
/** the one address a block has, if it has just one: with several, a failure can't be pinned on either */
function addressOf(block: unknown) {
  const found: string[] = [], walk = (v: unknown, depth: number) => {
    if (typeof v === 'string') { if (/^https?:\/\//.test(v)) found.push(v); }
    else if (v && typeof v === 'object' && depth < 3) for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(block, 0);
  return found.length === 1 ? found[0] : undefined;
}

export async function doctor(o: Options): Promise<Finding[]> {
  const get = o.fetch ?? fetch, ms = o.timeout ?? 10_000, until = Date.now() + (o.overall ?? 45_000);
  const top: Finding[] = [], read = await readConfig(o.path, top);
  if (!read) return tidy([...top, ...await install(o, undefined)]);
  const { config, waits } = read;
  const fromPlugins = await loadPlugins(o.registry, config.plugins.packages, config.plugins.replace);
  const { problems, instances, meta, placed } = check(config, o.registry, fromPlugins);
  const held = Object.keys(config.integrations).filter(id => waits(`integrations.${id}`).length);
  for (const p of problems) if (!held.some(id => p.startsWith(`integrations.${id}`) || p.startsWith(`layout: no widget "${id}.`))) top.push({ group: 'Config', status: 'fail', check: p.slice(0, p.indexOf(':')), problem: p.slice(p.indexOf(':') + 2), fix: 'Every option is in docs/configuration.md; `config print` shows what Valet made of the file.' });
  if (!top.length) top.push({ group: 'Config', status: 'ok', check: `${o.path}: ${instances.size} integration${instances.size === 1 ? '' : 's'}, ${placed.size} widget${placed.size === 1 ? '' : 's'} placed` });

  // every placed widget, fetched once; an integration with none on the page (the assistant's alone) has its first one tried
  const jobs: (() => Promise<{ id: string; w: string; ms?: number; card?: any; error?: unknown; late?: boolean }>)[] = [];
  for (const id of Object.keys(config.integrations)) {
    const inst = instances.get(id);
    if (!inst || held.includes(id)) continue;
    const on = [...placed].filter(k => k.startsWith(`${id}.`)).map(k => k.slice(id.length + 1)).filter(w => inst.widgets[w]);
    for (const w of on.length ? on : Object.keys(inst.widgets).slice(0, 1)) jobs.push(async () => {
      if (Date.now() > until) return { id, w, late: true };
      const t0 = performance.now();
      try { const card = await within(inst.widgets[w].fetch(), ms); return { id, w, card, ms: Math.round(performance.now() - t0) }; }
      catch (error) { return { id, w, error, ms: Math.round(performance.now() - t0) }; }
    });
  }
  const [fetched, chat, channels, rest] = await Promise.all([pool(jobs, 8), assistant(config, waits, get, ms), notify(config, waits, get, ms, !!o.sendTest), install(o, config)]);
  const found: Finding[] = [];
  for (const id of new Set(fetched.map(f => f.id))) {
    const mine = fetched.filter(f => f.id === id), block = config.integrations[id] as Record<string, unknown>, what = `${id} (${typeName(o.registry, meta.get(id)?.type ?? block.type as string)})`;
    const say = (status: Finding['status'], check: string, problem?: string, fix?: string, took?: number) => { found.push({ group: 'Integrations', status, check, problem, fix, ms: took }); };
    const failed = mine.filter(f => f.error), insecure = 'insecure' in ((o.registry[block.type as string]?.config as { shape?: object })?.shape ?? {});
    // one cause usually fails every widget of a service: say it once, with the widgets it stopped
    const causes = new Map<string, { fix: string; widgets: string[] }>();
    for (const f of failed) { const ad = advise(f.error, { url: addressOf(block), insecure }); causes.set(ad.problem, { fix: ad.fix, widgets: [...(causes.get(ad.problem)?.widgets ?? []), f.w] }); }
    for (const [problem, c] of causes) say('fail', what, `${c.widgets.length < mine.length ? `${c.widgets.join(', ')}: ` : ''}${problem}`, c.fix);
    if (mine.some(f => f.late)) say('warn', what, 'not checked: the doctor ran out of time', 'Run it again; --timeout <seconds> gives each service less.');
    // a status check's targets answer for themselves: the card arrives either way
    const down = mine.flatMap(f => block.type === 'http' && Array.isArray(f.card?.items) ? f.card.items.filter((i: any) => i.ok === false && !i.quiet).map((i: any) => `${String(i.name)} (${String(i.detail ?? 'down')})`) : []);
    if (down.length) say('warn', what, `not answering: ${down.join(', ')}`, 'Check each one\'s url under targets; `quiet: true` is for a service that\'s often off on purpose.');
    const good = mine.filter(f => !f.error && !f.late);
    if (!failed.length && good.length && !down.length) say('ok', `${what}: ${good.length} widget${good.length === 1 ? '' : 's'}${[...placed].some(k => k.startsWith(`${id}.`)) ? '' : ', none of them on the page'}`, undefined, undefined, Math.max(...good.map(f => f.ms ?? 0)));
  }
  return tidy([...top, ...found, ...chat, ...channels, ...rest]);
}

/** Nothing leaves without passing the redactor, and an address loses its password and any key in its query besides:
 *  a secret written straight into the file (not through ${NAME}) is one the redactor never heard of. */
function tidy(findings: Finding[]) {
  const redact = redactor(usedSecrets);
  const clean = (s: string) => redact(s).replace(/\/\/[^/@\s]+@/g, '//•••@').replace(/([?&](?:api_?key|access_token|token|key|password|secret|auth)=)[^&\s]+/gi, '$1•••');
  return findings.map(f => ({ ...f, check: clean(f.check), ...(f.problem ? { problem: clean(f.problem) } : {}), ...(f.fix ? { fix: clean(f.fix) } : {}) }));
}

const MARK = { ok: '✓', warn: '!', fail: '✗', info: '·' } as const;
export function render(findings: Finding[]) {
  const lines: string[] = [];
  for (const group of ['Config', 'Integrations', 'Assistant', 'Notifications', 'Install'] as const) {
    const mine = findings.filter(f => f.group === group);
    if (!mine.length) continue;
    lines.push(group);
    for (const f of mine) {
      lines.push(`  ${MARK[f.status]} ${f.check}${f.problem ? `: ${f.problem}` : ''}${f.ms != null && f.status === 'ok' ? ` (${f.ms} ms)` : ''}`);
      if (f.fix) lines.push(`      ${f.fix}`);
    }
  }
  const bad = findings.filter(f => f.status === 'fail').length, warn = findings.filter(f => f.status === 'warn').length;
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  lines.push('', bad || warn ? [bad && count(bad, 'problem'), warn && count(warn, 'warning')].filter(Boolean).join(', ') + '.' : 'Nothing is wrong.');
  return lines.join('\n');
}

export async function doctorCommand(args: string[], path: string, data: string, registry: Record<string, Integration>) {
  const f = flags(args, ['json', 'send-test'], ['timeout']), seconds = Number(f.given.timeout ?? 10);
  if (f.bad || f.rest.length || !(seconds > 0 && seconds <= 120)) { console.error(`${f.bad ?? 'usage'}: doctor [--json] [--send-test] [--timeout <seconds, 10 by default>]`); return 1; }
  // integrations and plugins log as they go; that's not the report, and with --json the report is all stdout may hold
  const log = console.log; console.log = console.error;
  let findings: Finding[];
  try { findings = await doctor({ path, data, registry, sendTest: f.on.has('send-test'), timeout: seconds * 1000, overall: Math.max(45_000, seconds * 3000) }); }
  finally { console.log = log; }
  const ok = !findings.some(x => x.status === 'fail');
  console.log(f.on.has('json') ? JSON.stringify({ ok, checks: findings.map(({ group, ...x }) => ({ group: group.toLowerCase(), ...x })) }, null, 2) : render(findings));
  return ok ? 0 : 1;
}
