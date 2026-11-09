// Voice in the chat: the config block, the two routes against stand-in speech servers (the request each sends, the
// limits, the key never coming back), sign-in in front of them, and the mic and speaker only when configured.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { renderToString } from 'react-dom/server';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-voice-'));
const { Config, parseConfig } = await import('../src/server/config.ts');
const { MAX_AUDIO, MAX_SPEECH, PER_MINUTE, speak, transcribe, voiceForPage, voiceOf, voiceProblems } = await import('../src/server/voice.ts');
const { setupAuth } = await import('../src/server/auth.ts');
const { recordingType, speakable } = await import('../src/web/voice.tsx');
const { default: Assistant } = await import('../src/web/assistant.tsx');

const KEY = 'sk-made-up-voice-key-0123456789';
const assistant = { provider: 'openai-compatible', baseURL: 'http://llm.lan:8080/v1', apiKey: 'llm-key-abcdef', model: 'm' };

test('config: off unless set; either half alone; defaults are OpenAI\'s', () => {
  assert.equal(voiceOf(Config.parse({})), undefined);
  assert.equal(voiceForPage(Config.parse({ assistant })), undefined);
  const v = voiceOf(Config.parse({ assistant, voice: { stt: { baseURL: 'https://api.openai.com/v1', apiKey: KEY } } }))!;
  assert.deepEqual(v.stt, { url: 'https://api.openai.com/v1', key: KEY, model: 'whisper-1', language: undefined });
  assert.equal(v.tts, undefined);
  assert.equal(v.speakReplies, false);
  assert.equal(v.autoSend, false);
  const t = voiceOf(Config.parse({ assistant, voice: { tts: { baseURL: 'http://speaches:8000/v1/' } } }))!;
  assert.deepEqual(t.tts, { url: 'http://speaches:8000/v1', key: undefined, model: 'tts-1', voice: 'alloy', speed: 1 });
});

test('config: a half borrows the other\'s address, then the assistant\'s; a key never travels to another address', () => {
  const both = voiceOf(Config.parse({ assistant, voice: { stt: { baseURL: 'http://speaches:8000/v1', apiKey: KEY, model: 'Systran/faster-whisper-small', language: 'en' }, tts: { model: 'kokoro', voice: 'af_heart' } } }))!;
  assert.equal(both.tts!.url, 'http://speaches:8000/v1');
  assert.equal(both.tts!.key, KEY, 'same server, same key');
  // its own address: the other half's key stays with the other half
  const apart = voiceOf(Config.parse({ voice: { stt: { baseURL: 'http://a.lan/v1', apiKey: KEY }, tts: { baseURL: 'http://b.lan/v1' } } }))!;
  assert.equal(apart.tts!.key, undefined);
  // nothing given: the assistant's server and key
  const fromLlm = voiceOf(Config.parse({ assistant, voice: { stt: {} } }))!;
  assert.deepEqual([fromLlm.stt!.url, fromLlm.stt!.key], ['http://llm.lan:8080/v1', 'llm-key-abcdef']);
  // an Anthropic assistant has no audio API to lend
  assert.equal(voiceOf(Config.parse({ assistant: { provider: 'anthropic', model: 'x' }, voice: { stt: {} } })), undefined);
});

test('config: config check names what\'s wrong', () => {
  assert.throws(() => parseConfig('voice: { stt: { baseURL: not a url } }'), /voice\.stt\.baseURL/);
  assert.throws(() => parseConfig('voice: { stt: { baseUrl: http://x/v1 } }'), /did you mean "baseURL"/);
  assert.throws(() => parseConfig('voice: { tts: { speed: 9 } }'), /voice\.tts\.speed/);
  assert.throws(() => parseConfig('voice: { stt: { language: english please } }'), /language code/);
  assert.match(voiceProblems(Config.parse({ voice: { stt: { baseURL: 'http://x/v1' } } })).join('\n'), /needs an assistant/);
  assert.match(voiceProblems(Config.parse({ assistant: { provider: 'anthropic', model: 'x' }, voice: { tts: {} } })).join('\n'), /voice\.tts: needs a baseURL/);
  assert.match(voiceProblems(Config.parse({ assistant, voice: {} })).join('\n'), /set stt/);
  assert.deepEqual(voiceProblems(Config.parse({ assistant, voice: { stt: {}, tts: {} } })), []);
});

test('page: says which halves are on, never where they go or the key', () => {
  const page = voiceForPage(Config.parse({ assistant, voice: { stt: { baseURL: 'http://speaches:8000/v1', apiKey: KEY }, speakReplies: true } }));
  assert.deepEqual(page, { listen: true, speak: false, speakReplies: true, autoSend: false });
  assert.doesNotMatch(JSON.stringify(page), /speaches|sk-|whisper/);
});

/** A stand-in speech server that remembers what it was sent. */
async function upstream(answer: (req: IncomingMessage, body: Buffer) => { status?: number; type?: string; body: string | Buffer }) {
  const seen: { path: string; headers: IncomingMessage['headers']; body: Buffer }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks); seen.push({ path: req.url!, headers: req.headers, body });
    const a = answer(req, body);
    res.writeHead(a.status ?? 200, { 'Content-Type': a.type ?? 'application/json' }); res.end(a.body);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  return { url, seen, close: () => new Promise<void>(r => server.close(() => r())) };
}

const appFor = (voice: ReturnType<typeof voiceOf>, extra: { refusal?: string; who?: string } = {}) => {
  const app = new Hono(), redact = (s: string) => s.split(KEY).join('•••');
  app.post('/api/voice/transcribe', c => transcribe(c, { voice, redact, who: extra.who ?? 'me', refusal: extra.refusal }));
  app.post('/api/voice/speak', c => speak(c, { voice, redact, who: extra.who ?? 'me', refusal: extra.refusal }));
  return app;
};
const clip = (type = 'audio/webm', size = 2048) => { const f = new FormData(); f.append('file', new Blob([new Uint8Array(size).fill(7)], { type }), 'x'); return f; };

test('transcribe: sends the OpenAI request (multipart file, model, language, json) and answers with the words alone', async () => {
  const up = await upstream(() => ({ body: JSON.stringify({ text: '  pause the downloads  ', usage: { seconds: 2 } }) }));
  const voice = voiceOf(Config.parse({ assistant, voice: { stt: { baseURL: up.url, apiKey: KEY, model: 'Systran/faster-whisper-small', language: 'en' } } }));
  const r = await appFor(voice, { who: 'shape' }).request('/api/voice/transcribe', { method: 'POST', body: clip('audio/mp4') });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: 'pause the downloads' });
  const got = up.seen[0];
  assert.equal(got.path, '/v1/audio/transcriptions');
  assert.equal(got.headers.authorization, `Bearer ${KEY}`);
  const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': got.headers['content-type']! }, body: got.body }).formData();
  const file = form.get('file') as File;
  assert.equal(file.name, 'speech.mp4');
  assert.equal(file.size, 2048);
  assert.equal(form.get('model'), 'Systran/faster-whisper-small');
  assert.equal(form.get('language'), 'en');
  assert.equal(form.get('response_format'), 'json');
  await up.close();
});

test('transcribe: refuses what it shouldn\'t pass on, and a failing server\'s answer never carries the key', async () => {
  const up = await upstream(() => ({ status: 401, body: JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }) }));
  const app = appFor(voiceOf(Config.parse({ assistant, voice: { stt: { baseURL: up.url, apiKey: KEY } } })), { who: 'refuse' });
  const post = (body: FormData | string, headers: Record<string, string> = {}) => app.request('/api/voice/transcribe', { method: 'POST', body, headers });
  assert.equal((await post(clip('text/html'))).status, 415);
  assert.equal((await post(clip('audio/webm', 0))).status, 400);
  assert.equal((await post('not a form', { 'Content-Type': 'text/plain' })).status, 400);
  assert.equal((await post(clip('audio/webm', MAX_AUDIO + 1))).status, 413);
  assert.equal(up.seen.length, 0, 'nothing refused reached the server');
  const failed = await post(clip());
  assert.equal(failed.status, 502);
  const text = await failed.text();
  assert.match(text, /answered 401: Incorrect API key/);
  assert.ok(!text.includes(KEY), 'no key in the answer');
  await up.close();
  // the server gone: says so, still without the key
  const down = await post(clip());
  assert.equal(down.status, 502);
  assert.match(await down.text(), /can't reach the voice server/);
});

test('speak: sends { model, input, voice, response_format: mp3, speed } and plays back MP3, nothing else', async () => {
  const up = await upstream(() => ({ type: 'text/html', body: Buffer.from([0xff, 0xf3, 1, 2, 3]) }));
  const voice = voiceOf(Config.parse({ assistant, voice: { tts: { baseURL: up.url, apiKey: KEY, model: 'kokoro', voice: 'af_heart', speed: 1.1 } } }));
  const r = await appFor(voice, { who: 'speak' }).request('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'All good.' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg', 'served as audio whatever the server called it');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0xff, 0xf3, 1, 2, 3]);
  assert.equal(up.seen[0].path, '/v1/audio/speech');
  assert.equal(up.seen[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(up.seen[0].body.toString()), { model: 'kokoro', input: 'All good.', voice: 'af_heart', response_format: 'mp3', speed: 1.1 });
  await up.close();
});

test('speak: text is capped, empty is refused, and a server error is redacted', async () => {
  const up = await upstream(() => ({ status: 500, body: JSON.stringify({ detail: `boom with ${KEY}` }) }));
  const app = appFor(voiceOf(Config.parse({ assistant, voice: { tts: { baseURL: up.url, apiKey: KEY } } })), { who: 'cap' });
  const say = (text: unknown) => app.request('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  assert.equal((await say('x'.repeat(MAX_SPEECH + 1))).status, 413);
  assert.equal((await say('   ')).status, 400);
  assert.equal((await say(42)).status, 400);
  assert.equal(up.seen.length, 0);
  const r = await say('hello');
  assert.equal(r.status, 502);
  const text = await r.text();
  assert.match(text, /answered 500: boom with/);
  assert.ok(!text.includes(KEY));
  await up.close();
});

test('limits: each person gets so many a minute; others aren\'t held up', async () => {
  const up = await upstream(() => ({ type: 'audio/mpeg', body: 'mp3' }));
  const voice = voiceOf(Config.parse({ assistant, voice: { tts: { baseURL: up.url } } }));
  const say = (who: string) => appFor(voice, { who }).request('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"hi"}' });
  for (let i = 0; i < PER_MINUTE.speak; i++) assert.equal((await say('busy')).status, 200);
  assert.equal((await say('busy')).status, 429);
  assert.equal((await say('someone else')).status, 200);
  await up.close();
});

test('off: unconfigured halves, no chat or the demo say so and call nothing', async () => {
  const sttOnly = voiceOf(Config.parse({ assistant, voice: { stt: { baseURL: 'http://127.0.0.1:9/v1' } } }));
  assert.equal((await appFor(sttOnly).request('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"hi"}' })).status, 404);
  assert.equal((await appFor(undefined).request('/api/voice/transcribe', { method: 'POST', body: clip() })).status, 404);
  assert.equal((await appFor(sttOnly, { refusal: "This demo doesn't listen or speak" }).request('/api/voice/transcribe', { method: 'POST', body: clip() })).status, 403);
});

test('sign-in: without a session the routes answer 401 and reach no speech server', async () => {
  const up = await upstream(() => ({ body: '{"text":"x"}' }));
  const log = console.log; console.log = () => {};
  const app = new Hono();
  const guard = await setupAuth(app, Config.parse({ auth: { mode: 'local' } }));
  console.log = log;
  app.use('/api/*', guard);
  const voice = voiceOf(Config.parse({ assistant, voice: { stt: { baseURL: up.url }, tts: {} } }));
  app.post('/api/voice/transcribe', c => transcribe(c, { voice, redact: s => s, who: 'x' }));
  app.post('/api/voice/speak', c => speak(c, { voice, redact: s => s, who: 'x' }));
  const conn = { incoming: { socket: { remoteAddress: '10.0.0.9', remotePort: 1, remoteFamily: 'IPv4' } } };
  assert.equal((await app.request('/api/voice/transcribe', { method: 'POST', body: clip() }, conn)).status, 401);
  assert.equal((await app.request('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"hi"}' }, conn)).status, 401);
  assert.equal(up.seen.length, 0);
  await up.close();
});

test('speakable: the words of an answer, without markdown, tables, code or links, and only the start', () => {
  assert.equal(speakable('**Plex** is up. See [the dashboard](https://x.lan/a) or `docker ps`.'), 'Plex is up. See the dashboard or docker ps.');
  assert.equal(speakable('## Downloads\n- Dune: 40%\n- Alien: done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nlog\n```\nAll fine.'), 'Downloads. Dune: 40%. Alien: done. All fine.');
  const long = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const cut = speakable(long);
  assert.ok(cut.length <= 1500 && cut.endsWith('.'), 'ends at a sentence');
  assert.equal(speakable(''), '');
});

test('recording: the first container the browser can make, Safari\'s mp4 when that\'s all there is', () => {
  assert.equal(recordingType(t => t.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(recordingType(t => t === 'audio/mp4'), 'audio/mp4');
  assert.equal(recordingType(() => false), '');
});

test('UI: the mic and the speaker show only when voice is configured', () => {
  const base = { name: 'Valet', model: 'm', ask: null, suggestions: [], onAsk: () => {} };
  const none = renderToString(<Assistant {...base} />);
  assert.doesNotMatch(none, /aria-label="Speak"|Read answers aloud|Stop reading answers aloud/);
  const both = renderToString(<Assistant {...base} voice={{ listen: true, speak: true, speakReplies: false, autoSend: false }} />);
  assert.match(both, /aria-label="Speak"/);
  assert.match(both, /aria-label="Read answers aloud"/);
  const listenOnly = renderToString(<Assistant {...base} voice={{ listen: true, speak: false, speakReplies: false, autoSend: false }} />);
  assert.match(listenOnly, /aria-label="Speak"/);
  assert.doesNotMatch(listenOnly, /answers aloud/);
});
