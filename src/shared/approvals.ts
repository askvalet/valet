// An approval card nobody answered: the person asked something else instead. The call never ran, and from then on it's a
// no, both on the page (the row says Skipped, the card can't be pressed later) and to the model (its next turn is told the
// call was declined, so it doesn't say it was done or ask again on its own).

import type { UIMessage } from 'ai';

export const SKIPPED = 'Not done: they sent a new message instead of answering the approval card.';

type Part = { type: string; state?: string; approval?: { approved?: boolean; isAutomatic?: boolean } };

const waiting = (p: Part): boolean => (p.type.startsWith('tool-') || p.type === 'dynamic-tool') && p.state === 'approval-requested' && !!p.approval && !p.approval.isAutomatic;

/** Every approval still waiting in a reply that a later message from the person follows, answered as declined. The
 *  server gives it `approval-responded` (the AI SDK then tells the model `execution-denied`); the page, which won't send
 *  that answer on its own, marks it `output-denied`, where a declined call ends. Anything else is returned as it was. */
export function skipUnanswered<M extends UIMessage>(messages: M[], { upTo = lastUser(messages), as = 'approval-responded' }: { upTo?: number; as?: 'approval-responded' | 'output-denied' } = {}): M[] {
  if (upTo <= 0 || !messages.slice(0, upTo).some(m => m.role === 'assistant' && (m.parts as Part[]).some(waiting))) return messages;
  return messages.map((m, i) => i >= upTo || m.role !== 'assistant' || !(m.parts as Part[]).some(waiting) ? m
    : { ...m, parts: (m.parts as Part[]).map(p => waiting(p) ? { ...p, state: as, approval: { ...p.approval, approved: false, reason: SKIPPED } } : p) as M['parts'] });
}

/** The same, for the page about to send a new message: everything already in the chat comes before it. */
export const skipBeforeSending = <M extends UIMessage>(messages: M[]): M[] => skipUnanswered(messages, { upTo: messages.length, as: 'output-denied' });

const lastUser = (messages: UIMessage[]) => messages.findLastIndex(m => m.role === 'user');
