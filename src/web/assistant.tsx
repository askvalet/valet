// The assistant panel. Loaded on first use. Text streams in; tool results arrive as cards from the same catalog the
// homepage uses; anything that changes something waits for an explicit Approve.
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai';
import {
  Activity, ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, ChevronRight, Copy, CornerDownRight, FileText, Lightbulb, Loader2, Paperclip, RotateCcw,
  Pin, Search, Square, X, Zap,
} from 'lucide-react';
import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { ChatBeam } from './beam.tsx';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/utils';
import type { Card, Confirm } from '../shared/cards.ts';
import { splitThink } from '../shared/think.ts';
import { Icon } from './cards.tsx';
import { Approval, ChatCard, type ToolInfo } from './approval.tsx';
import { Tick } from './feel.tsx';
import { label, num } from './format.ts';
import { play } from './sound.ts';

/** What `chat:` says about the window. */
export interface ChatUi { followUps?: string[]; review?: string; steps: boolean; thinking: 'collapsed' | 'open' | 'hidden'; send: 'enter' | 'mod-enter'; icon?: string; beam?: 'off' | 'always' | 'focus' | 'thinking' | 'once'; beamColor?: 'colorful' | 'mono' | 'ocean' | 'sunset'; beamStrength?: number }
const Ui = createContext<ChatUi>({ steps: true, thinking: 'collapsed', send: 'enter' });

// One conversation for the whole page session, so closing and reopening the panel keeps it.
// a long chat's early messages stay on screen, but only the recent ones are sent: the server would drop the rest anyway
const lastOnly = ({ messages, body, id }: any) => ({ body: { ...body, id, messages: messages.slice(-24) } });
// the last question from `ask` already sent; kept with the chat because the panel remounts on every navigation
let lastAsk = 0;
const chat = new Chat({
  transport: new DefaultChatTransport({ api: '/api/chat', prepareSendMessagesRequest: lastOnly }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});

// Tool names are "<instance>__<tool>"; show "downloads · pause downloads".
const toolLabel = (name: string) => name.replace(/^tool-/, '').replace(/^mcp_/, '').replace('__', ' · ').replace(/_/g, ' ');

/** Just enough markdown for chat replies: paragraphs, **bold**, *italic*, `code`, line breaks. While a reply streams,
 *  each new word fades up out of a slight blur; words already shown keep their keys, so only new ones animate. */
function TextView({ text, live }: { text: string; live?: boolean }) {
  // only a reply still arriving gets a span per word; a finished one is plain text, so old messages cost nothing
  const words = (t: string, k: string) => !live ? t : t.split(/(\s+)/).map((w, i) => /^\s+$/.test(w) || !w ? w : <span key={`${k}.${i}`} className="chat-word">{w}</span>);
  return (
    <div className="prose-chat text-item leading-relaxed">
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

const Text = memo(TextView);

/** "Thinking" with a light sweeping across it and the seconds ticking, like a model that's actually working. */
function Pending({ since, label: text = label('thinking') }: { since: number; label?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  return (
    <div className="flex items-center gap-2.5 text-item animate-in fade-in duration-(--dur-pop)">
      <ThinkingOrb state="working" size={20} />
      <span className="chat-shimmer font-medium">{text}</span>
      <span className="tabular text-meta text-muted-foreground">{(Math.max(0, now - since) / 1000).toFixed(1)}s</span>
    </div>
  );
}

/** The model's reasoning: "Thinking" while it streams, then "Thought for 3s" that opens to show the words. */
function Reasoning({ text, streaming, took }: { text: string; streaming: boolean; took?: number }) {
  const ui = useContext(Ui), [open, setOpen] = useState(ui.thinking === 'open');
  if ((!text.trim() && !streaming) || ui.thinking === 'hidden') return null;
  return (
    <div className="text-body">
      <button onClick={() => setOpen(o => !o)} className="press flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn('size-icon-sm transition-transform duration-(--dur-pop)', open && 'rotate-90')} />
        {streaming && <ThinkingOrb state="searching" size={20} />}<span className={cn(streaming && 'chat-shimmer')}>{streaming ? label('thinking') : took ? label('thoughtFor', { n: (took / 1000).toFixed(took < 10_000 ? 1 : 0) }) : label('thought')}</span>
      </button>
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-(--dur-move) ease-out', open ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="overflow-hidden"><div className="border-l-2 border-white/10 pl-3 leading-relaxed whitespace-pre-wrap text-muted-foreground">{text.trim()}</div></div>
      </div>
    </div>
  );
}

export type { ToolInfo } from './approval.tsx';

// What a tool did, in words, with the thing it was given: "Searched documents · uber receipt". Integrations name it
// (`label`); MCP tools and the built-in show fall back to their own names.
const ICON = { read: Search, write: Bookmark, control: Zap } as const;
const verbOf = (name: string, tools: Record<string, ToolInfo>) => {
  const t = tools[name];
  if (name === 'show') return ['Laid out cards', Lightbulb] as const;
  if (name === 'search_everything') return ['Searched everything', Search] as const;
  if (name === 'plan') return ['Made a plan', Zap] as const;
  if (name === 'present') return ['Laid it out', Lightbulb] as const;
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
function ToolChips({ parts: all, settled, tools, fresh }: { parts: any[]; settled: boolean; tools: Record<string, ToolInfo>; fresh?: boolean }) {
  const parts = all.filter(p => p.state !== 'approval-requested' || p.approval?.isAutomatic);   // the card asking says it, and nothing has happened yet
  const [open, setOpen] = useState<boolean | null>(null);
  const [peek, setPeek] = useState<string | null>(null);   // a step's card, opened from its line
  const waited = useRef(new Set<string>());   // only what was seen unfinished draws its tick; the chat reopened just has them
  const shown = open ?? !settled;
  const name = (p: any) => p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, '');
  if (!parts.length || !useContext(Ui).steps) return null;
  return (
    <div className="text-body">
      {parts.length > 1 && (
        <button onClick={() => setOpen(!shown)} className="press mb-1 flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn('size-icon-sm transition-transform duration-(--dur-pop)', shown && 'rotate-90')} />{label('steps', { n: parts.length })}
        </button>
      )}
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-(--dur-move) ease-out', shown || parts.length === 1 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="max-w-[560px] space-y-1 overflow-hidden">
          {parts.map((p, i) => {
            const [verb, I] = verbOf(name(p), tools), arg = argOf(p.input), card = p.output?.card as Card | undefined;
            const done = p.state === 'output-available', failed = p.state === 'output-error' || p.output?.data?.error, denied = p.state === 'output-denied';
            if (!done) waited.current.add(p.toolCallId);
            return (
              <Fragment key={i}>
              <button type="button" disabled={!card} onClick={() => setPeek(x => x === p.toolCallId ? null : p.toolCallId)} className={cn('flex w-full min-w-0 items-center gap-2 text-left text-muted-foreground', card && 'transition-colors hover:text-foreground')}>
                <I className="size-3.5 shrink-0" />
                <span className={cn('shrink-0', !done && !failed && !denied && 'chat-shimmer')}>{denied ? `Skipped: ${verb.toLowerCase()}` : verb}</span>
                {arg && <span className="truncate rounded-tag bg-fill-1 px-1.5 py-px font-mono text-meta text-foreground/75">{arg}</span>}
                <span className="ml-auto shrink-0">{failed ? <X className="size-icon-sm text-bad" /> : done ? <Tick className="size-3.5 text-good" draw={waited.current.has(p.toolCallId) && (tools[name(p)]?.access ?? 'read') !== 'read'} /> : denied ? null : <ThinkingOrb state={(tools[name(p)]?.access ?? 'read') === 'read' ? 'connecting' : 'listening'} size={20} />}</span>
              </button>
              {peek === p.toolCallId && card && <div className="chat-peek py-1"><ChatCard first={card} name={name(p)} input={p.input} tools={tools} fresh={fresh} /></div>}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ids and hashes mean nothing to a person, and the service has the real name of anything they point at
const plainInput = (input: Record<string, unknown>) => Object.entries(input).filter(([k, v]) => !/(^|_)(id|hash|uuid|key|token)$/i.test(k) && typeof v === 'string' && v !== '').map(([, v]) => v).slice(0, 2).join(' · ');

/** Asking before something happens: what it is, in words, and two buttons. The service supplies the words and the picture
 *  (a plan or a config change lists its steps); until they arrive, the action's own name stands in. */
function Confirmation({ p, name, approve, tools }: { p: any; name: string; approve: (id: string, ok: boolean) => void; tools: Record<string, ToolInfo> }) {
  // by the tool's name, never by the shape of its input: an MCP tool could send `steps` to look like something else
  const [said, setSaid] = useState<(Confirm & { steps?: (Confirm | null)[] }) | null>(null), raw = p.input ?? {}, isPlan = name === 'plan', isConfig = name === 'config__config_apply';
  const input = isPlan ? raw : isConfig ? raw : {} as any, listed = isPlan || isConfig;
  useEffect(() => { let live = true; fetch('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: name, input: raw }) }).then(r => r.json()).then(c => { if (live) setSaid(c); }, () => { if (live) setSaid({} as Confirm); }); return () => { live = false; }; }, [name, listed]);
  const title = input.steps ? input.title : input.ops ? 'Save this change to your config?' : said?.title ?? `Allow this: ${(tools[name]?.label ?? toolLabel(name)).toLowerCase()}?`;
  const detail = isPlan ? undefined : isConfig ? said?.detail : said?.detail ?? (said?.title ? undefined : plainInput(raw));
  return (
    <Approval said={said} title={title} detail={detail} icon={input.steps ? 'chart' : input.ops ? 'file' : 'pulse'} ready={isConfig || !!said} answer={ok => approve(p.approval.id, ok)}>
      {isPlan ? (
        // a plan: every step, in order, before any of them runs
        <ol className="mt-2 space-y-2">
          {p.input.steps.map((s: any, i: number) => (
            <li key={i} className="flex gap-2.5 text-body">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-fill-2 text-caption font-medium tabular">{i + 1}</span>
              <span className="min-w-0"><span className="font-medium">{tools[s.tool]?.label ?? toolLabel(s.tool)}</span>
                {said?.steps?.[i]?.title
                  ? <span className="block text-meta text-foreground/85">{said.steps[i]!.title}{said.steps[i]!.detail ? ` · ${said.steps[i]!.detail}` : ''}</span>
                  : <span className="ml-1.5 text-meta text-muted-foreground">{Object.entries(s.input ?? {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}</span>}
                <span className="block text-meta text-muted-foreground">{s.why}</span></span>
            </li>
          ))}
        </ol>
      ) : isConfig ? (
        // a change to the config: what it means, then exactly what it writes
        <div className="mt-1 space-y-1.5 text-meta text-muted-foreground">
          {p.input.summary && <div>{p.input.summary}</div>}
          <pre className="max-h-48 overflow-auto rounded-inset bg-fill-1 p-2 font-mono text-caption leading-relaxed whitespace-pre-wrap break-all">{p.input.ops.map((o: any) => `${o.op} ${o.path.join('.')}${o.value === undefined ? '' : ` = ${JSON.stringify(o.value)}`}`).join('\n')}</pre>
        </div>
      ) : null}
    </Approval>
  );
}

function ToolPart({ p, approve, tools = {}, fresh, shown = true }: { p: any; approve: (id: string, ok: boolean) => void; tools?: Record<string, ToolInfo>; fresh?: boolean; shown?: boolean }) {
  const label = toolLabel(p.type === 'dynamic-tool' ? p.toolName : p.type);
  const name = p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, '');
  if (p.state === 'approval-requested' && !p.approval?.isAutomatic) return <Confirmation p={p} name={name} approve={approve} tools={tools} />;
  if (p.state === 'output-available') {
    const card = p.output?.card as Card | undefined;
    if (card) return shown ? <ChatCard first={card} name={name} input={p.input} tools={tools} fresh={fresh} /> : null;
    const mcp = Array.isArray(p.output?.content) ? p.output.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : '';
    if (mcp) return (
      <details className="group rounded-surface border bg-card px-4 py-3 text-item">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground"><ChevronRight className="size-icon-sm transition-transform group-open:rotate-90" /><span className="first-letter:uppercase">{label}</span></summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-meta">{mcp.slice(0, 4000)}</pre>
      </details>
    );
    if (p.output?.data?.error) return <div className="text-item text-warn">{label}: {p.output.data.error}</div>;
    return null;
  }
  if (p.state === 'output-error') return <div className="text-item text-bad">{label} failed: {p.errorText}</div>;
  return null;
}

/** A question answered in ⌘K: the same tools, approvals and cards as the chat, in one short reply. */
export function InlineAnswer({ text, tools, onMore, ui }: { text: string; tools: Record<string, ToolInfo>; onMore: () => void; ui?: ChatUi }) {
  const [one] = useState(() => new Chat({ transport: new DefaultChatTransport({ api: '/api/chat' }), sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses }));
  const { messages, sendMessage, status, addToolApprovalResponse, error } = useChat({ chat: one });
  const started = useRef(0);
  useEffect(() => { if (!started.current) { started.current = Date.now(); sendMessage({ text }); } }, [sendMessage, text]);
  const reply = messages.filter(m => m.role === 'assistant').at(-1), busy = status === 'submitted' || status === 'streaming';
  const said = (reply?.parts ?? []).filter((p: any) => p.type === 'text').map((p: any) => splitThink(p.text).said).join('\n\n').trim();
  const steps = (reply?.parts ?? []).filter((p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool');
  return (
    <Ui.Provider value={ui ?? { steps: true, thinking: 'collapsed', send: 'enter' }}><div className="space-y-3">
      <div className="text-body text-muted-foreground">{text}</div>
      {steps.length > 0 && <ToolChips parts={steps} tools={tools} settled={!busy} />}
      {steps.map((p: any, i) => <ToolPart key={i} p={p} tools={tools} approve={(id, ok) => addToolApprovalResponse({ id, approved: ok })} />)}
      {said && <Text text={said} />}
      {busy && !said && <Pending since={started.current || Date.now()} />}
      {error && <div className="text-item text-bad">Couldn't reach the model: {error.message}</div>}
      {!busy && reply && (
        <button onClick={() => { chat.messages = [...chat.messages, ...one.messages]; onMore(); }} className="press flex items-center gap-1.5 text-body text-muted-foreground transition-colors hover:text-foreground">
          <CornerDownRight className="size-icon-sm" />Continue in chat
        </button>
      )}
    </div></Ui.Provider>
  );
}

/** One message. Memoised, so a reply streaming in doesn't re-render everything above it. */
const MessageRow = memo(function MessageRow({ m, isLast, busy, tookMs, fresh, since, tools, act, next }: { m: any; isLast: boolean; next?: string; busy: boolean; tookMs?: number; fresh: boolean; since: number; tools: Record<string, ToolInfo>; act: { approve: (id: string, ok: boolean) => void; regenerate: () => void; ask: (t: string) => void } }) {
  const [copied, setCopied] = useState<boolean | null>(null), ui = useContext(Ui);
  if (m.role === 'user') return (
    <div className="chat-msg flex justify-end">
      <div className="chat-in chat-bubble max-w-[85%] rounded-surface rounded-br-md px-3.5 py-2 text-item">
        {m.parts.map((p: any, i: number) => p.type === 'text' ? <span key={i} className="whitespace-pre-wrap">{p.text.replace(/\n?\[attached: ([^(\]]+) \(file id [a-f0-9]+\)\]/g, '\n📎 $1')}</span> : null)}
      </div>
    </div>
  );
  // a reply: runs of tool calls become one chip list, followed by any cards they returned, then the words
  const live = isLast && busy;
  const blocks: ReactNode[] = [], thoughts: string[] = []; let run: any[] = [], thinking = false;
  // A card that was asked for always shows. Lookups along the way don't: they stay in the steps, a tap away, so three
  // lookups aren't three cards pushing the answer off the screen. Once it's done, one or two are shown as the result.
  const toolName = (p: any) => p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, '');
  const asked = (p: any) => ['show', 'present'].includes(toolName(p)) || toolName(p).endsWith('__metric_chart');
  const withCards = m.parts.filter((p: any) => p.output?.card), plain = withCards.filter((p: any) => !asked(p) && !['text', 'code'].includes(p.output.card.type));
  const shows = (p: any) => asked(p) || (!live && plain.length <= 2 && plain.includes(p));
  // keys come from the tool call, which never changes: keys based on position shifted as words arrived, so every card
  // was rebuilt and replayed its animation, which is what made the chat flicker
  const flush = () => { if (run.length) { const r = run, id = r[0].toolCallId; blocks.push(<ToolChips key={`c${id}`} parts={r} tools={tools} fresh={fresh} settled={!live} />, <div key={`g${id}`} className="chat-cards">{r.map(p => <ToolPart key={p.toolCallId} p={p} tools={tools} fresh={fresh} shown={shows(p)} approve={act.approve} />)}</div>); run = []; } };
  m.parts.forEach((p: any, i: number) => {
    if (p.type.startsWith('tool-') || p.type === 'dynamic-tool') run.push(p);
    else if (p.type === 'reasoning') { thoughts.push(p.text ?? ''); thinking ||= live && p.state === 'streaming'; }
    else if (p.type === 'text' && p.text.trim()) {
      // reasoning a model left in its reply goes with the rest of its reasoning
      const t = splitThink(p.text);
      if (t.thought) thoughts.push(t.thought);
      thinking ||= live && t.thinking;
      if (t.said) { flush(); const more = m.parts.slice(i + 1).some((x: any) => x.type.startsWith('tool-') || x.type === 'dynamic-tool'); blocks.push(more ? <div key={i} className="text-item text-muted-foreground"><Text text={t.said} live={live} /></div> : <Text key={i} text={t.said} live={live} />); }
    }
  });
  if (ui.thinking === 'hidden') thinking = false;
  if (thoughts.some(t => t.trim()) || thinking) blocks.unshift(<Reasoning key="thought" text={thoughts.join('\n\n')} streaming={thinking} took={tookMs} />);
  flush();
  const text = m.parts.filter((p: any) => p.type === 'text').map((p: any) => splitThink(p.text).said).join('\n\n').trim();
  // the last tool it used that suggests next questions
  const used = m.parts.filter((p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool').map((p: any) => p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, ''));
  const waiting = m.parts.some((p: any) => p.state === 'approval-requested');
  const follow = !isLast || busy || waiting ? [] : next ? next.split('\n') : ui.followUps ? [] : used.map((t: string) => tools[t]?.followUps).filter(Boolean).at(-1)?.slice(0, 2) ?? [];
  return (
    <div className="chat-msg space-y-3">
      {blocks}
      {live && !text && !m.parts.some((p: any) => (ui.steps && (p.type.startsWith('tool-') || p.type === 'dynamic-tool') && p.state !== 'output-available') || (ui.thinking !== 'hidden' && p.type === 'reasoning' && p.state === 'streaming')) && !thinking && <Pending since={since || Date.now()} label={label(m.parts.length ? 'writing' : 'thinking')} />}
      {!live && text && (
        <div className="flex items-center gap-1 text-muted-foreground animate-in fade-in duration-(--dur-pop)">
          <button aria-label="Copy" title="Copy" onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
            className="chat-icon">{copied ? <Tick draw className="morph size-3.5 text-good" /> : <Copy className={cn('size-icon-sm', copied === false && 'morph')} />}</button>
          {isLast && <button aria-label="Ask again" title="Ask again" onClick={act.regenerate} className="chat-icon"><RotateCcw className="size-icon-sm" /></button>}
          {tookMs != null && tookMs >= 1000 && <span className="ml-1 text-meta tabular">{label('worked', { n: (tookMs / 1000).toFixed(tookMs < 10_000 ? 1 : 0) })}</span>}
        </div>
      )}
      {(follow.length > 0 || (ui.review && isLast && !busy && !waiting)) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {follow.slice(0, ui.review ? 2 : 3).map((f: string) => <Chip key={f} onClick={() => act.ask(f)}><span className="truncate">{f}</span></Chip>)}
          {ui.review && <Chip as="a" href="#recap"><span className="truncate">{ui.review}</span></Chip>}
        </div>
      )}
    </div>
  );
});

const compactedOf = (m?: UIMessage) => (m?.role === 'assistant' ? (m.metadata as { compacted?: string } | undefined)?.compacted : undefined);
/** Where the divider goes: before a question whose answer was compacted, or before an answer with no question above it. */
const compactedAt = (ms: UIMessage[], i: number) =>
  ms[i].role === 'user' ? compactedOf(ms[i + 1]) : ms[i - 1]?.role === 'user' ? undefined : compactedOf(ms[i]);

/** A quiet rule across the chat where older messages stopped going to the model as they were. */
function Compacted({ kind }: { kind: string }) {
  return (
    <div className="chat-compacted flex items-center gap-3 text-meta text-muted-foreground" role="note">
      <span className="h-px flex-1 bg-current opacity-20" /><span className="shrink-0">{label(kind === 'summary' ? 'compacted' : 'compactedOut')}</span><span className="h-px flex-1 bg-current opacity-20" />
    </div>
  );
}

/** How full the model's context is, from what the last step really used: a small ring beside its name, and the numbers on
 *  hover or a tap. Near full it says what that means and offers a fresh start. Unknown until the first answer, and then only
 *  what's used if the window isn't known. */
function ContextMeter({ used, total, auto, fresh }: { used: number; total?: number; auto?: boolean; fresh: () => void }) {
  const pct = total ? Math.min(1, used / total) : 0, full = pct >= .75, r = 2.75, c = 2 * Math.PI * r;   // a pie, not an arc: an arc this small reads as a spinner
  const words = total ? label('context', { used: num(used, { notation: 'compact', maximumFractionDigits: 1 }), total: num(total, { notation: 'compact', maximumFractionDigits: 1 }) }) : label('contextUsed', { used: num(used, { notation: 'compact', maximumFractionDigits: 1 }) });
  return (
    <span className="ctx group/ctx relative grid shrink-0 place-items-center" tabIndex={0} role="img" aria-label={words}>
      <svg viewBox="0 0 14 14" className={cn('size-3.5 -rotate-90', pct >= .9 ? 'text-bad' : full ? 'text-warn' : 'text-muted-foreground')} aria-hidden>
        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.2" />
        {total ? <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth={r * 2} strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(.04, pct))} className="ctx-arc" />
          : <circle cx="7" cy="7" r="1.6" fill="currentColor" />}
      </svg>
      <span className="ctx-pop glass-pop">
        <span className="block text-body font-medium text-foreground tabular">{words}</span>
        {total && <span className="block text-meta text-muted-foreground tabular">{num(pct, { style: 'percent' })}</span>}
        {full && <><span className="mt-1.5 block text-meta leading-snug text-muted-foreground">{label(auto ? 'contextAuto' : 'contextFull')}</span>
          <Button size="sm" onClick={fresh} className="mt-2">{label('newChat')}</Button></>}
      </span>
    </span>
  );
}

export default function Assistant({ name, model, ask, suggestions, tools = {}, external, onAsk, onClose, onDismiss, ui = { steps: true, thinking: 'collapsed', send: 'enter' }, attach: canAttach = true }: {
  name: string; model: string; ask: { text: string; n: number } | null; suggestions: string[]; tools?: Record<string, ToolInfo>; onAsk: (t: string) => void;
  external?: boolean;   // the chat is another agent's (assistant.agent), with tools of its own
  onClose?: () => void;   // shown as a phone sheet: a grabber to drag it away, and room for fingers and the keyboard
  onDismiss?: () => void;   // a panel or a full page: a plain close button, there being no outside to click
  ui?: ChatUi;
  attach?: boolean;   // a read-only page takes no files
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
  const { messages, sendMessage, status, addToolApprovalResponse, error, stop, regenerate, setMessages } = useChat({ chat, experimental_throttle: 60 });
  const context = (messages.findLast(m => m.role === 'assistant' && (m.metadata as any)?.context)?.metadata as { context?: { used: number; window?: number; auto?: boolean } } | undefined)?.context;
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
  const [draft, setDraft] = useState(''), [sent, setSent] = useState(0);
  // the same three functions for every message, whatever else changes, so finished messages don't re-render
  const latest = useRef({ addToolApprovalResponse, regenerate, onAsk }); latest.current = { addToolApprovalResponse, regenerate, onAsk };
  const act = useRef({ approve: (id: string, ok: boolean) => { latest.current.addToolApprovalResponse({ id, approved: ok }); }, regenerate: () => { latest.current.regenerate(); }, ask: (t: string) => latest.current.onAsk(t) }).current;
  // files pasted, dropped or picked: uploaded right away, then named in the message so a tool can file them
  const [files, setFiles] = useState<{ key: number; name: string; id?: string; error?: string }[]>([]);
  const [over, setOver] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const attach = (list: FileList | File[]) => {
    if (!canAttach) return;
    for (const f of Array.from(list)) {
      const key = Math.random();
      setFiles(fs => [...fs, { key, name: f.name || 'pasted' }]);
      fetch('/api/files', { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || 'pasted') }, body: f })
        .then(r => r.json()).then(j => setFiles(fs => fs.map(x => x.key === key ? (j.id ? { ...x, id: j.id, name: j.name } : { ...x, error: j.error ?? 'upload failed' }) : x)))
        .catch(() => setFiles(fs => fs.map(x => x.key === key ? { ...x, error: 'upload failed' } : x)));
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  // Stay pinned to the newest words unless the person scrolled up; the moment they scroll back to the bottom, pin again.
  // Direct scrollTop rather than smooth scrolling: a smooth scroll restarted on every token never lands, and fights the
  // person's own scrolling, which was the jitter.
  const following = useRef(true), lastTop = useRef(0), column = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const pin = () => { const el = scroller.current; if (el && following.current) { el.scrollTop = el.scrollHeight; lastTop.current = el.scrollTop; } };
  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (el.scrollTop < lastTop.current - 2 && gap > 32) following.current = false;
    if (gap < 24) following.current = true;
    lastTop.current = el.scrollTop;
    setAway(!following.current);
  };
  const toLatest = () => { following.current = true; setAway(false); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); };
  const busy = status === 'submitted' || status === 'streaming';

  // questions from the ⌘K palette arrive through `ask`
  useEffect(() => { if (ask && ask.n !== lastAsk) { lastAsk = ask.n; following.current = true; sendMessage({ text: ask.text }); } }, [ask, sendMessage]);
  useLayoutEffect(pin, [messages, status]);
  // cards and images that finish loading change the height too
  useEffect(() => {
    const ro = new ResizeObserver(pin);
    if (column.current) ro.observe(column.current);
    return () => ro.disconnect();
  }, []);

  const ready = files.filter(f => f.id), uploading = files.some(f => !f.id && !f.error);
  const submit = () => {
    if ((!draft.trim() && !ready.length) || busy || uploading) return;
    const lines = ready.map(f => `[attached: ${f.name} (file id ${f.id})]`);
    following.current = true; play('send'); setSent(n => n + 1);
    sendMessage({ text: [draft.trim() || 'File this.', ...lines].join('\n') }); setDraft(''); setFiles([]);
  };

  // what's offered next: three at a time, nothing already asked
  const said = new Set(messages.filter((m: any) => m.role === 'user').flatMap((m: any) => m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text.trim())));
  const nextUp = ui.followUps?.filter(f => !said.has(f)).slice(0, 3).join('\n');
  return (
    <Ui.Provider value={ui}><div className="relative flex h-full flex-col">
      <header {...(sheet ? grab : {})} className={cn('relative z-20 flex items-center gap-2.5 px-5', sheet ? 'border-b ' : '', sheet ? 'touch-none pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 select-none' : 'pt-4 pb-3')}>
        {sheet && <span className="sheet-grip absolute top-[max(.4rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2" aria-hidden />}
        {ui.icon && <span className="icon-tile"><Icon name={ui.icon} /></span>}
        {/* one line: the name, then the model and its context meter beside it. The meter's place is kept from the start,
            so nothing moves when the first answer brings the numbers in */}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 text-title font-semibold">{name}</span>
          {/* the model and its meter as one inline group: the group sits on the name's baseline, the meter centred on the model's line */}
          <span className="inline-flex min-w-0 items-center gap-1.5 text-meta leading-4 text-muted-foreground">
            {model && <span className="min-w-0 truncate">{model}</span>}
            {!external && <span className="relative size-3.5 shrink-0 [&>.ctx]:absolute [&>.ctx]:top-1/2 [&>.ctx]:left-1/2 [&>.ctx]:-translate-x-1/2 [&>.ctx]:-translate-y-1/2">{context && <ContextMeter used={context.used} total={context.window} auto={context.auto} fresh={() => { stop(); setMessages([]); setTook({}); }} />}</span>}
          </span>
        </div>
        {sheet && <button onClick={onClose} onPointerDown={e => e.stopPropagation()} aria-label="Close" className="press grid size-9 place-items-center rounded-full bg-fill-1"><ChevronDown className="size-icon-lg" /></button>}
        {onDismiss && <button onClick={onDismiss} aria-label="Close" className="chat-icon text-muted-foreground"><X className="size-icon" /></button>}
      </header>

      {external && <div className="border-b px-5 py-2 text-body text-muted-foreground">{name} runs its own tools. Valet's approvals and access levels don't apply, and answers are plain text.</div>}
      <div ref={scroller} onScroll={onScroll} className={cn('relative flex-1 overflow-y-auto overscroll-contain px-5', sheet && !messages.length && 'flex flex-col justify-end')}>
        <div ref={column} className="mx-auto w-full max-w-[820px] space-y-4 py-4">
        {!messages.length && (
          // on a phone the suggestions sit low, where the thumb is
          <div className={cn('text-center', !sheet && 'pt-10')}>
            <div className="text-title font-semibold tracking-tight">{label('chatTitle')}</div>
            <div className="mx-auto mt-6 flex max-w-[560px] flex-wrap justify-center gap-1.5">
              {suggestions.slice(0, ui.review ? 3 : 4).map(s => <Chip key={s} onClick={() => onAsk(s)}><span className="truncate">{s}</span></Chip>)}
              {ui.review && <Chip as="a" href="#recap"><span className="truncate">{ui.review}</span></Chip>}
            </div>
          </div>
        )}
        {messages.map((m, mi) => (
          <Fragment key={m.id}>
          {/* what the model was sent got smaller here; the page still has all of it, above. The answer carries the flag, and
              the rule goes above the question it answered */}
          {compactedAt(messages, mi) && <Compacted kind={compactedAt(messages, mi)!} />}
          <MessageRow key={m.id} m={m} isLast={mi === messages.length - 1} next={mi === messages.length - 1 ? nextUp : undefined} busy={busy} tookMs={took[m.id]} fresh={mi >= messages.length - 4} since={started.current} tools={tools} act={act} />
          </Fragment>
        ))}
        {status === 'submitted' && messages.at(-1)?.role === 'user' && <Pending since={started.current || Date.now()} />}
        {error && (
          <div className="chat-error flex items-center gap-3 rounded-surface border border-bad/20 bg-bad/[.06] px-4 py-3 text-item">
            <span className="min-w-0 flex-1"><span className="font-medium">Couldn't reach the model.</span> <span className="text-muted-foreground">{error.message}</span></span>
            <Button size="sm" onClick={() => regenerate()}>Try again</Button>
          </div>
        )}
        </div>
      </div>
      {away && (
        <button onClick={toLatest} aria-label="Jump to the latest"
          className="to-latest glass-round absolute bottom-[88px] left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-sm px-3 text-body text-foreground/85">
          <ArrowDown className="size-icon-sm" />{busy ? 'Writing…' : 'Latest'}
        </button>
      )}

      <form className={cn('mx-auto w-full max-w-[860px] p-3 pt-1', sheet && 'pb-[max(.75rem,env(safe-area-inset-bottom))]')} onSubmit={e => { e.preventDefault(); submit(); }}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); attach(e.dataTransfer.files); } }}>
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map(f => (
              <span key={f.key} className={cn('flex max-w-[220px] items-center gap-1.5 rounded-full bg-secondary py-1 pr-1.5 pl-2.5 text-meta', f.error && 'text-bad')}>
                {f.id ? <FileText className="size-icon-sm shrink-0" /> : f.error ? null : <Loader2 className="size-icon-sm shrink-0 animate-spin" />}
                <span className="truncate">{f.error ? `${f.name}: ${f.error}` : f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(fs => fs.filter(x => x.key !== f.key))} className="grid size-4 place-items-center rounded-full hover:bg-fill-2"><X className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <ChatBeam ui={ui} busy={busy}>
        <div className={cn('composer flex items-end gap-2 rounded-surface border bg-card px-3 py-2 shadow-card', over && 'ring-2 ring-primary/60')}>
          <input ref={filePicker} type="file" multiple hidden onChange={e => { if (e.target.files) attach(e.target.files); e.target.value = ''; }} />
 {canAttach && <button type="button" onClick={() => filePicker.current?.click()} aria-label="Attach a file" className={cn('press grid shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-fill-2 hover:text-foreground', sheet ? 'mb-0.5 size-8' : 'mb-1 size-7')}><Paperclip className="size-icon" /></button>}
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1} placeholder={label(sheet || external || !canAttach ? 'message' : 'messageHint', { name })} aria-label="Message"
            onKeyDown={e => { if (e.key === 'Enter' && (ui.send === 'enter' ? !e.shiftKey : e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
            onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); attach(e.clipboardData.files); } }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[16px] leading-[22px] outline-none field-sizing-content placeholder:text-muted-foreground sm:text-title" autoFocus={!sheet} />
          {busy
            ? <Button type="button" size="icon" variant="secondary" className="relative mb-0.5 size-8 overflow-hidden rounded-sm" onClick={stop} aria-label="Stop"><Square className="morph size-3 fill-current" />{sent > 0 && <ArrowUp key={sent} className="send-lift absolute inset-0 m-auto" aria-hidden />}</Button>
            : <Button type="submit" size="icon" className="mb-0.5 size-8 rounded-sm bg-foreground text-(--card-tint) hover:bg-foreground/90 disabled:bg-foreground/20 disabled:text-foreground disabled:opacity-100" disabled={(!draft.trim() && !ready.length) || uploading} aria-label="Send"><ArrowUp className="morph" /></Button>}
        </div>
        </ChatBeam>
      </form>
    </div></Ui.Provider>
  );
}
