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
 *  `context_length`, `context_window` or `max_context_length`, and llama.cpp's own server `meta.n_ctx_train`. */
export function windowFromModels(list: unknown, model: string): number | undefined {
  const data = (list as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return undefined;
  const m = data.find((d: any) => d?.id === model) as any;
  if (!m) return undefined;
  for (const v of [m.max_model_len, m.context_length, m.context_window, m.max_context_length, m.meta?.n_ctx_train]) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1000 && v <= 10_000_000) return Math.round(v);
  }
  return undefined;
}

// what the model's own server says, asked once and kept a while: a slow or silent server just means no window
const asked = new Map<string, { at: number; window?: number }>();
async function askServer(a: NonNullable<Config['assistant']>): Promise<number | undefined> {
  if (a.provider !== 'openai-compatible') return undefined;
  const base = (a.baseURL ?? 'http://localhost:11434/v1').replace(/\/$/, ''), key = `${base} ${a.model}`, hit = asked.get(key);
  if (hit && Date.now() - hit.at < (hit.window ? 6 * 36e5 : 6e5)) return hit.window;
  let window: number | undefined;
  try {
    const r = await fetch(`${base}/models`, { headers: { 'User-Agent': 'Valet', ...(a.apiKey ? { Authorization: `Bearer ${a.apiKey}` } : {}) }, signal: AbortSignal.timeout(3000) });
    if (r.ok) window = windowFromModels(await r.json(), a.model);
  } catch { /* no answer: the meter shows only what's used */ }
  asked.set(key, { at: Date.now(), window });
  return window;
}

/** How many tokens the assistant's model holds: the config's `contextWindow`, else what its name says, else what its
 *  server's model list reports. */
export const contextWindow = async (a: NonNullable<Config['assistant']>) => a.contextWindow ?? windowOf(a.model) ?? await askServer(a);
