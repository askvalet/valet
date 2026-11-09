// The assistant in Telegram: the same chat, by message. Valet asks Telegram for new messages (long polling, so nothing
// needs to reach Valet from outside), hands each one to the chat exactly as the page would, and writes back the answer,
// its cards as a few plain lines, and an approval as two buttons. Nothing here decides what the assistant may do: the
// chat does, with the same access, approvals, redaction and activity log. Only the people listed in
// `assistant.telegram.users` are heard, only in a private chat, and anyone else gets no answer at all.
import type { UIMessage } from 'ai';
import type { Said } from './confirm.ts';
import type { Card } from '../shared/cards.ts';
import { plain } from '../shared/plain.ts';
import { splitThink } from '../shared/think.ts';

export interface TelegramDeps {
  token: string; users: number[]; name: string;
  /** the chat, as the page would post to it: the whole conversation in, a UI message stream out */
  chat(messages: UIMessage[], who: string, signal: AbortSignal): Promise<Response>;
  /** an approval's words, from the tool itself */
  confirm(tool: string, input: unknown): Promise<Said>;
  /** a tool's own past-tense label, for an approval it has no words for */
  label(tool: string): string | undefined;
  redact(s: string): string;
  fetch?: typeof fetch; log?: (line: string) => void; now?: () => number; api?: string;
}

type Part = { type: string; text?: string; state?: string; toolCallId?: string; toolName?: string; input?: any; output?: { data?: any; card?: Card }; errorText?: string; approval?: { id: string; approved?: boolean; isAutomatic?: boolean } };
interface Talk { messages: UIMessage[]; queue: Promise<unknown>; at: number; told: Set<string>; asks: Map<string, { call: string; message: number; text: string }>; n: number }
interface Update { update_id: number; message?: { message_id: number; date: number; text?: string; chat: { id: number; type: string }; from?: { id: number; first_name?: string } }; callback_query?: { id: string; data?: string; from: { id: number; first_name?: string }; message?: { message_id: number; chat: { id: number; type: string } } } }

const LONG = 4000, KEEP = 30, IDLE = 12 * 36e5, LATE = 120, POLL = 50;
const isTool = (p: Part) => p.type.startsWith('tool-') || p.type === 'dynamic-tool';
const toolOf = (p: Part) => p.type === 'dynamic-tool' ? p.toolName ?? '' : p.type.slice(5);
const asking = (p: Part) => isTool(p) && p.state === 'approval-requested' && !!p.approval && !p.approval.isAutomatic;
/** Markdown's marks read as noise in a plain message. */
const unmarked = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').trim();

/** The stream the chat answers with (server-sent events of JSON chunks), as the chunks themselves. */
export function chunksOf(body: ReadableStream<Uint8Array>, onError: (text: string) => void) {
  let rest = '';
  const text = new TextDecoder();
  const each = (frame: string, out: TransformStreamDefaultController<any>) => {
    for (const l of frame.split('\n')) {
      if (!l.startsWith('data: ') || l === 'data: [DONE]') continue;
      let chunk: any;
      try { chunk = JSON.parse(l.slice(6)); } catch { continue; }
      if (chunk?.type === 'error') onError(String(chunk.errorText ?? 'something went wrong'));
      out.enqueue(chunk);
    }
  };
  return body.pipeThrough(new TransformStream<Uint8Array, any>({
    transform(bytes, out) { const frames = (rest + text.decode(bytes, { stream: true })).split('\n\n'); rest = frames.pop()!; for (const f of frames) each(f, out); },
    flush(out) { if (rest.trim()) each(rest, out); },
  }));
}

export class Telegram {
  private talks = new Map<number, Talk>();
  private stopped = new AbortController();
  private strangers = new Set<number>();
  private d: Required<Pick<TelegramDeps, 'fetch' | 'log' | 'now' | 'api'>> & TelegramDeps;
  constructor(deps: TelegramDeps) { this.d = { ...deps, fetch: deps.fetch ?? fetch, log: deps.log ?? (l => console.log(l)), now: deps.now ?? Date.now, api: deps.api ?? 'https://api.telegram.org' }; }
  /** what makes it the same bot for the same people: a config reload that changes neither keeps it running */
  get key() { return `${this.d.token} ${[...this.d.users].sort().join(',')}`; }

  async call<T = any>(method: string, body: object = {}, ms = 15_000): Promise<T> {
    const r = await this.d.fetch(`${this.d.api}/bot${this.d.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([this.stopped.signal, AbortSignal.timeout(ms)]) });
    const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
    if (!r.ok || !j.ok) throw Object.assign(new Error(this.d.redact(j.description ?? `Telegram answered ${r.status}`)), { status: r.status });
    return j.result as T;
  }

  /** Listen until stopped. A refused token ends it; anything else waits a little longer each time and tries again. */
  async start() {
    let offset = 0, wait = 0;
    const pause = (ms: number) => new Promise<void>(ok => { const t = setTimeout(ok, ms); t.unref(); this.stopped.signal.addEventListener('abort', () => { clearTimeout(t); ok(); }, { once: true }); });
    try { const me = await this.call<{ username?: string }>('getMe'); this.d.log(`telegram: listening as @${me.username ?? '?'} for ${this.d.users.length} ${this.d.users.length === 1 ? 'person' : 'people'}`); }
    catch (e) { if (this.refused(e)) return; }
    while (!this.stopped.signal.aborted) {
      try {
        const updates = await this.call<Update[]>('getUpdates', { offset, timeout: POLL, allowed_updates: ['message', 'callback_query'] }, (POLL + 10) * 1000);
        wait = 0;
        for (const u of updates) { offset = u.update_id + 1; void this.handle(u).catch(e => this.d.log(`telegram: ${this.d.redact((e as Error).message)}`)); }
      } catch (e) {
        if (this.stopped.signal.aborted || this.refused(e)) return;
        // 409: something else is reading this bot's messages; only one can
        if ((e as { status?: number }).status === 409) this.d.log('telegram: another program is reading this bot\'s messages (one bot, one reader); trying again in a minute');
        wait = (e as { status?: number }).status === 409 ? 60_000 : Math.min(60_000, wait ? wait * 2 : 1000);
        await pause(wait);
      }
    }
  }
  private refused(e: unknown) {
    const s = (e as { status?: number }).status;
    if (s !== 401 && s !== 404) return false;
    this.d.log('telegram: the bot token was refused; check assistant.telegram.token');
    return true;
  }
  stop() { this.stopped.abort(); }

  private say(chat: number, text: string, more: object = {}) {
    const parts = text.length <= LONG ? [text] : text.match(new RegExp(`[\\s\\S]{1,${LONG}}`, 'g'))!;
    return parts.reduce<Promise<{ message_id: number } | undefined>>((p, t, i) => p.then(() => this.call('sendMessage', { chat_id: chat, text: t, ...(i === parts.length - 1 ? more : {}) })), Promise.resolve(undefined));
  }
  private talk(id: number): Talk {
    let t = this.talks.get(id);
    if (!t || this.d.now() - t.at > IDLE) this.talks.set(id, t = { messages: [], queue: Promise.resolve(), at: 0, told: new Set(), asks: new Map(), n: 0 });
    t.at = this.d.now();
    return t;
  }
  private heard(from?: { id: number }, chat?: { type: string }) {
    if (from && chat?.type === 'private' && this.d.users.includes(from.id)) return true;
    // said once per stranger, in the log only: it's how the owner finds their own id, and nobody outside learns anything
    if (from && !this.d.users.includes(from.id) && !this.strangers.has(from.id) && this.strangers.size < 100) { this.strangers.add(from.id); this.d.log(`telegram: ignored ${chat?.type === 'private' ? 'a message' : 'a group message'} from user ${from.id} (not in assistant.telegram.users)`); }
    return false;
  }

  /** One update from Telegram. Returns when everything it set off has been said. */
  async handle(u: Update) {
    const m = u.message, q = u.callback_query;
    if (m) {
      if (!this.heard(m.from, m.chat)) return;
      const chat = m.chat.id, text = m.text?.trim();
      if (!text) return void await this.say(chat, 'I can only read text here.');
      // a message that waited while Valet was away isn't acted on hours later
      if (this.d.now() / 1000 - m.date > LATE) return void await this.say(chat, 'That reached me late, so I left it. Send it again if you still want it.');
      if (/^\/(start|help)\b/.test(text)) return void await this.say(chat, `This is ${this.d.name}, the assistant on your Valet page. Ask anything you'd ask there. Anything that changes something asks first, with buttons. /new starts a fresh conversation.`);
      const t = this.talk(m.from!.id);
      if (/^\/new\b/.test(text)) { this.talks.delete(m.from!.id); return void await this.say(chat, 'Started fresh.'); }
      return this.enqueue(t, async () => {
        // asking something else instead of answering is a no, here as on the page (the chat tells the model so)
        for (const [, a] of t.asks) await this.call('editMessageText', { chat_id: chat, message_id: a.message, text: `${a.text}\n\nSkipped` }).catch(() => {});
        t.asks.clear();
        t.messages.push({ id: `tg${m.message_id}`, role: 'user', parts: [{ type: 'text', text: text.slice(0, LONG) }] });
        await this.turn(chat, t, m.from!);
      });
    }
    if (q?.message && q.data) {
      if (!this.heard(q.from, q.message.chat)) return void await this.call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
      const chat = q.message.chat.id, t = this.talk(q.from.id), [verb, key] = q.data.split(':'), a = t.asks.get(key);
      const last = t.messages.at(-1), part = a && last?.role === 'assistant' ? (last.parts as Part[]).find(p => p.toolCallId === a.call && asking(p)) : undefined;
      if (!a || !part || (verb !== 'ok' && verb !== 'no')) return void await this.call('answerCallbackQuery', { callback_query_id: q.id, text: 'That\'s no longer waiting.' }).catch(() => {});
      const ok = verb === 'ok';
      t.asks.delete(key);
      Object.assign(part, { state: 'approval-responded', approval: { ...part.approval, approved: ok } });
      await this.call('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
      await this.call('editMessageText', { chat_id: chat, message_id: a.message, text: `${a.text}\n\n${ok ? 'Approved' : 'Not done'}` }).catch(() => {});
      // several approvals in one answer: the chat goes on when the last one is answered
      if ((last!.parts as Part[]).some(asking)) return;
      return this.enqueue(t, () => this.turn(chat, t, q.from));
    }
  }
  private enqueue(t: Talk, work: () => Promise<void>) { return t.queue = t.queue.then(work, work); }

  /** Post the conversation to the chat and say what came back: words, cards as lines, approvals as buttons. */
  private async turn(chat: number, t: Talk, from: { id: number; first_name?: string }) {
    const typing = () => void this.call('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {});
    typing();
    const beat = setInterval(typing, 4500);
    beat.unref();
    let failed = '';
    try {
      const who = `${(from.first_name ?? String(from.id)).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 32) || from.id} (Telegram)`;
      const r = await this.d.chat(t.messages, who, this.stopped.signal);
      if (!r.ok || !r.body) return void await this.say(chat, this.d.redact(String((await r.json().catch(() => ({})) as { error?: string }).error ?? 'The assistant couldn\'t answer just now.')));
      const { readUIMessageStream } = await import('ai');
      // an answer after an approval carries on the same reply, as it does on the page
      const before = t.messages.at(-1), carried = before?.role === 'assistant' ? before : undefined;
      let reply: UIMessage | undefined;
      for await (const now of readUIMessageStream({ message: carried && structuredClone(carried), stream: chunksOf(r.body, e => { failed = e; }), onError: e => { failed ||= (e as Error)?.message ?? String(e); } })) reply = now;
      if (reply) {
        if (!reply.id) reply.id = `tg-a${t.n++}`;
        if (carried) t.messages[t.messages.length - 1] = reply; else t.messages.push(reply);
        await this.tell(chat, t, reply);
      }
      if (failed) await this.say(chat, this.d.redact(failed).slice(0, 500));
      else if (!reply) await this.say(chat, 'The assistant had nothing to say.');
    } catch (e) {
      if (!this.stopped.signal.aborted) { this.d.log(`telegram: ${this.d.redact((e as Error).message)}`); await this.say(chat, 'The assistant couldn\'t answer just now.').catch(() => {}); }
    } finally {
      clearInterval(beat);
      // long conversations keep their recent part here; the chat sizes what it sends to the model itself
      while (t.messages.length > KEEP && t.messages.slice(1).some(m => m.role === 'user')) { t.messages.shift(); while (t.messages.length && t.messages[0].role !== 'user') t.messages.shift(); }
      if (t.told.size > 500) t.told = new Set([...t.told].slice(-200));
    }
  }

  private async tell(chat: number, t: Talk, reply: UIMessage) {
    const once = (key: string) => !t.told.has(key) && !!t.told.add(key);
    for (const [i, p] of (reply.parts as Part[]).entries()) {
      if (p.type === 'text' && p.state !== 'streaming') {
        const said = unmarked(splitThink(p.text ?? '').said);
        if (said && once(`t:${reply.id}:${i}`)) await this.say(chat, said);
      } else if (isTool(p) && p.state === 'output-available') {
        const lines = p.output?.card ? plain(p.output.card) : p.output?.data?.error ? `Couldn't do that: ${p.output.data.error}` : '';
        if (lines && once(`o:${p.toolCallId}`)) await this.say(chat, lines);
      } else if (isTool(p) && p.state === 'output-error') {
        if (once(`o:${p.toolCallId}`)) await this.say(chat, `Couldn't do that: ${this.d.redact(p.errorText ?? 'it failed')}`.slice(0, 500));
      } else if (asking(p) && once(`a:${p.toolCallId}`)) {
        const tool = toolOf(p), said = await this.d.confirm(tool, p.input).catch(() => ({} as Said));
        const steps = said.steps ? (p.input?.steps as { why?: string }[] ?? []).map((s, n) => `${n + 1}. ${said.steps![n]?.title ?? s.why ?? 'a step'}`) : [];
        // with no words of the tool's own, say which tool and with what, so nobody approves blind
        const text = said.steps ? [p.input?.title ?? 'Do all of this?', ...steps].join('\n')
          : said.title ? [said.title, said.detail].filter(Boolean).join('\n')
          : [`${this.d.label(tool) ?? tool.replace(/__/g, ': ').replace(/_/g, ' ')}?`, this.d.redact(JSON.stringify(p.input ?? {})).slice(0, 300)].join('\n');
        const key = String(t.n++);
        const sent = await this.say(chat, text, { reply_markup: { inline_keyboard: [[{ text: said.verb ?? 'Approve', callback_data: `ok:${key}` }, { text: 'Not now', callback_data: `no:${key}` }]] } });
        if (sent) t.asks.set(key, { call: p.toolCallId!, message: sent.message_id, text });
      }
    }
  }
}
