// The configured model, for the chat and for the small background jobs alike.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Config } from './config.ts';

/** Agents add their own named events to an OpenAI stream (Hermes' tool progress, say). The SDK reads every frame as a
 *  completion chunk and fails on those, so only the unnamed ones get through. */
export function plainEvents(body: ReadableStream<Uint8Array>) {
  let held = '';
  const keep = (frame: string) => /^event:/m.test(frame) && !/^event:\s*message\s*$/m.test(frame) ? '' : `${frame}\n\n`;
  return body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).pipeThrough(new TransformStream<string, string>({
    transform(chunk, out) {
      const frames = (held + chunk).split(/\r?\n\r?\n/);
      held = frames.pop() ?? '';
      for (const f of frames) { const k = keep(f); if (k) out.enqueue(k); }
    },
    flush(out) { if (held.trim()) out.enqueue(keep(held)); },
  })).pipeThrough(new TextEncoderStream());
}
/** Who the chat goes to: the configured agent, except on a read-only page (it can act, and that page may only look). */
export const chatAgent = (a: NonNullable<Config['assistant']>, acting: boolean) => acting ? a.agent : undefined;

const agentFetch: typeof fetch = async (url, init) => {
  const r = await fetch(url, init);
  return r.body && r.headers.get('content-type')?.includes('text/event-stream') ? new Response(plainEvents(r.body), { status: r.status, headers: r.headers }) : r;
};

/** Another agent, reached the same way. It's only ever given the conversation: never tools, never Valet's data. */
export function makeAgentModel(a: NonNullable<NonNullable<Config['assistant']>['agent']>) {
  return createOpenAICompatible({ name: 'agent', baseURL: a.baseURL, apiKey: a.apiKey, headers: { 'User-Agent': 'Valet' }, fetch: agentFetch })(a.model);
}

export function makeModel(a: NonNullable<Config['assistant']>) {
  return a.provider === 'anthropic'
    ? createAnthropic({ apiKey: a.apiKey, baseURL: a.baseURL })(a.model)
    : createOpenAICompatible({ name: 'assistant', baseURL: a.baseURL ?? 'http://localhost:11434/v1', apiKey: a.apiKey, includeUsage: true, headers: { 'User-Agent': 'Valet' } })(a.model);
}

type Assistant = NonNullable<Config['assistant']>;
type Item = Exclude<Assistant['models'][number], 'auto'>;
/** An entry's settings, filled in from the main ones. The main server's address only goes to the same provider and its key
 *  only to the same server, so a key never reaches a host it wasn't written for; a window is the model's own. */
function inherit(a: Assistant, m: Item, model: string): Assistant {
  const provider = m.provider ?? a.provider, baseURL = m.baseURL ?? (provider === a.provider ? a.baseURL : undefined);
  const apiKey = m.apiKey ?? (provider === a.provider && baseURL === a.baseURL ? a.apiKey : undefined);
  return { ...a, provider, baseURL, apiKey, model, contextWindow: 'auto' in m ? undefined : m.contextWindow,
    reasoning: m.reasoning ?? a.reasoning, options: { ...a.options, ...m.options },
    // whether it can see is the model's own: another model on the same server may not, and sending it an image fails the chat
    vision: m.vision };
}
/** What the chat may run on: the main settings first (the default), then each of `assistant.models`, known by its name or
 *  model id, filled in from the main settings. */
export function choices(a: Assistant): { id: string; settings: Assistant }[] {
  return [{ id: a.model, settings: a }, ...a.models.flatMap(m => m === 'auto' || 'auto' in m ? [] : [{ id: m.name ?? m.model, settings: inherit(a, m, m.model) }])];
}

const ANTHROPIC = 'https://api.anthropic.com/v1';
export const base = (a: Assistant) => (a.baseURL ?? (a.provider === 'anthropic' ? ANTHROPIC : 'http://localhost:11434/v1')).replace(/\/$/, '').replace(/^https:\/\/api\.anthropic\.com$/, ANTHROPIC);
const authed = (a: Assistant) => ({ 'User-Agent': 'Valet', ...(a.apiKey ? { Authorization: `Bearer ${a.apiKey}` } : {}) });
const host = (a: Assistant) => { try { return new URL(base(a)).host; } catch { return base(a); } };
/** the same server: one provider at one address */
const where = (a: Assistant) => `${a.provider} ${base(a)}`;

/** Whether a listed model is one you can chat with. Lists mix in embedders, speech, image and moderation models, which only
 *  fail in a chat, so those go: by an id that says so, or by OpenRouter's `architecture.output_modalities` leaving out text.
 *  Anything it can't tell about stays. */
export function chatModel(entry: { id: string; architecture?: { output_modalities?: unknown } }): boolean {
  const id = entry.id.toLowerCase(), out = entry.architecture?.output_modalities;
  if (Array.isArray(out) && out.length && !out.includes('text')) return false;
  if (/embed|whisper|transcri|speech|dall-?e|gpt-image|moderation|rerank/.test(id)) return false;
  if (/(^|[^a-z0-9])(tts|image|audio-only)([^a-z0-9]|$)/.test(id)) return false;
  return !/(^|\/)(davinci|babbage)-002$/.test(id);
}

/** One server's own list: every chat model it names, with a window where the list gives one (and Anthropic's display name).
 *  `ok: false` means the last ask failed, and `models` is then what the one before found, if anything. */
export interface Listed { at: number; ok: boolean; models: { id: string; label?: string; window?: number }[] }
export const LIST_FOR = 5 * 6e4;   // a list is kept this long
const AGAIN_AFTER = 5000;          // asked again on purpose (refresh, a model it doesn't have), at most this often
const PAGES = 10;                  // Anthropic's list comes in pages; this many at most
const lists = new Map<string, { listed?: Listed; asking?: Promise<Listed> }>();

/** A server that `auto` asks: its settings, the menu's heading for it, and what tells its models apart from another's. */
export interface Server { settings: Assistant; title: string; prefix: string }
/** Every server `auto` lists, in config order and once each: bare `auto` (or an entry naming nothing new) is the main one. */
export function servers(a: Assistant): Server[] {
  const out: Server[] = [], seen = new Set<string>();
  for (const m of a.models) {
    if (m !== 'auto' && !('auto' in m)) continue;
    const settings = m === 'auto' ? a : inherit(a, m, a.model), main = where(settings) === where(a) && settings.apiKey === a.apiKey;
    const key = `${where(settings)} ${settings.apiKey ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = m === 'auto' ? undefined : m.name;
    out.push({ settings, title: name ?? (main ? 'On the server' : host(settings)), prefix: name ?? host(settings) });
  }
  return out;
}

/** Throws the status, or fetch's own error, when the server doesn't hand over a list (the doctor reads which). */
export async function readList(a: Assistant, get: typeof fetch): Promise<Listed['models']> {
  const seen = new Set<string>(), models: Listed['models'] = [];
  const add = (d: any, label?: unknown) => {
    const id = d?.id;
    if (typeof id !== 'string' || !id || id.length > 200 || seen.has(id) || !chatModel(d)) return;
    seen.add(id);
    models.push({ id, ...(typeof label === 'string' && label && label.length <= 200 && label !== id ? { label } : {}), window: windowOfEntry(d) });
  };
  if (a.provider === 'anthropic') {
    // GET /v1/models: { data: [{ id, display_name, max_input_tokens, … }], has_more, last_id }, the next page by after_id
    const key = a.apiKey ?? process.env.ANTHROPIC_API_KEY;
    const headers = { 'User-Agent': 'Valet', 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) };
    let after: string | undefined;
    for (let page = 0; page < PAGES; page++) {
      const r = await get(`${base(a)}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`, { headers, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(String(r.status));
      const body = await r.json() as { data?: unknown; has_more?: unknown; last_id?: unknown };
      if (!Array.isArray(body?.data)) throw new Error('no list');
      for (const d of body.data as any[]) add(d, d?.display_name);
      if (body.has_more !== true || typeof body.last_id !== 'string' || !body.last_id || body.last_id === after) break;
      after = body.last_id;
    }
    return models;
  }
  const r = await get(`${base(a)}/models`, { headers: authed(a), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(String(r.status));
  const body = await r.json() as { data?: unknown };
  if (!Array.isArray(body?.data)) throw new Error('no list');
  for (const d of body.data as any[]) add(d);
  return models;
}

/** One server's list, asked from here only (its key never reaches the page), kept five minutes and shared by every chat. */
function lister(a: Assistant, now: () => number, get: typeof fetch) {
  const key = `${where(a)} ${a.apiKey ?? ''}`;
  const ask = async (): Promise<Listed> => {
    const was = lists.get(key)?.listed;
    try { return { at: now(), ok: true, models: await readList(a, get) }; } catch { return { at: now(), ok: false, models: was?.models ?? [] }; }
  };
  /** the list, asked again when it's older than five minutes (a failure, after a minute), or when `fresh` (the menu's
   *  refresh, a request naming a model it doesn't have), but never more than once in five seconds */
  return (fresh = false): Promise<Listed> => {
    const held = lists.get(key) ?? {};
    lists.set(key, held);
    const l = held.listed, age = l ? now() - l.at : Infinity;
    if (l && (fresh ? age < AGAIN_AFTER : age < (l.ok ? LIST_FOR : 6e4))) return Promise.resolve(l);
    // two chats asking at once share one request
    return held.asking ??= ask().then(x => { held.listed = x; return x; }).finally(() => { held.asking = undefined; });
  };
}

/** A model `auto` found: the id the page and the chat know it by, the server's own id, and which server it's on. */
export interface Found { id: string; model: string; label?: string; window?: number; group: string; server: number }
/** Everything the servers list, as the page is offered it: each model known by its own id, unless that's taken (the main
 *  model, a configured choice, or one an earlier server listed), and then by `<server name or host>/<id>`. A model that's
 *  already the main one or a configured choice on the same server isn't listed again. */
export function combine(a: Assistant, all: Server[], listed: Listed[]): Found[] {
  const configured = choices(a), taken = new Set(configured.map(c => c.id)), out: Found[] = [];
  all.forEach((s, server) => {
    const here = new Set(configured.filter(c => where(c.settings) === where(s.settings)).flatMap(c => [c.id, c.settings.model]));
    for (const m of listed[server]?.models ?? []) {
      if (here.has(m.id)) continue;
      const id = taken.has(m.id) ? `${s.prefix}/${m.id}` : m.id;
      if (taken.has(id)) continue;
      taken.add(id);
      out.push({ id, model: m.id, label: m.label, window: m.window, group: s.title, server });
    }
  });
  return out;
}

/** `auto` in `assistant.models`: each server's own list, asked from here only. A model found this way runs on its own
 *  server's settings, with its own window. */
export function discovery(a: Assistant, o: { fetch?: typeof fetch; now?: () => number } = {}) {
  const all = servers(a), on = all.length > 0;
  const now = o.now ?? Date.now, get = o.fetch ?? fetch;
  const asks = all.map(s => lister(s.settings, now, get));
  const list = async (fresh = false) => {
    const listed = await Promise.all(asks.map(ask => ask(fresh)));
    return { at: Math.min(now(), ...listed.map(l => l.at)), ok: listed.every(l => l.ok), models: combine(a, all, listed),
      servers: all.map((s, i) => ({ title: s.title, ok: listed[i].ok })) };
  };
  return {
    on, list,
    /** what a request naming `id` runs on: a model in the latest lists, which are asked again once when it isn't there */
    async find(id: string): Promise<(Assistant & { server: string }) | undefined> {
      if (!on) return undefined;
      let l = await list();
      if (!l.models.some(m => m.id === id)) l = await list(true);
      const m = l.models.find(x => x.id === id);
      const s = m && all[m.server].settings;
      // bare `auto` lists the main server with the main settings, but the main model seeing says nothing of the others
      return m && s && { ...s, model: m.model, contextWindow: m.window, server: `${where(s)} ${s.apiKey ?? ''}`, ...(s === a && m.model !== a.model ? { vision: undefined } : {}) };
    },
  };
}

/** What `assistant.reasoning` and `assistant.options` add to a chat call. Left out (`auto`, no options), nothing: the model
 *  and its server decide, as before. An OpenAI-compatible server gets `chat_template_kwargs: { enable_thinking: false }`
 *  for off (Qwen-style chat templates read it, servers that don't know it ignore it; not every one takes reasoning_effort
 *  "none"), and reasoning_effort for low, medium and high (thinking stays on). Anthropic maps the level to its thinking
 *  budget. `reasoning` overrides the configured level for one chat (the chat's own picker); `auto` keeps the config's. */
export function callSettings(a: NonNullable<Config['assistant']>, override?: Assistant['reasoning']) {
  const sampling = { ...a.options }, level = override && override !== 'auto' ? override : a.reasoning;
  if (level === 'auto') return sampling;
  if (a.provider === 'anthropic') return { ...sampling, reasoning: level === 'off' ? 'none' as const : level };
  return level === 'off' ? { ...sampling, ...NO_THINKING } : { ...sampling, reasoning: level };
}
const NO_THINKING = { providerOptions: { assistant: { chat_template_kwargs: { enable_thinking: false } } } };

/** The most the forced last step may write. It only has to say what was found, in a sentence or two; a small model made to
 *  answer without tools sometimes loops instead (a tag or "Let me check…" over and over) until the server's limit. */
export const LAST_STEP_TOKENS = 400;

/** The forced last step: short, and without thinking first, since thinking counts against the same limit. */
export function lastStepSettings(a: NonNullable<Config['assistant']>) {
  const maxOutputTokens = Math.min(LAST_STEP_TOKENS, a.options.maxOutputTokens ?? Infinity);
  return a.provider === 'anthropic' ? { maxOutputTokens, reasoning: 'none' as const } : { maxOutputTokens, ...NO_THINKING };
}

/** How many tokens a model can hold, when its name says: Claude's from Opus and Sonnet 4.6, Haiku 5 and every Fable on take
 *  a million, the ones before 200k. Anything else is unknown, and the chat's meter then shows only what's used. Written
 *  either way a provider spells it: claude-sonnet-4-6, anthropic/claude-sonnet-4.6, claude-3-5-haiku-20241022. */
export function windowOf(model: string): number | undefined {
  const m = model.toLowerCase();
  if (/claude-\d([-.]\d)?-(opus|sonnet|haiku)/.test(m) || /claude-(instant|2)/.test(m)) return 200_000;
  const named = /claude-(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:[-.](\d{1,2})(?!\d))?)?/.exec(m);
  if (!named) return undefined;
  const [, family, major = '0', minor = '0'] = named, v = +major + +minor / 10;
  if (family === 'fable' || family === 'mythos') return 1_000_000;
  return v >= (family === 'haiku' ? 5 : 4.6) ? 1_000_000 : 200_000;
}
/** A model's window as an OpenAI-style `/models` list reports it: vLLM and NInfer say `max_model_len`, others
 *  `context_length`, `context_window` or `max_context_length`, Anthropic `max_input_tokens`, and llama.cpp's own server `meta.n_ctx_train`. */
export function windowFromModels(list: unknown, model: string): number | undefined {
  const data = (list as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return undefined;
  return windowOfEntry(data.find((d: any) => d?.id === model));
}
function windowOfEntry(m: any): number | undefined {
  if (!m) return undefined;
  for (const v of [m.max_model_len, m.context_length, m.context_window, m.max_context_length, m.max_input_tokens, m.meta?.n_ctx_train]) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1000 && v <= 10_000_000) return Math.round(v);
  }
  return undefined;
}

// what the model's own server says, asked once and kept a while: a slow or silent server just means no window
const asked = new Map<string, { at: number; window?: number }>();
async function askServer(a: NonNullable<Config['assistant']>): Promise<number | undefined> {
  if (a.provider !== 'openai-compatible') return undefined;
  const key = `${base(a)} ${a.model}`, hit = asked.get(key);
  if (hit && Date.now() - hit.at < (hit.window ? 6 * 36e5 : 6e5)) return hit.window;
  let window: number | undefined;
  try {
    const r = await fetch(`${base(a)}/models`, { headers: authed(a), signal: AbortSignal.timeout(3000) });
    if (r.ok) window = windowFromModels(await r.json(), a.model);
  } catch { /* no answer: the meter shows only what's used */ }
  asked.set(key, { at: Date.now(), window });
  return window;
}

/** How many tokens the assistant's model holds: the config's `contextWindow`, else what its name says, else what its
 *  server's model list reports. */
export const contextWindow = async (a: NonNullable<Config['assistant']>) => a.contextWindow ?? windowOf(a.model) ?? await askServer(a);
