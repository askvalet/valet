// The assistant panel. Loaded on first use. Text streams in; tool results arrive as cards from the same catalog the
// homepage uses; anything that changes something waits for an explicit Approve.
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { ArrowUp, Check, ChevronRight, FileText, Loader2, Paperclip, Sparkles, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

/** Just enough markdown for chat replies: paragraphs, **bold**, *italic*, `code`, line breaks. */
function Text({ text }: { text: string }) {
  return (
    <div className="prose-chat text-[15px] leading-relaxed">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\n)/g).map((t, j) =>
          t.startsWith('**') ? <strong key={j}>{t.slice(2, -2)}</strong>
            : t.startsWith('*') && t.length > 2 ? <em key={j}>{t.slice(1, -1)}</em>
              : t.startsWith('`') ? <code key={j}>{t.slice(1, -1)}</code>
                : t === '\n' ? <br key={j} /> : t)}</p>
      ))}
    </div>
  );
}

function ToolPart({ p, approve }: { p: any; approve: (id: string, ok: boolean) => void }) {
  const label = toolLabel(p.type === 'dynamic-tool' ? p.toolName : p.type);
  if (p.state === 'approval-requested' && !p.approval?.isAutomatic) return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
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
    if (card) return <Widget card={card} compact />;
    const mcp = Array.isArray(p.output?.content) ? p.output.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : '';
    if (mcp) return (
      <details className="group rounded-xl border bg-card px-4 py-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground"><ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /><span className="first-letter:uppercase">{label}</span></summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs">{mcp.slice(0, 4000)}</pre>
      </details>
    );
    if (p.output?.data?.error) return <div className="text-sm text-warn">{label}: {p.output.data.error}</div>;
    return <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><Check className="size-4 text-good" /><span className="first-letter:uppercase">{label}</span></div>;
  }
  if (p.state === 'output-denied') return <div className="text-sm text-muted-foreground">Skipped: {label}</div>;
  if (p.state === 'output-error') return <div className="text-sm text-bad">{label} failed: {p.errorText}</div>;
  return <div className="animate-pulse text-sm text-muted-foreground first-letter:uppercase">{label}…</div>;
}

export default function Assistant({ name, model, ask, suggestions, onAsk }: {
  name: string; model: string; ask: { text: string; n: number } | null; suggestions: string[]; onAsk: (t: string) => void;
}) {
  const { messages, sendMessage, status, addToolApprovalResponse, error, stop } = useChat({ chat });
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
        <div className="grid size-8 place-items-center rounded-full bg-primary/10"><Sparkles className="size-4 text-primary" /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{model}</div>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {!messages.length && (
          <div className="pt-10 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10"><Sparkles className="size-5 text-primary" /></div>
            <div className="text-lg font-semibold tracking-tight">What would you like to know?</div>
            <p className="mt-1 text-sm text-muted-foreground">Ask about anything on your homepage.</p>
            <div className="mt-6 flex flex-col items-stretch gap-2">
              {suggestions.map(s => <Button key={s} variant="outline" className="justify-start font-normal" onClick={() => onAsk(s)}>{s}</Button>)}
            </div>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'space-y-3'}>
            {m.role === 'user'
              ? <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[15px] text-primary-foreground">
                  {m.parts.map((p, i) => p.type === 'text' ? <span key={i}>{p.text}</span> : null)}
                </div>
              : m.parts.map((p: any, i) => p.type === 'text'
                  ? (p.text.trim() ? <Text key={i} text={p.text} /> : null)
                  : p.type.startsWith('tool-') || p.type === 'dynamic-tool'
                    ? <ToolPart key={i} p={p} approve={(id, ok) => addToolApprovalResponse({ id, approved: ok })} />
                    : null)}
          </div>
        ))}
        {status === 'submitted' && <div className="animate-pulse text-sm text-muted-foreground">Thinking…</div>}
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
            className="max-h-48 min-h-12 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none field-sizing-content placeholder:text-muted-foreground" autoFocus />
          {busy
            ? <Button type="button" size="icon" variant="secondary" className="size-8 rounded-full" onClick={stop} aria-label="Stop"><Square className="size-3 fill-current" /></Button>
            : <Button type="submit" size="icon" className={cn('size-8 rounded-full')} disabled={(!draft.trim() && !ready.length) || uploading} aria-label="Send"><ArrowUp /></Button>}
        </div>
      </form>
    </div>
  );
}
