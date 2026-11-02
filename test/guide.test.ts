import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseDocument } from 'yaml';
import { guideTools, issueUrl, plain, scrub, search, sections } from '../src/server/guide.ts';

test('docs: a page loses its frontmatter and components and keeps its words', () => {
  const p = plain('---\ntitle: Tabs\n---\nimport X from "y";\n\n<Aside>\nTabs group sections.\n</Aside>\n\n## Order\n\nBy config.');
  assert.equal(p.title, 'Tabs'); assert.doesNotMatch(p.text, /import|Aside/); assert.match(p.text, /Tabs group sections/);
});

test('docs: a section comes back, and a heading outranks a passing mention', () => {
  const parts = sections({ page: 'a', title: 'Look', text: 'Intro.\n\n## Wallpaper\n\nSet a picture.\n\n## Motion\n\nNot the wallpaper.\n\n```yaml\n# not a heading\n```' });
  assert.equal(parts.length, 3);
  assert.equal(search(parts, 'wallpaper')[0].heading, 'Wallpaper');
  assert.deepEqual(search(parts, 'kubernetes'), []);
});

test('docs: the real ones load and answer', async () => {
  const out = await guideTools().docs_search.run({ query: 'wallpaper appearance' }) as any;
  assert.ok(out.data.length, 'found nothing'); assert.ok(out.data[0].page);
  const page = await guideTools().docs_read.run({ page: out.data[0].page }) as any;
  assert.ok(page.data.text.length > 50);
});

test('issue: a link never carries a secret or a private address', () => {
  assert.equal(scrub('apiKey: abc123\nurl: http://192.168.1.5:80\nheaders: { Authorization: "Bearer abcdefghijkl" }\nkey: ${KEPT}').includes('abc123'), false);
  assert.match(scrub('http://192.168.1.5:80'), /<private address>:80/);
  assert.match(scrub('http://100.64.1.2'), /<private address>/);
  assert.match(scrub('token: ${NAME}'), /\$\{NAME\}/);
  assert.match(scrub('Bearer abcdefghijkl'), /Bearer \$\{SECRET\}/);
});

test('issue: every field the tool fills is a field of the form, and it stays short enough for a link', async () => {
  const form = (n: string) => [...readFileSync(`.github/ISSUE_TEMPLATE/${n}.yml`, 'utf8').matchAll(/^\s+id: (\w+)$/gm)].map(m => m[1]);
  const long = 'x'.repeat(5000);
  const run = async (input: any) => new URL(((await guideTools().report_issue.run(input)) as any).data.url);
  const bug = await run({ kind: 'bug', title: 'Blank card', what: long, expected: long, steps: long, area: 'An integration', integration: 'seerr', logs: long, config: long });
  assert.equal(bug.searchParams.get('template'), 'bug.yml');
  for (const k of bug.searchParams.keys()) if (!['template', 'title'].includes(k)) assert.ok(form('bug').includes(k), k);
  assert.ok(bug.href.length < 8000, `${bug.href.length}`);
  const idea = await run({ kind: 'feature', title: 'T', what: 'a', expected: 'b' });
  for (const k of idea.searchParams.keys()) if (!['template', 'title'].includes(k)) assert.ok(form('feature').includes(k), k);
  const svc = await run({ kind: 'integration', title: 'T', what: 'a', integration: 'Mealie', link: 'http://x' });
  for (const k of svc.searchParams.keys()) if (!['template', 'title'].includes(k)) assert.ok(form('integration').includes(k), k);
});

test('issue: the assistant\'s choice of area matches the form\'s list', () => {
  const list = readFileSync('.github/ISSUE_TEMPLATE/bug.yml', 'utf8');
  for (const a of ['A page or layout', 'Install or update', 'Something else']) assert.match(list, new RegExp(`- ${a}`));
  assert.match(issueUrl('bug', 'T', { area: 'The assistant' }), /area=The\+assistant/);
});

test('issue: the forms are valid YAML, or GitHub drops them', () => {
  for (const n of ['bug', 'feature', 'integration', 'config']) assert.deepEqual(parseDocument(readFileSync(`.github/ISSUE_TEMPLATE/${n}.yml`, 'utf8')).errors, [], n);
});

test('issue: it can only make a link', () => {
  assert.equal(guideTools().report_issue.access, 'read');
});
