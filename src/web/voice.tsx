// Voice in the chat (`voice:` in the config): a mic in the message box and a speaker under it. The mic records in
// whatever the browser makes (Safari mp4, Chrome and Firefox webm/opus), sends it to Valet, and puts the words in the
// box to check; the speaker reads finished answers aloud. Valet does the talking to the speech server, so its address and
// key never reach the page. Nothing here sends a message on its own unless voice.autoSend says so, and nothing here
// approves anything: a spoken question is a typed one.
import { Mic, Square, Volume2, VolumeOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { label } from './format.ts';

/** What `/api/page` says about voice: which halves are on, and the two defaults. */
export interface VoiceUi { listen: boolean; speak: boolean; speakReplies: boolean; autoSend: boolean }

/** About as long as the server takes (10 MB at any browser's bitrate is well past this). */
export const MAX_SECONDS = 120;
/** How much of an answer is read aloud: the start, to a sentence's end. */
export const SPEAK_CAP = 1500;

/** The words of an answer as they'd be said: no markdown, links, code blocks, tables or addresses, and only the start. */
export function speakable(text: string, cap = SPEAK_CAP) {
  const t = text
    .replace(/```[^]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .split('\n')
    .filter(l => !/^\s*\|/.test(l) && !/^\s*[-:| ]{3,}$/.test(l))   // tables and rules say nothing aloud
    .map(l => l.replace(/^\s{0,3}(#{1,6}|>|[-*+•]|\d+[.)])\s+/, ''))
    .join('\n')
    .replace(/[*~#|]/g, '')
    .replace(/\s*\n\s*/g, '. ').replace(/([.!?:;,])\.\s/g, '$1 ').replace(/\s+/g, ' ').trim();
  if (t.length <= cap) return t;
  const cut = t.slice(0, cap), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > cap / 2 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ')).trim() + '…';
}

/** The first container this browser records in. Safari has only mp4; Chrome prefers webm. */
export function recordingType(can: (t: string) => boolean = t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2'].find(can) ?? '';
}

/** A problem with the mic, in words someone can act on. */
function micError(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow it for this site in the browser, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found.';
  if (name === 'NotReadableError') return 'The microphone is busy in another app.';
  return `Couldn't start the microphone${(e as Error)?.message ? `: ${(e as Error).message}` : ''}.`;
}

const said = async (r: Response) => { const j = await r.json().catch(() => null) as { error?: string } | null; return j?.error ?? `Valet answered ${r.status}`; };

type Phase = 'idle' | 'starting' | 'recording' | 'sending';
interface Live { rec: MediaRecorder; stream: MediaStream; ctx?: AudioContext; raf: number; timer: number; at: number; keep: boolean }

/** Recording: tap to start and tap to stop, or hold and let go. The words come back through `onText`. */
export function useRecorder({ onText, onError }: { onText: (t: string) => void; onError: (e: string) => void }) {
  const [phase, setPhase] = useState<Phase>('idle'), [level, setLevel] = useState(0), [secs, setSecs] = useState(0);
  const live = useRef<Live | null>(null);
  const cb = useRef({ onText, onError }); cb.current = { onText, onError };
  const release = () => {
    const l = live.current; if (!l) return;
    cancelAnimationFrame(l.raf); clearInterval(l.timer);
    for (const t of l.stream.getTracks()) t.stop();
    void l.ctx?.close().catch(() => {});
    setLevel(0);
  };
  const send = async (blob: Blob) => {
    setPhase('sending');
    try {
      const form = new FormData();
      form.append('file', blob, `speech.${blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
      const r = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
      if (!r.ok) throw new Error(await said(r));
      const { text } = await r.json() as { text: string };
      if (text.trim()) cb.current.onText(text.trim()); else cb.current.onError("Didn't catch anything. Try again a little closer to the mic.");
    } catch (e) { cb.current.onError((e as Error).message === 'Failed to fetch' ? "Can't reach Valet." : (e as Error).message); }
    finally { setPhase('idle'); }
  };
  const start = async () => {
    if (live.current || phase !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia) { cb.current.onError('The microphone needs a secure page (https, or localhost).'); return; }
    if (typeof MediaRecorder === 'undefined') { cb.current.onError("This browser can't record audio."); return; }
    setPhase('starting');
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { setPhase('idle'); cb.current.onError(micError(e)); return; }
    const type = recordingType(), rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined), chunks: Blob[] = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const l = { rec, stream, raf: 0, timer: 0, at: Date.now(), keep: true } as Live;
    rec.onstop = () => {
      const keep = l.keep && Date.now() - l.at > 400;
      release(); live.current = null;
      if (!keep || !chunks.length) { setPhase('idle'); return; }
      void send(new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] }));
    };
    // a level to show it's hearing something: the loudness of the last few milliseconds
    try {
      const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => { an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) sum += ((v - 128) / 128) ** 2; setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4)); l.raf = requestAnimationFrame(tick); };
      l.ctx = ctx; tick();
    } catch { /* no level, still recording */ }
    l.timer = window.setInterval(() => { const s = (Date.now() - l.at) / 1000; setSecs(s); if (s >= MAX_SECONDS) stop(); }, 200);
    live.current = l; setSecs(0);
    rec.start(250); setPhase('recording');
  };
  const stop = (keep = true) => { const l = live.current; if (!l) return; l.keep = keep; if (l.rec.state !== 'inactive') l.rec.stop(); else { release(); live.current = null; setPhase('idle'); } };
  useEffect(() => () => { if (live.current) { live.current.keep = false; live.current.rec.state !== 'inactive' && live.current.rec.stop(); release(); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return { phase, level, secs, start, stop };
}

/** The mic in the message box. A tap starts and the next tap stops; held down, letting go stops. */
export function MicButton({ rec, sheet, disabled }: { rec: ReturnType<typeof useRecorder>; sheet?: boolean; disabled?: boolean }) {
  const down = useRef(0);
  const on = rec.phase === 'recording' || rec.phase === 'starting';
  return (
    <button type="button" disabled={disabled || rec.phase === 'sending'} aria-label={on ? label('voiceStop') : label('voiceStart')} title={on ? label('voiceStop') : label('voiceStart')} aria-pressed={on}
      onPointerDown={e => { if (e.button) return; e.preventDefault(); if (on) { down.current = 0; rec.stop(); } else { down.current = Date.now(); void rec.start(); } }}
      onPointerUp={() => { if (down.current && Date.now() - down.current > 450) rec.stop(); down.current = 0; }}
      onClick={e => { if (e.detail === 0) { if (on) rec.stop(); else void rec.start(); } }}   // the keyboard's Enter or Space
      onContextMenu={e => e.preventDefault()}
      className={cn('press grid shrink-0 cursor-pointer touch-none place-items-center rounded-full select-none disabled:cursor-default disabled:opacity-50', sheet ? 'mb-[3px] size-8' : 'mb-1 size-7',
        on ? 'bg-bad/15 text-bad' : 'text-muted-foreground hover:bg-fill-2 hover:text-foreground')}>
      {on ? <Square className="size-3 fill-current" /> : <Mic className="size-icon" />}
    </button>
  );
}

/** In place of the text while it listens: a dot, how loud, how long, and a way out that keeps nothing. */
export function Listening({ rec }: { rec: ReturnType<typeof useRecorder> }) {
  const m = Math.floor(rec.secs / 60), s = Math.floor(rec.secs % 60);
  if (rec.phase === 'sending') return <div className="flex min-h-9 flex-1 items-center py-2 text-item text-muted-foreground"><span className="chat-shimmer">{label('voiceWriting')}</span></div>;
  return (
    <div className="flex min-h-9 flex-1 items-center gap-2.5 py-2 text-item" role="status" aria-label={label('voiceListening')}>
      <span className="size-2 shrink-0 rounded-full bg-bad" aria-hidden />
      <span className="flex h-4 items-center gap-[3px]" aria-hidden>
        {[.55, .8, 1, .8, .55].map((k, i) => <span key={i} className="w-[3px] rounded-full bg-foreground/60 transition-[height] duration-75" style={{ height: `${Math.max(3, Math.round(16 * Math.min(1, rec.level * k * 1.6)))}px` }} />)}
      </span>
      <span className="tabular text-muted-foreground">{m}:{String(s).padStart(2, '0')}</span>
      <span className="truncate text-meta text-muted-foreground">{label('voiceListening')}</span>
      <button type="button" onClick={() => rec.stop(false)} aria-label={label('voiceCancel')} title={label('voiceCancel')} className="ml-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-fill-2 hover:text-foreground"><X className="size-3.5" /></button>
    </div>
  );
}

const KEY = 'valet-speak';
const remembered = (fallback: boolean) => { try { const v = localStorage.getItem(KEY); return v === null ? fallback : v === '1'; } catch { return fallback; } };

/** A few milliseconds of silence, played from a tap so Safari lets the same player speak later, when an answer is done. */
function silence() {
  const n = 800, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o: number, s: string) => [...s].forEach((ch, i) => b.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
}

/** Answers read aloud: on or off per browser, one at a time, stopped by a tap or a new question. */
export function useSpeaker(fallback: boolean, onError: (e: string) => void) {
  const [on, setOn] = useState(() => remembered(fallback)), [speaking, setSpeaking] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null), turn = useRef(0), url = useRef<string | null>(null);
  const cb = useRef(onError); cb.current = onError;
  const el = () => player.current ??= new Audio();
  const drop = () => { if (url.current) { URL.revokeObjectURL(url.current); url.current = null; } };
  /** from a tap or a key: lets this player make sound later without one */
  const unlock = () => { const a = el(); if (a.src && !a.paused) return; const s = silence(); a.src = s; a.play().catch(() => {}).finally(() => URL.revokeObjectURL(s)); };
  const stop = () => { turn.current++; const a = player.current; if (a) { a.pause(); a.removeAttribute('src'); a.load(); } drop(); setSpeaking(false); };
  const say = async (text: string) => {
    const words = speakable(text); if (!words) return;
    stop(); const n = turn.current; setSpeaking(true);
    try {
      const r = await fetch('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: words }) });
      if (!r.ok) throw new Error(await said(r));
      const blob = await r.blob();
      if (n !== turn.current) return;
      const a = el(); drop(); url.current = URL.createObjectURL(blob); a.src = url.current;
      a.onended = () => { if (n === turn.current) { drop(); setSpeaking(false); } };
      await a.play();
    } catch (e) {
      if (n !== turn.current) return;
      setSpeaking(false);
      const name = (e as Error).name;
      cb.current(name === 'NotAllowedError' ? 'The browser blocked the sound. Tap the speaker once, then ask again.' : (e as Error).message === 'Failed to fetch' ? "Can't reach Valet." : `Couldn't read it aloud: ${(e as Error).message}`);
    }
  };
  const toggle = () => {
    const next = !on; setOn(next);
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* private mode: for this visit only */ }
    if (next) unlock(); else stop();
  };
  useEffect(() => () => { turn.current++; player.current?.pause(); drop(); }, []);
  return { on, speaking, toggle, say, stop, unlock };
}

/** The speaker under the message box, as quiet as the model's name beside it; a stop while it talks. */
export function SpeakerToggle({ speaker }: { speaker: ReturnType<typeof useSpeaker> }) {
  const words = speaker.speaking ? label('voiceSilence') : speaker.on ? label('voiceSpeakOff') : label('voiceSpeakOn');
  return (
    <button type="button" onClick={speaker.speaking ? speaker.stop : speaker.toggle} aria-label={words} title={words} aria-pressed={speaker.speaking ? undefined : speaker.on}
      className={cn('grid size-3.5 shrink-0 cursor-pointer place-items-center transition-colors hover:text-foreground focus-visible:text-foreground', speaker.on ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
      {speaker.speaking ? <Square className="size-2.5 fill-current" /> : speaker.on ? <Volume2 className="size-3.5" /> : <VolumeOff className="size-3.5" />}
    </button>
  );
}
