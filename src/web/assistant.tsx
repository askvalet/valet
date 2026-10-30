// The assistant panel. Loaded on first use. Text streams in; tool results arrive as cards from the same catalog the
// homepage uses; anything that changes something waits for an explicit Approve.
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import {
  Activity, ArrowUp, Bookmark, Check, ChevronRight, Copy, CornerDownRight, FileText, Film, Lightbulb, Loader2, Paperclip, RotateCcw,
  Search, Square, X, Zap,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Card } from '../shared/cards.ts';
import { Widget } from './cards.tsx';

// One conversation for the whole page session, so closing and reopening the panel keeps it.
const chat = new Chat({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});

// Tool names are "<instance>__<tool>"; show "downloads · pause downloads".
const toolLabel = (name: string) => name.replace(/^tool-/, '').replace(/^mcp_/, '').replace('__', ' · ').replace(/_/g, ' ');

/** Just enough markdown for chat replies: paragraphs, **bold**, *italic*, `code`, line breaks. While a reply streams,
 *  each new word fades up out of a slight blur; words already shown keep their keys, so only new ones animate. */
function Text({ text }: { text: string }) {
  const words = (t: string, k: string) => t.split(/(\s+)/).map((w, i) => /^\s+$/.test(w) || !w ? w : <span key={`${k}.${i}`} className="chat-word">{w}</span>);
  return (
    <div className="prose-chat text-[15px] leading-relaxed">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\n)/g).map((t, j) =>
          t.startsWith('**') ? <strong key={j}>{words(t.slice(2, -2), `${i}.${j}`)}</strong>
            : t.startsWith('*') && t.length > 2 ? <em key={j}>{words(t.slice(1, -1), `${i}.${j}`)}</em>
              : t.startsWith('`') ? <code key={j}>{t.slice(1, -1)}</code>
                : t === '\n' ? <br key={j} /> : <Fragment key={j}>{words(t, `${i}.${j}`)}</Fragment>)}</p>
      ))}
    </div>
  );
}

/** "Thinking" with a light sweeping across it and the seconds ticking, like a model that's actually working. */
function Pending({ since, label = 'Thinking' }: { since: number; label?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  return (
    <div className="flex items-center gap-2.5 text-sm animate-in fade-in duration-300">
      <span className="chat-dots" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 3 + Math.floor(i / 3)) * 120}ms` }} />)}</span>
      <span className="chat-shimmer font-medium">{label}</span>
      <span className="tabular text-xs text-muted-foreground">{((now - since) / 1000).toFixed(1)}s</span>
    </div>
  );
}

// What a tool did, in words, with the thing it was given: "Searched documents · uber receipt"
const VERB: [RegExp, string, typeof Search][] = [
  [/docs_search/, 'Searched documents', Search], [/docs_read/, 'Read a document', FileText], [/docs_add/, 'Filed a document', FileText],
  [/bookmarks_search/, 'Searched saved links', Search], [/bookmark_read/, 'Read a bookmark', Bookmark], [/bookmark_save/, 'Saved a link', Bookmark],
  [/plex|streams|recently_added|history/, 'Checked Plex', Film], [/service_status/, 'Checked services', Activity], [/downloads/, 'Checked downloads', Activity],
  [/home_find/, 'Looked up the home', Search], [/home_control|light|press/, 'Changed the home', Zap], [/show/, 'Laid out cards', Lightbulb],
  [/status|local_ai|pc_status|system/, 'Checked status', Activity],
];
const verbOf = (name: string) => VERB.find(([re]) => re.test(name)) ?? [/./, toolLabel(name).replace(/^\w/, c => c.toUpperCase()), Lightbulb] as const;
const argOf = (input: any) => {
  if (!input || typeof input !== 'object') return '';
  const v = input.query ?? input.url ?? input.entity_id ?? input.title ?? input.id ?? input.text ?? Object.values(input)[0];
  const t = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
  try { if (input.url) return new URL(t).hostname.replace(/^www\./, ''); } catch {}
  return t.length > 36 ? t.slice(0, 34) + '…' : t;
};

/** A run of tool calls as compact chips: what it did, with what, and whether it worked. Collapses once the answer's in. */
function ToolChips({ parts, settled }: { parts: any[]; settled: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? !settled;
  const name = (p: any) => p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, '');
  return (
    <div className="text-[13px]">
      {parts.length > 1 && (
        <button onClick={() => setOpen(!shown)} className="mb-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight className={cn('size-3.5 transition-transform duration-200', shown && 'rotate-90')} />{parts.length} steps
        </button>
      )}
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out', shown || parts.length === 1 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="space-y-1 overflow-hidden">
          {parts.map((p, i) => {
            const [, verb, I] = verbOf(name(p)), arg = argOf(p.input);
            const done = p.state === 'output-available', failed = p.state === 'output-error' || p.output?.data?.error, denied = p.state === 'output-denied';
            return (
              <div key={i} className="flex min-w-0 items-center gap-2 text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
                <I className="size-3.5 shrink-0" />
                <span className={cn('shrink-0', !done && !failed && !denied && 'chat-shimmer')}>{denied ? `Skipped: ${verb.toLowerCase()}` : verb}</span>
                {arg && <span className="truncate rounded-md bg-white/[.06] px-1.5 py-px font-mono text-[11.5px] text-foreground/75">{arg}</span>}
                <span className="ml-auto shrink-0">{failed ? <X className="size-3.5 text-bad" /> : done ? <Check className="size-3.5 text-good" /> : denied ? null : <Loader2 className="size-3.5 animate-spin" />}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// After an answer, a couple of natural next questions, depending on what it just looked at
const FOLLOW: [RegExp, string[]][] = [
  [/docs_search|docs_read/, ['Summarize these', 'Anything due soon?']], [/bookmark/, ['Summarize the newest one', 'What else did I save this week?']],
  [/plex|streams/, ['What was added recently?', 'Who watched the most this week?']], [/service_status/, ['How is the server doing?', 'Show downloads']],
  [/downloads/, ['When will it finish?', 'Pause downloads']], [/home/, ['Which lights are on?', 'Turn off all lights']],
];

function ToolPart({ p, approve }: { p: any; approve: (id: string, ok: boolean) => void }) {
  const label = toolLabel(p.type === 'dynamic-tool' ? p.toolName : p.type);
  if (p.state === 'approval-requested' && !p.approval?.isAutomatic) return (
    <div className="chat-card rounded-2xl border bg-card p-4 shadow-card">
      <div className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Needs your OK</div>
      <div className="text-sm font-medium first-letter:uppercase">{label}?</div>
      {p.input && Object.keys(p.input).length > 0 && <div className="mt-1 break-all text-xs text-muted-foreground">{Object.entries(p.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(' · ')}</div>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => approve(p.approval.id, true)}>Approve</Button>
        <Button size="sm" variant="outline" onClick={() => approve(p.approval.id, false)}>Don't</Button>
      </div>
    </div>
  );
  if (p.state === 'output-available') {
    const card = p.output?.card as Card | undefined;
    if (card) return <div className="chat-card"><Widget card={card} compact /></div>;
    const mcp = Array.isArray(p.output?.content) ? p.output.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : '';
    if (mcp) return (
      <details className="group rounded-xl border bg-card px-4 py-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /><span className="first-letter:uppercase">{label}</span></summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs">{mcp.slice(0, 4000)}</pre>
      </details>
    );
    if (p.output?.data?.error) return <div className="text-sm text-warn">{label}: {p.output.data.error}</div>;
    return null;
  }
  if (p.state === 'output-error') return <div className="text-sm text-bad">{label} failed: {p.errorText}</div>;
  return null;
}

export default function Assistant({ name, model, ask, suggestions, onAsk }: {
  name: string; model: string; ask: { text: string; n: number } | null; suggestions: string[]; onAsk: (t: string) => void;
}) {
  const { messages, sendMessage, status, addToolApprovalResponse, error, stop, regenerate } = useChat({ chat });
  // how long each answer took, measured from the question to the last word
  const started = useRef(0);
  const [took, setTook] = useState<Record<string, number>>({});
  const busyNow = status === 'submitted' || status === 'streaming';
  useEffect(() => {
    if (busyNow && !started.current) started.current = Date.now();
    if (!busyNow && started.current) {
      const last = [...messages].reverse().find(m => m.role === 'assistant');
      const ms = Date.now() - started.current;
      if (last) setTook(t => ({ ...t, [last.id]: ms }));
      started.current = 0;
    }
  }, [busyNow, messages]);
  const [copied, setCopied] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // files pasted, dropped or picked: uploaded right away, then named in the message so a tool can file them
  const [files, setFiles] = useState<{ key: number; name: string; id?: string; error?: string }[]>([]);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const attach = (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      const key = Math.random();
      setFiles(fs => [...fs, { key, name: f.name || 'pasted' }]);
      fetch('/api/files', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || 'pasted') }, body: f })
        .then(r => r.json()).then(j => setFiles(fs => fs.map(x => x.key === key ? (j.id ? { ...x, id: j.id, name: j.name } : { ...x, error: j.error ?? 'upload failed' }) : x)))
        .catch(() => setFiles(fs => fs.map(x => x.key === key ? { ...x, error: 'upload failed' } : x)));
    }
  };
  const sent = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const busy = status === 'submitted' || status === 'streaming';

  // questions from the ⌘K palette arrive through `ask`
  useEffect(() => { if (ask && ask.n !== sent.current) { sent.current = ask.n; sendMessage({ text: ask.text }); } }, [ask, sendMessage]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, status]);

  const ready = files.filter(f => f.id), uploading = files.some(f => !f.id && !f.error);
  const submit = () => {
    if ((!draft.trim() && !ready.length) || busy || uploading) return;
    const lines = ready.map(f => `[attached: ${f.name} (file id ${f.id})]`);
    sendMessage({ text: [draft.trim() || 'File this.', ...lines].join('\n') }); setDraft(''); setFiles([]);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{model}</div>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {!messages.length && (
          <div className="pt-10 text-center animate-in fade-in duration-500">
            <div className="text-lg font-semibold tracking-tight">What would you like to know?</div>
            <p className="mt-1 text-sm text-muted-foreground">Ask about anything on your homepage.</p>
            <div className="mt-6 flex flex-col items-stretch gap-1.5">
              {suggestions.map((s, i) => (
                <button key={s} onClick={() => onAsk(s)} style={{ animationDelay: `${120 + i * 50}ms` }}
                  className="press flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[.03] px-3.5 py-2.5 text-left text-sm text-foreground/85 transition-colors fill-mode-both hover:bg-white/[.07] hover:text-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, mi) => {
          if (m.role === 'user') return (
            <div key={m.id} className="flex justify-end">
              <div className="chat-in max-w-[85%] rounded-[20px] rounded-br-md bg-primary px-3.5 py-2 text-[15px] text-primary-foreground">
                {m.parts.map((p, i) => p.type === 'text' ? <span key={i} className="whitespace-pre-wrap">{p.text.replace(/\n?\[attached: ([^(\]]+) \(file id [a-f0-9]+\)\]/g, '\n📎 $1')}</span> : null)}
              </div>
            </div>
          );
          // a reply: runs of tool calls become one chip list, followed by any cards they returned, then the words
          const isLast = mi === messages.length - 1, live = isLast && busy;
          const blocks: ReactNode[] = []; let run: any[] = [];
          const flush = (k: string) => { if (run.length) { const r = run; blocks.push(<ToolChips key={`c${k}`} parts={r} settled={!live || m.parts.some((p: any) => p.type === 'text' && p.text.trim())} />, ...r.map((p, j) => <ToolPart key={`p${k}.${j}`} p={p} approve={(id, ok) => addToolApprovalResponse({ id, approved: ok })} />)); run = []; } };
          m.parts.forEach((p: any, i) => {
            if (p.type.startsWith('tool-') || p.type === 'dynamic-tool') run.push(p);
            else if (p.type === 'text' && p.text.trim()) { flush(String(i)); blocks.push(<Text key={i} text={p.text} />); }
          });
          flush('end');
          const text = m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n\n').trim();
          const tools = m.parts.filter((p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool').map((p: any) => p.type === 'dynamic-tool' ? p.toolName : p.type);
          const follow = isLast && !busy ? (FOLLOW.find(([re]) => tools.some(t => re.test(t)))?.[1] ?? []) : [];
          return (
            <div key={m.id} className="space-y-3">
              {blocks}
              {live && !text && !m.parts.some((p: any) => (p.type.startsWith('tool-') || p.type === 'dynamic-tool') && p.state !== 'output-available') && <Pending since={started.current || Date.now()} label={m.parts.length ? 'Writing' : 'Thinking'} />}
              {!live && text && (
                <div className="flex items-center gap-1 text-muted-foreground animate-in fade-in duration-500">
                  <button aria-label="Copy" title="Copy" onClick={() => { navigator.clipboard?.writeText(text); setCopied(m.id); setTimeout(() => setCopied(null), 1400); }}
                    className="chat-icon">{copied === m.id ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}</button>
                  {isLast && <button aria-label="Ask again" title="Ask again" onClick={() => regenerate()} className="chat-icon"><RotateCcw className="size-3.5" /></button>}
                  {took[m.id] != null && <span className="ml-1 text-[11.5px] tabular">Worked for {(took[m.id] / 1000).toFixed(took[m.id] < 10_000 ? 1 : 0)}s</span>}
                </div>
              )}
              {follow.length > 0 && (
                <div className="space-y-0.5 pt-1">
                  {follow.map((f, k) => (
                    <button key={f} onClick={() => onAsk(f)} style={{ animationDelay: `${150 + k * 60}ms` }}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[13.5px] text-muted-foreground transition-colors fill-mode-both hover:bg-white/[.05] hover:text-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
                      <CornerDownRight className="size-3.5 shrink-0 opacity-60" />{f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {status === 'submitted' && messages.at(-1)?.role === 'user' && <Pending since={started.current || Date.now()} />}
        {error && <div className="text-sm text-bad">Couldn't reach the model: {error.message}</div>}
        <div ref={end} />
      </div>

      <form className="border-t p-3" onSubmit={e => { e.preventDefault(); submit(); }}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); attach(e.dataTransfer.files); } }}>
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map(f => (
              <span key={f.key} className={cn('flex max-w-[220px] items-center gap-1.5 rounded-full bg-secondary py-1 pr-1.5 pl-2.5 text-xs', f.error && 'text-bad')}>
                {f.id ? <FileText className="size-3.5 shrink-0" /> : f.error ? null : <Loader2 className="size-3.5 shrink-0 animate-spin" />}
                <span className="truncate">{f.error ? `${f.name}: ${f.error}` : f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(fs => fs.filter(x => x.key !== f.key))} className="grid size-4 place-items-center rounded-full hover:bg-white/10"><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className={cn('flex items-end gap-2 rounded-2xl border bg-card px-3 py-2 shadow-card focus-within:ring-2 focus-within:ring-ring/30', over && 'ring-2 ring-primary/60')}>
          <input ref={pick} type="file" multiple hidden onChange={e => { if (e.target.files) attach(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => pick.current?.click()} aria-label="Attach a file" className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><Paperclip className="size-4" /></button>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1} placeholder={`Message ${name}, paste a link or drop a file`} aria-label="Message"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); attach(e.clipboardData.files); } }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none field-sizing-content placeholder:text-muted-foreground" autoFocus />
          {busy
            ? <Button type="button" size="icon" variant="secondary" className="size-8 rounded-full" onClick={stop} aria-label="Stop"><Square className="tick size-3 fill-current" /></Button>
            : <Button type="submit" size="icon" className={cn('size-8 rounded-full')} disabled={(!draft.trim() && !ready.length) || uploading} aria-label="Send"><ArrowUp className="tick" /></Button>}
        </div>
      </form>
    </div>
  );
}
