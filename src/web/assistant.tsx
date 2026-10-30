// The assistant panel. Loaded on first use. Text streams in; tool results arrive as cards from the same catalog the
// homepage uses; anything that changes something waits for an explicit Approve.
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import {
  Activity, ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, ChevronRight, Copy, CornerDownRight, FileText, Lightbulb, Loader2, Paperclip, RotateCcw,
  Pin, Search, Square, X, Zap,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Card } from '../shared/cards.ts';
import { splitThink } from '../shared/think.ts';
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

/** The model's reasoning: "Thinking" while it streams, then "Thought for 3s" that opens to show the words. */
function Reasoning({ text, streaming, took }: { text: string; streaming: boolean; took?: number }) {
  const [open, setOpen] = useState(false);
  if (!text.trim() && !streaming) return null;
  return (
    <div className="text-[13px]">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')} />
        <span className={cn(streaming && 'chat-shimmer')}>{streaming ? 'Thinking' : `Thought${took ? ` for ${(took / 1000).toFixed(took < 10_000 ? 1 : 0)}s` : ''}`}</span>
      </button>
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out', open ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="overflow-hidden"><div className="border-l-2 border-white/10 pl-3 leading-relaxed whitespace-pre-wrap text-muted-foreground">{text.trim()}</div></div>
      </div>
    </div>
  );
}

export type ToolInfo = { label?: string; followUps?: string[]; access: 'read' | 'write' | 'control' };

// What a tool did, in words, with the thing it was given: "Searched documents · uber receipt". Integrations name it
// (`label`); MCP tools and the built-in show fall back to their own names.
const ICON = { read: Search, write: Bookmark, control: Zap } as const;
const verbOf = (name: string, tools: Record<string, ToolInfo>) => {
  const t = tools[name];
  if (name === 'show') return ['Laid out cards', Lightbulb] as const;
  if (name === 'search_everything') return ['Searched everything', Search] as const;
  if (name === 'plan') return ['Made a plan', Zap] as const;
  return [t?.label ?? toolLabel(name).replace(/^\w/, c => c.toUpperCase()), t ? ICON[t.access] : Activity] as const;
};
const argOf = (input: any) => {
  if (!input || typeof input !== 'object') return '';
  const v = input.summary ?? input.query ?? input.url ?? input.entity_id ?? input.title ?? input.id ?? input.text ?? Object.values(input).find(x => typeof x !== 'object');
  const t = Array.isArray(v) ? v.filter(x => typeof x !== 'object').join(', ') : v == null || typeof v === 'object' ? '' : String(v);
  try { if (input.url) return new URL(t).hostname.replace(/^www\./, ''); } catch {}
  return t.length > 36 ? t.slice(0, 34) + '…' : t;
};

/** A run of tool calls as compact chips: what it did, with what, and whether it worked. Collapses once the answer's in. */
function ToolChips({ parts, settled, tools }: { parts: any[]; settled: boolean; tools: Record<string, ToolInfo> }) {
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
            const [verb, I] = verbOf(name(p), tools), arg = argOf(p.input);
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

/** Keep this card on the page: it stays live by re-running the tool, with no model involved. */
function PinButton({ tool, input }: { tool: string; input: unknown }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const pin = async () => {
    setState('busy');
    const r = await fetch('/api/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, input }) }).catch(() => null);
    setState(r?.ok ? 'done' : 'failed');
  };
  return (
    <button onClick={pin} disabled={state === 'busy' || state === 'done'} data-done={state === 'done' || undefined} aria-label="Keep on the page" title={state === 'failed' ? "Couldn't pin that" : 'Keep on the page'}
      className="chat-pin chat-icon glass-round rounded-lg!">{state === 'done' ? <Check className="morph size-3.5 text-good" /> : state === 'busy' ? <Loader2 className="size-3.5 animate-spin" /> : <Pin className={cn('size-3.5', state === 'failed' && 'text-bad')} />}</button>
  );
}

function ToolPart({ p, approve, tools = {}, canPin }: { p: any; approve: (id: string, ok: boolean) => void; tools?: Record<string, ToolInfo>; canPin?: boolean }) {
  const label = toolLabel(p.type === 'dynamic-tool' ? p.toolName : p.type);
  const name = p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, '');
  if (p.state === 'approval-requested' && !p.approval?.isAutomatic) return (
    <div className="chat-card rounded-2xl border bg-card p-4 shadow-card">
      <div className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Needs your OK</div>
      <div className="text-sm font-medium first-letter:uppercase">{p.input?.steps ? p.input.title : p.input?.ops ? 'Save this change to your config?' : `${label}?`}</div>
      {p.input?.steps ? (
        // a plan: every step, in order, before any of them runs
        <ol className="mt-2 space-y-2">
          {p.input.steps.map((s: any, i: number) => (
            <li key={i} className="flex gap-2.5 text-[13px]">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold tabular">{i + 1}</span>
              <span className="min-w-0"><span className="font-medium">{tools[s.tool]?.label ?? toolLabel(s.tool)}</span>
                {Object.keys(s.input ?? {}).length > 0 && <span className="ml-1.5 break-all text-xs text-muted-foreground">{Object.values(s.input).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ')}</span>}
                <span className="block text-xs text-muted-foreground">{s.why}</span></span>
            </li>
          ))}
        </ol>
      ) : p.input?.ops ? (
        // a change to the config: what it means, then exactly what it writes
        <div className="mt-1 space-y-1.5 text-xs text-muted-foreground">
          {p.input.summary && <div>{p.input.summary}</div>}
          <pre className="max-h-48 overflow-auto rounded-lg bg-white/[.06] p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">{p.input.ops.map((o: any) => `${o.op} ${o.path.join('.')}${o.value === undefined ? '' : ` = ${JSON.stringify(o.value)}`}`).join('\n')}</pre>
        </div>
      ) : p.input && Object.keys(p.input).length > 0 && <div className="mt-1 break-all text-xs text-muted-foreground">{Object.entries(p.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(' · ')}</div>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="max-sm:h-10 max-sm:flex-1" onClick={() => approve(p.approval.id, true)}>Approve</Button>
        <Button size="sm" variant="outline" className="max-sm:h-10 max-sm:flex-1" onClick={() => approve(p.approval.id, false)}>Don't</Button>
      </div>
    </div>
  );
  if (p.state === 'output-available') {
    const card = p.output?.card as Card | undefined;
    if (card) return (
      <div className="chat-card chat-pinnable relative">
        <Widget card={card} compact />
        {canPin && (name === 'show' || (tools[name]?.access === 'read' && !name.startsWith('config__'))) && <PinButton tool={name} input={p.input ?? {}} />}
      </div>
    );
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

/** A question answered in ⌘K: the same tools, approvals and cards as the chat, in one short reply. */
export function InlineAnswer({ text, tools, onMore }: { text: string; tools: Record<string, ToolInfo>; onMore: () => void }) {
  const [one] = useState(() => new Chat({ transport: new DefaultChatTransport({ api: '/api/chat' }), sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses }));
  const { messages, sendMessage, status, addToolApprovalResponse, error } = useChat({ chat: one });
  const started = useRef(0);
  useEffect(() => { if (!started.current) { started.current = Date.now(); sendMessage({ text }); } }, [sendMessage, text]);
  const reply = messages.filter(m => m.role === 'assistant').at(-1), busy = status === 'submitted' || status === 'streaming';
  const said = (reply?.parts ?? []).filter((p: any) => p.type === 'text').map((p: any) => splitThink(p.text).said).join('\n\n').trim();
  const steps = (reply?.parts ?? []).filter((p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool');
  return (
    <div className="space-y-3">
      <div className="text-[13px] text-muted-foreground">{text}</div>
      {steps.length > 0 && <ToolChips parts={steps} tools={tools} settled={!busy} />}
      {steps.map((p: any, i) => <ToolPart key={i} p={p} tools={tools} approve={(id, ok) => addToolApprovalResponse({ id, approved: ok })} />)}
      {said && <Text text={said} />}
      {busy && !said && <Pending since={started.current || Date.now()} />}
      {error && <div className="text-sm text-bad">Couldn't reach the model: {error.message}</div>}
      {!busy && reply && (
        <button onClick={() => { chat.messages = [...chat.messages, ...one.messages]; onMore(); }} className="press flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <CornerDownRight className="size-3.5" />Continue in chat
        </button>
      )}
    </div>
  );
}

export default function Assistant({ name, model, ask, suggestions, tools = {}, external, onAsk, onClose, canPin }: {
  name: string; model: string; ask: { text: string; n: number } | null; suggestions: string[]; tools?: Record<string, ToolInfo>; onAsk: (t: string) => void;
  canPin?: boolean;
  external?: boolean;   // the chat is another agent's (assistant.agent), with tools of its own
  onClose?: () => void;   // shown as a phone sheet: a grabber to drag it away, and room for fingers and the keyboard
}) {
  const sheet = !!onClose;
  // dragging the header pulls the sheet down with the finger; far or fast enough lets it go, otherwise it rides back
  const pull = useRef<{ y: number; t: number; el: HTMLElement } | null>(null);
  const grab = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const el = e.currentTarget.closest<HTMLElement>('.chat-pop'); if (!el) return;
      e.currentTarget.setPointerCapture(e.pointerId); el.style.transition = 'none'; pull.current = { y: e.clientY, t: Date.now(), el };
    },
    onPointerMove: (e: React.PointerEvent) => { const p = pull.current; if (p) p.el.style.transform = `translateY(${Math.max(0, e.clientY - p.y)}px)`; },
    onPointerUp: (e: React.PointerEvent) => {
      const p = pull.current; if (!p) return; pull.current = null;
      const dy = e.clientY - p.y;
      if (dy > 140 || dy / (Date.now() - p.t) > .6) { onClose?.(); return; }
      p.el.style.transition = 'transform 280ms var(--ease-drawer)'; p.el.style.transform = '';
    },
  };
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
  const filePicker = useRef<HTMLInputElement>(null);
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
  const scroller = useRef<HTMLDivElement>(null);
  // follow the reply as it streams, unless the person scrolled up to read; then offer a way back down
  const [away, setAway] = useState(false);
  const onScroll = () => { const el = scroller.current; if (el) setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 80); };
  const busy = status === 'submitted' || status === 'streaming';

  // questions from the ⌘K palette arrive through `ask`
  useEffect(() => { if (ask && ask.n !== sent.current) { sent.current = ask.n; sendMessage({ text: ask.text }); } }, [ask, sendMessage]);
  useEffect(() => { if (!away) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, status, away]);

  const ready = files.filter(f => f.id), uploading = files.some(f => !f.id && !f.error);
  const submit = () => {
    if ((!draft.trim() && !ready.length) || busy || uploading) return;
    const lines = ready.map(f => `[attached: ${f.name} (file id ${f.id})]`);
    sendMessage({ text: [draft.trim() || 'File this.', ...lines].join('\n') }); setDraft(''); setFiles([]);
  };

  return (
    <div className="relative flex h-full flex-col">
      <header {...(sheet ? grab : {})} className={cn('relative flex items-center gap-2.5 border-b px-5', sheet ? 'touch-none pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 select-none' : 'py-4')}>
        {sheet && <span className="sheet-grip absolute top-[max(.4rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2" aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{model}</div>
        </div>
        {sheet && <button onClick={onClose} onPointerDown={e => e.stopPropagation()} aria-label="Close" className="press grid size-9 place-items-center rounded-full bg-white/[.08]"><ChevronDown className="size-[18px]" /></button>}
      </header>

      {external && <div className="border-b px-5 py-2 text-[12.5px] text-muted-foreground">{name} runs its own tools. Atrium's approvals and access levels don't apply, and answers are plain text.</div>}
      <div ref={scroller} onScroll={onScroll} className={cn('relative flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5', sheet && !messages.length && 'flex flex-col justify-end')}>
        {!messages.length && (
          // on a phone the suggestions sit low, where the thumb is
          <div className={cn('text-center animate-in fade-in duration-500', !sheet && 'pt-10')}>
            <div className="text-lg font-semibold tracking-tight">What would you like to know?</div>
            <p className="mt-1 text-sm text-muted-foreground">Ask about anything on your homepage.</p>
            <div className="mx-auto mt-6 grid max-w-[560px] gap-1.5 sm:grid-cols-2">
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
          const blocks: ReactNode[] = [], thoughts: string[] = []; let run: any[] = [], thinking = false;
          const flush = (k: string) => { if (run.length) { const r = run; blocks.push(<ToolChips key={`c${k}`} parts={r} tools={tools} settled={!live || m.parts.some((p: any) => p.type === 'text' && p.text.trim())} />, ...r.map((p, j) => <ToolPart key={`p${k}.${j}`} p={p} tools={tools} canPin={canPin} approve={(id, ok) => addToolApprovalResponse({ id, approved: ok })} />)); run = []; } };
          m.parts.forEach((p: any, i) => {
            if (p.type.startsWith('tool-') || p.type === 'dynamic-tool') run.push(p);
            else if (p.type === 'reasoning') { thoughts.push(p.text ?? ''); thinking ||= live && p.state === 'streaming'; }
            else if (p.type === 'text' && p.text.trim()) {
              // reasoning a model left in its reply goes with the rest of its reasoning
              const t = splitThink(p.text);
              if (t.thought) thoughts.push(t.thought);
              thinking ||= live && t.thinking;
              if (t.said) { flush(String(i)); blocks.push(<Text key={i} text={t.said} />); }
            }
          });
          if (thoughts.some(t => t.trim()) || thinking) blocks.unshift(<Reasoning key="thought" text={thoughts.join('\n\n')} streaming={thinking} took={took[m.id]} />);
          flush('end');
          const text = m.parts.filter((p: any) => p.type === 'text').map((p: any) => splitThink(p.text).said).join('\n\n').trim();
          // the last tool it used that suggests next questions
          const used = m.parts.filter((p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool').map((p: any) => p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, ''));
          const follow = isLast && !busy ? used.map((t: string) => tools[t]?.followUps).filter(Boolean).at(-1)?.slice(0, 2) ?? [] : [];
          return (
            <div key={m.id} className="space-y-3">
              {blocks}
              {live && !text && !m.parts.some((p: any) => ((p.type.startsWith('tool-') || p.type === 'dynamic-tool') && p.state !== 'output-available') || (p.type === 'reasoning' && p.state === 'streaming')) && !thinking && <Pending since={started.current || Date.now()} label={m.parts.length ? 'Writing' : 'Thinking'} />}
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
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left max-sm:py-2.5 text-[13.5px] text-muted-foreground transition-colors fill-mode-both hover:bg-white/[.05] hover:text-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
                      <CornerDownRight className="size-3.5 shrink-0 opacity-60" />{f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {status === 'submitted' && messages.at(-1)?.role === 'user' && <Pending since={started.current || Date.now()} />}
        {error && (
          <div className="chat-error flex items-center gap-3 rounded-2xl border border-bad/20 bg-bad/[.06] px-4 py-3 text-sm">
            <span className="min-w-0 flex-1"><span className="font-medium">Couldn't reach the model.</span> <span className="text-muted-foreground">{error.message}</span></span>
            <button onClick={() => regenerate()} className="press shrink-0 rounded-full bg-white/10 px-3 py-1 text-[12.5px] transition-colors hover:bg-white/15">Try again</button>
          </div>
        )}
        <div ref={end} />
      </div>
      {away && (
        <button onClick={() => { setAway(false); end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }} aria-label="Jump to the latest"
          className="to-latest glass-round absolute bottom-[88px] left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-foreground/85">
          <ArrowDown className="size-3.5" />{busy ? 'Writing…' : 'Latest'}
        </button>
      )}

      <form className={cn('border-t p-3', sheet && 'pb-[max(.75rem,env(safe-area-inset-bottom))]')} onSubmit={e => { e.preventDefault(); submit(); }}
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
        <div className={cn('composer flex items-end gap-2 rounded-2xl border bg-card px-3 py-2 shadow-card', over && 'ring-2 ring-primary/60')}>
          <input ref={filePicker} type="file" multiple hidden onChange={e => { if (e.target.files) attach(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => filePicker.current?.click()} aria-label="Attach a file" className={cn('mb-0.5 grid shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground', sheet ? 'size-8' : 'size-7')}><Paperclip className="size-4" /></button>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1} placeholder={sheet || external ? `Message ${name}` : `Message ${name}, paste a link or drop a file`} aria-label="Message"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); attach(e.clipboardData.files); } }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[16px] outline-none field-sizing-content placeholder:text-muted-foreground sm:text-[15px]" autoFocus={!sheet} />
          {busy
            ? <Button type="button" size="icon" variant="secondary" className="size-8 rounded-full" onClick={stop} aria-label="Stop"><Square className="morph size-3 fill-current" /></Button>
            : <Button type="submit" size="icon" className="size-8 rounded-full transition-opacity duration-200" disabled={(!draft.trim() && !ready.length) || uploading} aria-label="Send"><ArrowUp className="morph" /></Button>}
        </div>
      </form>
    </div>
  );
}
