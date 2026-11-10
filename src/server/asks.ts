// Approvals asked from outside the chat: something that isn't an owner on the page (an MCP client, or someone whose
// profile says `approve: owner`) wants a tool run that changes something. It waits here until an owner says yes or no on
// the page. Nothing runs on the asker's word: what's approved is one tool with one exact input, once, and an answer that
// comes after the asker stopped waiting is kept a few minutes for the same call, then forgotten. A handful at most wait
// at a time, so the page can't be flooded.
import { createHash, randomBytes } from 'node:crypto';
import type { Confirm } from '../shared/cards.ts';

export interface Ask { id: string; at: number; until: number; from: string; tool: string; said: Partial<Confirm> & { title: string } }
type Answer = 'approved' | 'declined' | 'waiting' | 'full';
interface Held { ask: Ask; hash: string; waiters: Set<(a: Answer) => void> }

export const ASK_FOR = 10 * 60_000, WAITING = 5;
export const hashOf = (tool: string, input: unknown) => createHash('sha256').update(`${tool}\n${JSON.stringify(input, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1)) : v)}`).digest('hex');

export class Asks {
  private held = new Map<string, Held>();
  private granted = new Map<string, number>();   // hash → until: a yes whose asker had stopped waiting
  private said = new Map<string, string>();      // hash → who said yes, for the log of what then runs
  listeners = new Set<() => void>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  private sweep() {
    const t = this.now();
    let gone = false;
    for (const [id, h] of this.held) if (h.ask.until <= t) { this.held.delete(id); for (const w of h.waiters) w('waiting'); gone = true; }
    for (const [k, until] of this.granted) if (until <= t) { this.granted.delete(k); this.said.delete(k); }
    if (gone) this.changed();
  }
  private changed() { for (const l of this.listeners) l(); }
  list(): Ask[] { this.sweep(); return [...this.held.values()].map(h => h.ask); }

  /** A yes given earlier for exactly this call, used up by asking. */
  take(hash: string) { this.sweep(); return this.granted.delete(hash); }

  /** Put the question on the page and wait up to `wait` ms for the answer. Asking again for the same call joins the
   *  question that's already there (`fresh` says whether this one put it there). */
  request(o: { from: string; tool: string; hash: string; said: Ask['said'] }, wait: number): { fresh: boolean; answer: Promise<Answer> } {
    this.sweep();
    let h = [...this.held.values()].find(x => x.hash === o.hash);
    const fresh = !h;
    if (!h) {
      if (this.held.size >= WAITING) return { fresh: false, answer: Promise.resolve('full') };
      const at = this.now();
      h = { ask: { id: randomBytes(9).toString('base64url'), at, until: at + ASK_FOR, from: o.from, tool: o.tool, said: o.said }, hash: o.hash, waiters: new Set() };
      this.held.set(h.ask.id, h);
      this.changed();
    }
    const mine = h;
    return { fresh, answer: new Promise<Answer>(done => {
      const t = setTimeout(() => { mine.waiters.delete(end); done('waiting'); }, wait);
      t.unref();
      const end = (a: Answer) => { clearTimeout(t); done(a); };
      mine.waiters.add(end);
    }) };
  }

  /** Who approved this call, told once to whoever runs it. */
  approver(hash: string) { const by = this.said.get(hash); this.said.delete(hash); return by; }

  /** The person's answer, from the page (`by`: their account). False if it's no longer waiting. */
  answer(id: string, ok: boolean, by?: string) {
    this.sweep();
    const h = this.held.get(id);
    if (!h) return null;
    this.held.delete(id);
    if (ok && by) { if (this.said.size > 50) this.said.clear(); this.said.set(h.hash, by); }
    // nobody still on the line: keep a yes for the same call, for as long as the question would have stood
    if (ok && !h.waiters.size) this.granted.set(h.hash, h.ask.until);
    for (const w of h.waiters) w(ok ? 'approved' : 'declined');
    this.changed();
    return h.ask;
  }
}
