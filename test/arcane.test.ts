// Arcane moved its API in 3.0 (2026-11-14): /api/environments/{id} became /api/agents/{id}, and image-updates/summary became
// images/updates/summary (issue #32). The card asks both and follows whichever answers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { registry } from '../src/integrations/index.ts';
import { makeContext } from '../src/server/core.ts';

const answers = {
  containers: { success: true, data: { runningContainers: 5, stoppedContainers: 1, totalContainers: 6 } },
  images: { success: true, data: { totalImages: 9 } },
  updates: { success: true, data: { totalImages: 9, imagesWithUpdates: 2 } },
};
// a fake Arcane of one version: only its own paths answer, everything else is a 404
function arcane(paths: Record<string, unknown>) {
  const seen: string[] = [];
  const s = createServer((req, res) => {
    seen.push(req.url!);
    if (req.headers['x-api-key'] !== 'k') { res.writeHead(401).end(); return; }
    const body = paths[req.url!.split('?')[0]];
    if (body === undefined) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  return new Promise<{ url: string; seen: string[]; close(): void }>(ok => s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(s.address() as any).port}`, seen, close: () => s.close() })));
}
const card = async (url: string, key = 'k') => {
  const i = registry.arcane, inst = i.create(i.config.parse({ url, key, env: '0' }), makeContext('arcane'));
  return Object.values(inst.widgets)[0].fetch() as Promise<any>;
};
const numbers = (c: any) => Object.fromEntries(c.items.map((x: any) => [x.label, x.value]));

test('arcane 3.x: /api/agents paths', async () => {
  const s = await arcane({ '/api/agents/0/containers/counts': answers.containers, '/api/agents/0/images/counts': answers.images, '/api/agents/0/images/updates/summary': answers.updates });
  try { assert.deepEqual(numbers(await card(s.url)), { Running: '5', Stopped: '1', Images: '9', Updates: '2' }); }
  finally { s.close(); }
});

test('arcane 2.x: /api/environments paths still work', async () => {
  const s = await arcane({ '/api/environments/0/containers/counts': answers.containers, '/api/environments/0/images/counts': answers.images, '/api/environments/0/image-updates/summary': answers.updates });
  try {
    assert.deepEqual(numbers(await card(s.url)), { Running: '5', Stopped: '1', Images: '9', Updates: '2' });
    assert.ok(!s.seen.some(u => u.startsWith('/api/agents/0/images')), 'once 2.x answered, nothing more is asked of 3.x paths');
  } finally { s.close(); }
});

test('arcane: no update summary is not an error, and neither version answering is', async () => {
  const s = await arcane({ '/api/agents/0/containers/counts': answers.containers, '/api/agents/0/images/counts': answers.images });
  try { assert.equal(numbers(await card(s.url)).Updates, '0'); } finally { s.close(); }
  const none = await arcane({});
  try { await assert.rejects(card(none.url), /didn't answer at \/api\/agents\/0 \(3\.x\) or \/api\/environments\/0 \(2\.x\)/); } finally { none.close(); }
  const both = await arcane({ '/api/agents/0/containers/counts': answers.containers });
  try { await assert.rejects(card(both.url, 'wrong'), /didn't answer/); } finally { both.close(); }
});
