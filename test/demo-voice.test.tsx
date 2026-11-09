// The static demo's voice: every answer the script gives in fixed words has a recorded clip, found by the words Valet sends
// to be read; the rest fall back to the browser's voice (a 204); and the demo's mic only points to the docs, never recording.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';
import { demoAnswers, LIVE } from '../demo/voices.mjs';
import { speakable, voiceKey } from '../src/shared/speech.ts';
import { fetchSpeech } from '../src/web/voice.tsx';
import Assistant from '../src/web/assistant.tsx';

const dir = resolve('demo/voices'), manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));

test('demo voices: every fixed answer has a clip, by the words read aloud, and the set stays small', async () => {
  const answers = await demoAnswers();
  assert.ok(answers.length > 50, `the script's answers are all there (${answers.length})`);
  const missing = [];
  for (const w of answers) { const k = await voiceKey(w); if (!manifest.clips[k] || !existsSync(resolve(dir, manifest.clips[k]))) missing.push(w); }
  assert.deepEqual(missing, [], 'run npm run demo:voices to record these');
  for (const w of answers) assert.equal(speakable(w), w, 'kept as Valet would send them');
  const size = Object.values<string>(manifest.clips).reduce((n, f) => n + statSync(resolve(dir, f)).size, 0);
  assert.ok(size < 2.5e6, `${(size / 1e6).toFixed(2)} MB`);
  assert.ok(LIVE.length && !answers.some(w => /going at|is watching|CPU at|more minutes/.test(w)), 'nothing with live numbers');
});

test('demo voices: no clip is stale (each one\'s words are still an answer)', async () => {
  const keys = new Set(await Promise.all((await demoAnswers()).map(voiceKey)));
  assert.deepEqual(Object.keys(manifest.clips).filter(k => !keys.has(k)), []);
});

test('read aloud: a 204 means the browser speaks it, as the demo does for an answer with live numbers', async () => {
  const none = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  assert.equal(await fetchSpeech('3 going at 12 MB/s.', none), 'browser');
});

test('demo mic: shown, but never records or asks for the microphone, and says where voice is set up', () => {
  let asked = 0;
  const md = { getUserMedia: async () => { asked++; throw new Error('no'); } };
  Object.defineProperty(globalThis, 'navigator', { value: { ...(globalThis.navigator ?? {}), mediaDevices: md }, configurable: true });
  const base = { name: 'Valet', model: 'm', ask: null, suggestions: [], onAsk: () => {} };
  const html = renderToString(<Assistant {...base} voice={{ listen: true, speak: true, speakReplies: false, autoSend: false, demo: 'https://askvalet.dev/assistant/voice/' }} />);
  assert.match(html, /data-demo-mic/);
  assert.match(html, /aria-label="Speak"/);
  assert.doesNotMatch(html, / aria-pressed="/, 'not the real mic');
  assert.equal(asked, 0);
  // the demo mic's own code has no way to the microphone
  const src = readFileSync(resolve('src/web/voice.tsx'), 'utf8'), body = src.slice(src.indexOf('export function DemoMic'), src.indexOf('/** In place of the text while it listens'));
  assert.ok(body.length > 200);
  assert.doesNotMatch(body, /getUserMedia|MediaRecorder|rec\.|useRecorder/);
  assert.match(body, /Voice runs on your own Valet\./);
  // and the static demo's backend refuses to transcribe
  const backend = readFileSync(resolve('demo/static/backend.ts'), 'utf8');
  assert.match(backend, /if \(a !== 'speak' \|\| method !== 'POST'\) return json\(\{ error: 'Voice runs on your own Valet' \}, 403\)/);
});
