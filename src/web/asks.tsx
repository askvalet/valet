// Approvals asked from outside the chat (an MCP client's call, asks.ts on the server): the same card the chat asks with,
// held at the foot of the page until someone answers. Loaded only when there is one.
import { createPortal } from 'react-dom';
import type { Confirm } from '../shared/cards.ts';
import { Approval } from './approval.tsx';
import { label } from './format.ts';
import { toast } from './feel.tsx';

export interface Ask { id: string; from: string; tool: string; said: Confirm & { logo?: string } }

export default function Asks({ asks }: { asks: Ask[] }) {
  const answer = async (id: string, ok: boolean) => {
    const r = await fetch(`/api/asks/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok }) }).catch(() => null);
    if (!r?.ok) toast(`ask:${id}`, { text: (await r?.json().catch(() => null))?.error ?? 'Couldn\'t reach Valet', tone: 'warn' }, { ms: 5000 });
  };
  // through a portal: glass traps anything fixed inside it
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-3 px-4 max-sm:bottom-24">
      {asks.map(a => (
        // a sheet of its own: over the page there's no chat panel behind the card to blur what's under it
        <div key={a.id} className="pointer-events-auto glass-pop" style={{ borderRadius: 'var(--radius-surface)' }}>
          <Approval said={a.said} title={a.said.title} detail={[a.said.detail, label('askedBy', { who: a.from })].filter(Boolean).join(' · ')} icon="pulse" ready answer={ok => void answer(a.id, ok)} />
        </div>
      ))}
    </div>, document.body);
}
