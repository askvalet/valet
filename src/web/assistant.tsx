// The assistant panel. Loaded on first question. Text streams in; each tool result arrives as a card from the same
// catalog the homepage uses; anything that changes something waits for an explicit Approve.
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useEffect, useRef, useState } from 'react';
import type { Card } from '../shared/cards.ts';
import { Frame } from './cards.tsx';
import { Icon } from './icons.tsx';

// Tool names are "<instance>__<tool>"; show them as "downloads · pause downloads".
const toolLabel = (name: string) => name.replace(/^tool-/, '').replace('__', ' · ').replace(/_/g, ' ');

/** Just enough markdown for chat replies: paragraphs, **bold**, `code`, and line breaks. */
function Text({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g).map((t, j) =>
          t.startsWith('**') ? <strong key={j}>{t.slice(2, -2)}</strong>
            : t.startsWith('`') ? <code key={j}>{t.slice(1, -1)}</code>
              : t === '\n' ? <br key={j} /> : t)}</p>
      ))}
    </div>
  );
}

export default function Assistant({ name, model, ask, onClose }: { name: string; model: string; ask: { text: string; n: number }; onClose: () => void }) {
  const { messages, sendMessage, status, addToolApprovalResponse, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [draft, setDraft] = useState('');
  const sent = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  // Questions typed in the homepage ask bar arrive here.
  useEffect(() => { if (ask.n !== sent.current) { sent.current = ask.n; sendMessage({ text: ask.text }); } }, [ask, sendMessage]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, status]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <aside className="fixed z-30 inset-0 lg:inset-auto lg:top-4 lg:right-4 lg:bottom-4 lg:w-[420px] flex flex-col glass !rounded-none lg:!rounded-[22px] fade-in"
      aria-label={`${name} assistant`}>
      <header className="flex items-center gap-2 px-5 py-4 border-b hair">
        <Icon name="sparkle" className="tone-accent" size={18} />
        <div className="min-w-0">
          <div className="font-semibold leading-tight">{name}</div>
          <div className="text-[12px] faint truncate">{model}</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="ml-auto w-8 h-8 grid place-items-center rounded-lg hover:bg-[var(--hair)]"><Icon name="x" /></button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.map(m => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'space-y-3'}>
            {m.role === 'user'
              ? <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 bg-[var(--ink)] text-[var(--base)]">
                  {m.parts.map((p, i) => p.type === 'text' ? <span key={i}>{p.text}</span> : null)}
                </div>
              : m.parts.map((p: any, i) => {
                  if (p.type === 'text') return p.text.trim() ? <Text key={i} text={p.text} /> : null;
                  if (!(p.type.startsWith('tool-') || p.type === 'dynamic-tool')) return null;
                  const label = toolLabel(p.type === 'dynamic-tool' ? p.toolName : p.type);
                  if (p.state === 'approval-requested' && !p.approval?.isAutomatic) return (
                    <div key={i} className="rounded-2xl border hair p-4">
                      <div className="font-medium capitalize">{label}?</div>
                      {p.input && Object.keys(p.input).length > 0 && <div className="text-[13px] muted mt-1 break-all">{JSON.stringify(p.input)}</div>}
                      <div className="flex gap-2 mt-3">
                        <button className="btn btn-primary" onClick={() => addToolApprovalResponse({ id: p.approval.id, approved: true })}>Approve</button>
                        <button className="btn btn-ghost" onClick={() => addToolApprovalResponse({ id: p.approval.id, approved: false })}>Deny</button>
                      </div>
                    </div>
                  );
                  if (p.state === 'output-available') {
                    const card = p.output?.card as Card | undefined;
                    if (card) return <Frame key={i} card={card} nested />;
                    if (p.output?.data?.error) return <div key={i} className="text-[13px] tone-warn">{label}: {p.output.data.error}</div>;
                    return <div key={i} className="text-[13px] muted flex items-center gap-1.5"><Icon name="check" className="tone-good" />{label}</div>;
                  }
                  if (p.state === 'output-denied') return <div key={i} className="text-[13px] muted">Skipped: {label}</div>;
                  if (p.state === 'output-error') return <div key={i} className="text-[13px] tone-bad">{label} failed: {p.errorText}</div>;
                  return <div key={i} className="text-[13px] muted pulse capitalize">{label}…</div>;
                })}
          </div>
        ))}
        {status === 'submitted' && <div className="text-[13px] muted pulse">Thinking…</div>}
        {error && <div className="text-[13px] tone-bad">Couldn't reach the model: {error.message}</div>}
        <div ref={end} />
      </div>

      <form className="p-3 border-t hair flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (draft.trim() && !busy) { sendMessage({ text: draft.trim() }); setDraft(''); } }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ask a follow-up…" aria-label="Message"
          className="flex-1 bg-transparent outline-none px-2 py-2 min-w-0 placeholder:text-[var(--faint)]" autoFocus />
        {busy
          ? <button type="button" onClick={stop} className="btn btn-ghost">Stop</button>
          : <button type="submit" aria-label="Send" disabled={!draft.trim()} className="w-9 h-9 grid place-items-center rounded-xl bg-[var(--ink)] text-[var(--base)] disabled:opacity-30"><Icon name="send" /></button>}
      </form>
    </aside>
  );
}
