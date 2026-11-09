// The chat's step rows for a call that was asked about: a declined or skipped one ends quietly, with no spinner.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'react-dom/server';
import { ToolChips } from '../src/web/assistant.tsx';
import { SKIPPED, skipBeforeSending } from '../src/shared/approvals.ts';

const tools = { lab__adblock_pause: { label: 'Paused ad blocking', access: 'control' as const } };
const row = (part: object) => renderToString(<ToolChips parts={[{ type: 'tool-lab__adblock_pause', toolCallId: 'c1', input: { minutes: 5 }, ...part }]} settled tools={tools} />);

test('a card skipped for another question ends as Skipped, with no spinner', () => {
  const [, reply] = skipBeforeSending([{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Pause Pi-hole' }] },
    { id: 'a', role: 'assistant', parts: [{ type: 'tool-lab__adblock_pause', toolCallId: 'c1', state: 'approval-requested', input: { minutes: 5 }, approval: { id: 'x' } }] }] as any);
  const html = row(reply.parts[0]);
  assert.match(html, /Skipped: paused ad blocking/);
  assert.ok(!html.includes('chat-shimmer'), 'not shimmering as if it were running');
  assert.ok(!/orb/i.test(html), 'no spinner');
});

test('a declined answer still on its way to the server also reads Skipped, and a call that ran keeps its tick', () => {
  assert.match(row({ state: 'approval-responded', approval: { id: 'x', approved: false, reason: SKIPPED } }), /Skipped: paused ad blocking/);
  const ran = row({ state: 'output-available', output: { data: {} } });
  assert.ok(!ran.includes('Skipped') && !ran.includes('chat-shimmer'));
  // waiting for an answer: the card asks, so the row isn't drawn at all
  assert.equal(row({ state: 'approval-requested', approval: { id: 'x' } }), '');
});
