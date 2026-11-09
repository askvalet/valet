// Voice for the chat: what someone says, written down for the message box, and answers read aloud. Both go through the
// OpenAI audio API (POST /audio/transcriptions and /audio/speech), so OpenAI or a server on your own network works the
// same. The page talks only to Valet; the key and the address stay here. Nothing is kept: audio passes through memory
// and the log gets sizes and timings, never words. Voice only types and reads: what's said goes through the chat with the
// same access and approvals as typing it.
import type { Context } from 'hono';
import type { Config } from './config.ts';

interface End { url: string; key?: string; model: string }
export interface Voice {
  stt?: End & { language?: string };
  tts?: End & { voice: string; speed: number };
  speakReplies: boolean;
  autoSend: boolean;
}

/** About two minutes of speech, at what any browser records. */
export const MAX_AUDIO = 10 * 2 ** 20;
/** The most read aloud at once; the page sends the start of an answer, well under this. */
export const MAX_SPEECH = 2000;
/** Per person (or address, without sign-in), per minute. */
export const PER_MINUTE = { transcribe: 20, speak: 30 } as const;
const UPSTREAM_MS = 90_000;

const trim = (u: string) => u.replace(/\/+$/, '');
type Half = { baseURL?: string; apiKey?: string } | undefined;

/** What the config's `voice:` block comes to: each half's address, key and model, or nothing for a half that's off. */
export function voiceOf(config: Config): Voice | undefined {
  const v = config.voice;
  if (!v || (!v.stt && !v.tts)) return undefined;
  const a = config.assistant?.provider === 'openai-compatible' ? config.assistant : undefined;
  // a half without an address borrows the other's, then the assistant's; a key only ever comes with its own address
  const end = (half: NonNullable<Half> & { model: string }, other: Half): End | undefined => {
    const url = half.baseURL ?? other?.baseURL ?? a?.baseURL;
    if (!url) return undefined;
    const same = (s: Half) => !!s?.baseURL && trim(s.baseURL) === trim(url);
    return { url: trim(url), key: half.apiKey ?? [other, a].find(s => same(s) && s?.apiKey)?.apiKey, model: half.model };
  };
  const stt = v.stt && end(v.stt, v.tts), tts = v.tts && end(v.tts, v.stt);
  if (!stt && !tts) return undefined;
  return {
    ...(stt ? { stt: { ...stt, language: v.stt!.language } } : {}),
    ...(tts ? { tts: { ...tts, voice: v.tts!.voice, speed: v.tts!.speed } } : {}),
    speakReplies: v.speakReplies, autoSend: v.autoSend,
  };
}

/** For `config check` and the page's list of problems. */
export function voiceProblems(config: Config): string[] {
  const v = config.voice;
  if (!v) return [];
  const out: string[] = [], got = voiceOf(config);
  if (!v.stt && !v.tts) out.push('voice: set stt (the mic), tts (answers read aloud) or both');
  for (const h of ['stt', 'tts'] as const) if (v[h] && !got?.[h]) out.push(`voice.${h}: needs a baseURL, like https://api.openai.com/v1 or http://speaches:8000/v1`);
  if ((v.stt || v.tts) && !config.assistant) out.push('voice: needs an assistant; it listens and speaks in the chat');
  return out;
}

/** What the page may know: which halves are on and the two defaults. Never an address, a model or a key. */
export function voiceForPage(config: Config) {
  const v = voiceOf(config);
  if (!v || !config.assistant) return undefined;
  return { listen: !!v.stt, speak: !!v.tts, speakReplies: v.speakReplies, autoSend: v.autoSend };
}

const recent = new Map<string, number[]>();
function overLimit(kind: keyof typeof PER_MINUTE, who: string) {
  const k = `${kind}:${who}`, now = Date.now(), times = (recent.get(k) ?? []).filter(t => now - t < 60_000);
  recent.delete(k);
  if (times.length >= PER_MINUTE[kind]) { recent.set(k, times); return true; }
  recent.set(k, [...times, now]);
  if (recent.size > 2000) recent.delete(recent.keys().next().value!);
  return false;
}

export interface VoiceDeps {
  voice?: Voice;
  /** why voice is off on this page (no chat here, the demo), or nothing */
  refusal?: string | null;
  redact: (s: string) => string;
  /** whose minute this counts against: the signed-in name, or the address */
  who: string;
  fetch?: typeof fetch;
}

// Containers Safari, Chrome and Firefox record in, as the file name the API uses to tell what it's been given
const EXT: Record<string, string> = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'mp4', 'video/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/flac': 'flac',
};

/** What went wrong upstream, in a sentence that has no key in it. */
async function failure(res: Response, end: End, redact: (s: string) => string) {
  let said = '';
  try {
    const raw = (await res.text()).slice(0, 2000);
    try { const j = JSON.parse(raw); said = typeof j?.error === 'string' ? j.error : j?.error?.message ?? (typeof j?.detail === 'string' ? j.detail : j?.message ?? ''); } catch { said = raw; }
  } catch { /* nothing to say */ }
  return clean(`the voice server answered ${res.status}${said ? `: ${String(said).replace(/\s+/g, ' ').slice(0, 200)}` : ''}`, end, redact);
}
const clean = (s: string, end: End, redact: (s: string) => string) => {
  const r = redact(s);
  return end.key && end.key.length >= 4 ? r.split(end.key).join('•••') : r;
};
const unreachable = (e: unknown, end: End, redact: (s: string) => string) => {
  const err = e as Error & { cause?: { code?: string } };
  if (err?.name === 'TimeoutError') return 'the voice server took too long';
  return clean(`can't reach the voice server${err?.cause?.code ? ` (${err.cause.code})` : ''}`, end, redact);
};
const log = (what: string, started: number, extra: string) => console.log(`voice: ${what} · ${extra} · ${Date.now() - started} ms`);

const headersFor = (end: End, json = false) => ({ ...(end.key ? { Authorization: `Bearer ${end.key}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) });
const signal = (c: Context) => AbortSignal.any([AbortSignal.timeout(UPSTREAM_MS), ...(c.req.raw.signal ? [c.req.raw.signal] : [])]);

/** POST /api/voice/transcribe, multipart with `file`: the words, as `{ text }`. */
export async function transcribe(c: Context, d: VoiceDeps) {
  if (d.refusal) return c.json({ error: d.refusal }, 403);
  const end = d.voice?.stt;
  if (!end) return c.json({ error: 'voice input is off (voice.stt)' }, 404);
  if (Number(c.req.header('content-length') ?? 0) > MAX_AUDIO + 64 * 2 ** 10) return c.json({ error: 'a recording is limited to about two minutes' }, 413);
  if (overLimit('transcribe', d.who)) return c.json({ error: 'too many recordings in a minute; try again shortly' }, 429);
  let file: unknown;
  try { file = (await c.req.formData()).get('file'); } catch { return c.json({ error: 'send the recording as multipart form data, in a field named file' }, 400); }
  if (!(file instanceof Blob) || !file.size) return c.json({ error: 'no recording in the request' }, 400);
  if (file.size > MAX_AUDIO) return c.json({ error: 'a recording is limited to about two minutes' }, 413);
  const type = file.type.split(';')[0].trim().toLowerCase(), ext = EXT[type];
  if (!ext) return c.json({ error: `not a recording Valet knows (${type || 'no type'})` }, 415);

  const form = new FormData();
  form.append('file', new Blob([await file.arrayBuffer()], { type }), `speech.${ext}`);
  form.append('model', end.model);
  if (end.language) form.append('language', end.language);
  form.append('response_format', 'json');
  const started = Date.now();
  let res: Response;
  try { res = await (d.fetch ?? fetch)(`${end.url}/audio/transcriptions`, { method: 'POST', headers: headersFor(end), body: form, signal: signal(c) }); }
  catch (e) { log('transcribe failed', started, `${file.size} B`); return c.json({ error: unreachable(e, end, d.redact) }, 502); }
  if (!res.ok) { log('transcribe failed', started, `${file.size} B, ${res.status}`); return c.json({ error: await failure(res, end, d.redact) }, 502); }
  const body = await res.json().catch(() => null) as { text?: unknown } | null;
  if (typeof body?.text !== 'string') return c.json({ error: 'the voice server sent no text back' }, 502);
  log('transcribed', started, `${file.size} B`);
  // the words are the person's own, but a server could echo anything: they go through the redactor like everything else
  return c.json({ text: clean(body.text.trim(), end, d.redact) });
}

/** POST /api/voice/speak, `{ text }`: the answer as MP3. */
export async function speak(c: Context, d: VoiceDeps) {
  if (d.refusal) return c.json({ error: d.refusal }, 403);
  const end = d.voice?.tts;
  if (!end) return c.json({ error: 'reading aloud is off (voice.tts)' }, 404);
  const body = await c.req.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'nothing to say' }, 400);
  if (text.length > MAX_SPEECH) return c.json({ error: `at most ${MAX_SPEECH} characters at a time` }, 413);
  if (overLimit('speak', d.who)) return c.json({ error: 'too much read aloud in a minute; try again shortly' }, 429);
  const started = Date.now();
  let res: Response;
  try {
    res = await (d.fetch ?? fetch)(`${end.url}/audio/speech`, {
      method: 'POST', headers: headersFor(end, true), signal: signal(c),
      body: JSON.stringify({ model: end.model, input: text, voice: end.voice, response_format: 'mp3', speed: end.speed }),
    });
  } catch (e) { log('speak failed', started, `${text.length} chars`); return c.json({ error: unreachable(e, end, d.redact) }, 502); }
  if (!res.ok || !res.body) { log('speak failed', started, `${text.length} chars, ${res.status}`); return c.json({ error: await failure(res, end, d.redact) }, 502); }
  log('spoke', started, `${text.length} chars`);
  // always served as MP3, whatever the server calls it, so nothing else can be passed off from Valet's origin
  return new Response(res.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } });
}
