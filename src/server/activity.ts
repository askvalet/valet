// Everything Valet changed: who asked, how, what it did and whether it worked. The answer to "did you just trigger my
// vacuum?". Kept in data/activity.json, newest last, with secrets redacted before they're stored.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface Entry { id: number; at: number; who: string; via: 'chat' | 'plan' | 'page' | 'watch' | 'pin'; what: string; input?: unknown; ok: boolean; error?: string; undo?: { tool: string; input: unknown }; undone?: boolean }
const FILE = () => resolve(process.env.VALET_DATA ?? 'data', 'activity.json');

export class Activity {
  entries: Entry[] = [];
  private redact: (s: string) => string;
  private saving: Promise<void> = Promise.resolve();
  constructor(redact: (s: string) => string = s => s) { this.redact = redact; }
  async load() { this.entries = await readFile(FILE(), 'utf8').then(JSON.parse).catch(() => []); return this; }
  add(e: Omit<Entry, 'id' | 'at'>) {
    const clean: Entry = { ...JSON.parse(this.redact(JSON.stringify(e))), id: (this.entries.at(-1)?.id ?? 0) + 1, at: Date.now() };
    this.entries.push(clean);
    if (this.entries.length > 2000) this.entries.splice(0, this.entries.length - 2000);
    // one write at a time: two at once would race over the temp file
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(FILE()), { recursive: true });
      await writeFile(`${FILE()}.tmp`, JSON.stringify(this.entries), { mode: 0o600 }); await rename(`${FILE()}.tmp`, FILE());
    }).catch(err => console.error(`activity: ${err.message}`));
    return clean;
  }
  recent(n = 30) { return this.entries.slice(-n).reverse(); }
}
