// The demo's voice: every answer the scripted model gives in the same words each time, read aloud once by a real speech
// server and kept as small MP3s in demo/voices, so the static demo's speaker plays them with no server. Each clip is named
// by a hash of the words Valet would send to be read (src/shared/speech.ts), so the page finds it by the answer itself;
// an answer with live numbers in it (the downloads, what's playing, the server's load, the next meeting) has no clip and
// the browser's own voice reads it.
//
//   SPEECH_URL=http://localhost:8000/v1 npm run demo:voices      any OpenAI-compatible /audio/speech (Speaches, OpenAI)
//   SPEECH_VIA=<container> npm run demo:voices                   ask from inside a container on the speech server's network
//
// SPEECH_MODEL and SPEECH_VOICE pick the voice (Kokoro's af_heart by default); SPEECH_KEY is sent as a bearer token. Clips
// whose words haven't changed are kept, and ones no answer uses any more are removed. Needs ffmpeg.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { fmt } from '../src/server/core.ts';
import { Backups, backupParts } from '../src/server/backups.ts';
import { speakable, voiceKey } from '../src/shared/speech.ts';
import plugin from './integrations/homelab.mjs';
import { ABOUT, can, reply } from './mock-model.mjs';

/** Tools whose answers carry numbers that move, so no recording would match them for long. */
export const LIVE = ['downloads_status', 'plex_streams', 'system_status', 'calendar_next_meeting'];

const ROOMS = ['living room', 'kitchen', 'dining room', 'hallway', 'office', 'bedroom', 'bathroom', 'guest room'];
/** What a visitor can ask: the suggestions, the follow-ups and the demo's own commands, and one way of asking each thing the
 *  script knows. Orders are answered both ways, approved and not. */
export const ASKED = [
  'Hi', 'Thanks', 'Show me my year in review', 'What can you do?', 'How do I add a service Valet doesn\'t support?',
  ...Object.keys(ABOUT).map(t => `What's ${t} about?`), 'What\'s Dune about?',
  'Restart Mealie', 'Why is Mealie down?', 'What took Mealie down?', 'Is Bazarr ok?', 'Are the backups ok?', 'Is anything down?',
  'What should we watch tonight?', 'How are the drives?', 'Anything happen overnight?', 'What happened overnight? Keep it to a few lines.',
  'Can you read this PDF?', 'Lock the front door', 'Are the lights on?', 'Remember my name', 'What\'s the weather like?',
  'Add an internet speed card', 'Undo', 'Pause downloads', 'Pause Pi-hole', 'Resume Pi-hole', 'Stop the stream',
  'Turn off all the lights', 'Turn on all the lights', ...ROOMS.flatMap(r => [`Turn off the ${r} lights`, `Turn on the ${r} lights`]),
  ...[18, 19, 20, 21, 22, 23].map(t => `Set the thermostat to ${t}`), 'Set the thermostat to sleep', 'Set the thermostat to home', 'Turn off the heating', 'Turn on the heating',
  'Start the vacuum', 'Dock the vacuum', 'Find the vacuum', 'Vacuum the kitchen', 'Vacuum the living room',
  'Tell me when Oppenheimer finishes downloading', 'Tell me when Andor finishes downloading',
];

/** Every answer the demo gives in fixed words, as Valet would send them to be read: speakable, and each one once. */
export async function demoAnswers() {
  const lab = plugin({ z, fmt, defineIntegration: i => i });
  const inst = lab.create(lab.config.parse({}), { image: r => `/x/${r}`, http: () => Promise.reject(new Error('no network')), session: () => ({ get: async () => '', reset() {} }) });
  const backups = new Backups(); backups.sources = () => [{ id: 'lab', name: lab.name, instance: inst }];
  const own = { backups_status: backupParts(backups).tool, watch_add: { run: async () => ({ data: { set: true } }) } };
  const tools = [...Object.keys(inst.tools).map(n => `lab__${n}`), 'valet__backups_status', 'valet__watch_add'].map(name => ({ function: { name } }));
  const out = new Set();
  const say = text => { const w = speakable(String(text ?? '')); if (w) out.add(w); };
  const told = [{ role: 'assistant', content: `Hi! ${can}` }];
  for (const q of ASKED) for (const before of [[], told]) {
    const messages = [...before, { role: 'user', content: q }], r = reply({ tools, messages });
    if (!r.call) { say(r.text); continue; }
    const [, name] = r.call.name.split('__');
    if (LIVE.includes(name)) continue;
    const t = inst.tools[name] ?? own[name], args = JSON.parse(r.call.args);
    const { data } = await t.run(t.input ? t.input.parse(args) : args);
    say(reply({ tools, messages: [...messages, { role: 'tool', content: JSON.stringify(data) }] }).text);
    if (t.access && t.access !== 'read' || name === 'watch_add') say(reply({ tools, messages: [...messages, { role: 'tool', content: JSON.stringify({ denied: true }) }] }).text);
  }
  return [...out];
}

const dir = resolve(import.meta.dirname, 'voices'), manifestFile = resolve(dir, 'manifest.json');

async function speak(words) {
  const url = (process.env.SPEECH_URL ?? 'http://speaches:8000/v1').replace(/\/$/, '') + '/audio/speech';
  const body = JSON.stringify({ model: process.env.SPEECH_MODEL ?? 'speaches-ai/Kokoro-82M-v1.0-ONNX', voice: process.env.SPEECH_VOICE ?? 'af_heart', input: words, response_format: 'mp3', speed: 1 });
  const headers = { 'Content-Type': 'application/json', ...(process.env.SPEECH_KEY ? { Authorization: `Bearer ${process.env.SPEECH_KEY}` } : {}) };
  if (process.env.SPEECH_VIA) {
    // the speech server has no published port: the request goes from a container that can reach it, and the MP3 comes back on stdout
    const js = `const r = await fetch(${JSON.stringify(url)}, { method: 'POST', headers: ${JSON.stringify(headers)}, body: process.argv[1] }); if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); } process.stdout.write(Buffer.from(await r.arrayBuffer()));`;
    return execFileSync('docker', ['exec', process.env.SPEECH_VIA, 'node', '--input-type=module', '-e', js, body], { maxBuffer: 2 ** 26 });
  }
  const r = await fetch(url, { method: 'POST', headers, body });
  if (!r.ok) throw new Error(`${url} answered ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  mkdirSync(dir, { recursive: true });
  const before = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { clips: {} }, clips = {}, words = {};
  const voice = `${process.env.SPEECH_MODEL ?? 'speaches-ai/Kokoro-82M-v1.0-ONNX'} ${process.env.SPEECH_VOICE ?? 'af_heart'}`, same = before.voice === voice;
  let made = 0;
  for (const w of (await demoAnswers()).sort()) {
    const key = await voiceKey(w), file = `${key}.mp3`;
    clips[key] = file; words[key] = w;
    if (same && existsSync(resolve(dir, file))) continue;
    const raw = await speak(w);
    // small: one channel at Kokoro's own 24 kHz, 32 kbps, which is plenty for a voice
    writeFileSync(resolve(dir, file), execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-b:a', '32k', '-map_metadata', '-1', '-f', 'mp3', 'pipe:1'], { input: raw, maxBuffer: 2 ** 26 }));
    made++;
  }
  for (const f of readdirSync(dir)) if (f.endsWith('.mp3') && !Object.values(clips).includes(f)) rmSync(resolve(dir, f));
  writeFileSync(manifestFile, JSON.stringify({ voice, clips, words }, null, 1) + '\n');
  const size = readdirSync(dir).reduce((n, f) => n + statSync(resolve(dir, f)).size, 0);
  console.log(`demo voices: ${Object.keys(clips).length} clips (${made} new), ${(size / 1e6).toFixed(2)} MB in ${dir}`);
}
if (process.argv[1]?.endsWith('voices.mjs')) await main();
