// Everything Valet changed: who asked, how, what it did and whether it worked. The answer to "did you just trigger my
// vacuum?". Kept in data/activity.json, newest last, with secrets redacted before they're stored.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sandbox } from './sandbox.ts';

export interface Entry { id: number; at: number; who: string; via: 'chat' | 'plan' | 'page' | 'watch' | 'pin' | 'mcp' | 'rule'; rule?: string; what: string; input?: unknown; ok: boolean; error?: string; undo?: { tool: string; input: unknown }; undone?: boolean; action?: string; target?: string }   // rule: the rule that did it · action: what was done, in past-tense words; target: what to
// the input fields that name the thing acted on, in the order they're worth reading; ids and numbers say nothing to a person
const NAMING = ['title', 'name', 'who', 'query', 'url', 'say', 'text'];
const host = (s: string) => { try { return /^https?:/.test(s) ? new URL(s).hostname.replace(/^www\./, '') : s; } catch { return s; } };
export function targetOf(input: unknown) {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {}, k = NAMING.find(n => typeof o[n] === 'string' && o[n]);
  if (!k) return undefined;
  const s = host(String(o[k]));
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}
/** "Requested Dune", "Searched for Dune", "Stopped a stream: Theo". */
export function sentence(e: Pick<Entry, 'what' | 'action' | 'target' | 'input'>) {
  const did = e.action ?? e.what, t = e.target ?? targetOf(e.input);
  if (!t || did.includes(t)) return did;
  return /\b(it|that|this)$/.test(did) ? did.replace(/\b(it|that|this)$/, t) : /\s/.test(did) ? `${did}: ${t}` : `${did} ${t}`;
}
/** How it went, then who, in the words of the log: "worked · you in chat". */
export function outcome(e: Pick<Entry, 'ok' | 'error' | 'undone' | 'who' | 'via'>) {
  const how = e.undone ? 'undone' : e.ok ? 'worked' : `failed${e.error ? `: ${e.error}` : ''}`;
  return `${how} · ${e.who}${e.via === 'chat' ? ' in chat' : e.via === 'plan' ? ' in a plan' : e.via === 'watch' ? ', by a reminder' : e.via === 'rule' ? ', by a rule' : ''}`;
}
const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'activity.json');

export class Activity {
  entries: Entry[] = [];
  private redact: (s: string) => string;
  private saving: Promise<void> = Promise.resolve();
  constructor(redact: (s: string) => string = s => s) { this.redact = redact; }
  async load() { this.entries = await readFile(FILE(), 'utf8').then(JSON.parse).catch(() => []); return this; }
  add(e: Omit<Entry, 'id' | 'at'>) {
    const clean: Entry = { ...JSON.parse(this.redact(JSON.stringify({ ...e, action: e.action ?? e.what, target: e.target ?? targetOf(e.input) }))), id: (this.entries.at(-1)?.id ?? 0) + 1, at: Date.now() };
    this.entries.push(clean);
    if (this.entries.length > 2000) this.entries.splice(0, this.entries.length - 2000);
    if (sandbox.on) return clean;
    // one write at a time: two at once would race over the temp file
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(FILE()), { recursive: true });
      await writeFile(`${FILE()}.tmp`, JSON.stringify(this.entries), { mode: 0o600 }); await rename(`${FILE()}.tmp`, FILE());
    }).catch(err => console.error(`activity: ${err.message}`));
    return clean;
  }
  recent(n = 30) { return this.entries.slice(-n).reverse(); }
}
