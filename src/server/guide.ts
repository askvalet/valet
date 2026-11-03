// What Valet knows about itself: its own docs, searchable by the assistant, and a way to hand a bug to the project.
// The docs ship in the image and load on first use. An issue is only ever a prefilled link: nothing is sent from here,
// and the person reads it and submits it themselves.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { Tool } from './core.ts';

const REPO = 'https://github.com/askvalet/valet';
const ROOTS = ['docs', 'website/src/content/docs'];

type Part = { page: string; title: string; heading: string; text: string };
type Page = { page: string; title: string; text: string };

/** The words of a Markdown or MDX page: frontmatter, imports and components come out, tables and code stay. */
export function plain(source: string) {
  const front = source.match(/^---\n([\s\S]*?)\n---\n/);
  const title = front?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const body = (front ? source.slice(front[0].length) : source).split('\n')
    .filter(l => !/^(import|export) /.test(l) && !/^\s*<\/?[A-Z]\w*[^>]*>\s*$/.test(l)).join('\n').trim();
  return { title: title ?? body.match(/^# (.+)$/m)?.[1] ?? '', text: body };
}

/** One entry for each `## heading`, so a search can answer with the part that matters rather than a whole page. */
export function sections(page: Page): Part[] {
  const parts: Part[] = []; let heading = page.title, lines: string[] = [];
  const flush = () => { const text = lines.join('\n').trim(); if (text) parts.push({ page: page.page, title: page.title, heading, text }); lines = []; };
  let fenced = false;
  for (const l of page.text.split('\n')) {
    if (l.startsWith('```')) fenced = !fenced;
    const h = !fenced && l.match(/^#{1,3} (.+)$/);
    if (h) { flush(); heading = h[1]; } else lines.push(l);
  }
  flush();
  return parts;
}

/** Best sections first: words in a heading count most, and every word of the question has to pull its weight. */
export function search(parts: Part[], query: string, limit = 5) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter(w => w.length > 2);
  const scored = parts.map(p => {
    const head = `${p.title} ${p.heading}`.toLowerCase(), body = p.text.toLowerCase();
    let score = 0, hit = 0;
    for (const w of words) {
      const n = body.split(w).length - 1, top = head.includes(w);
      if (n || top) hit++;
      score += (top ? 6 : 0) + Math.min(n, 5);
    }
    return { p, score: score * (hit / (words.length || 1)) };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.p);
}

let loaded: Promise<Page[]> | undefined;
async function pages(base = process.env.VALET_DOCS ?? process.cwd()) {
  return loaded ??= (async () => {
    const out: Page[] = [];
    for (const root of ROOTS) {
      const dir = resolve(base, root);
      const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
      for (const f of files.filter(f => /\.mdx?$/.test(f))) {
        const { title, text } = plain(await readFile(join(dir, f), 'utf8'));
        out.push({ page: relative(base, join(dir, f)).replace(/^website\/src\/content\/docs\//, 'guide/').replace(/\.mdx?$/, ''), title, text });
      }
    }
    return out;
  })();
}

// What a person might paste, taken out before it goes into a link: the redactor knows this install's secrets, but
// URL encoding would hide them from it, and addresses say more about a network than a bug report needs.
export const scrub = (s: string) => s
  .replace(/\b(api[-_]?key|token|password|secret|authorization)(["']?\s*[:=]\s*)(?!\$\{)["']?[^\s"',}]+/gi, '$1$2${SECRET}')
  .replace(/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, '$1 ${SECRET}')
  .replace(/\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))(?:\.\d{1,3}){1,3}\b/g, '<private address>');

const AREAS = ['A page or layout', 'A widget or card', 'An integration', 'The assistant', 'Sign-in or security', 'Install or update', 'Something else'] as const;
const clip = (s: string | undefined, n: number) => s ? scrub(s).slice(0, n) : undefined;

async function version() {
  try { return JSON.parse(await readFile(resolve('package.json'), 'utf8')).version as string; } catch { return undefined; }
}

/** The link that opens an issue form with its fields filled in. The field names are the `id`s in .github/ISSUE_TEMPLATE. */
export function issueUrl(template: string, title: string, fields: Record<string, string | undefined>) {
  const q = new URLSearchParams({ template: `${template}.yml`, title: scrub(title).slice(0, 120) });
  for (const [k, v] of Object.entries(fields)) if (v) q.set(k, v);
  return `${REPO}/issues/new?${q}`;
}

export function guideTools(): Record<string, Tool<any>> {
  return {
    docs_search: {
      label: 'Looked in the docs', access: 'read', followUps: ['Can you change that for me?'],
      input: z.object({ query: z.string().describe('what to look up, in a few words') }),
      description: 'Search Valet\'s own documentation: how the page, layout, cards, tabs, look and integrations are configured, what the assistant may do, security, install. Use this for ANY question about Valet itself, and before changing anything you aren\'t sure of. Never answer those from memory. Returns the best sections; docs_read has the whole page.',
      async run({ query }) {
        const found = search((await pages()).flatMap(sections), query);
        return { data: found.length ? found.map(f => ({ page: f.page, section: f.heading, text: f.text.slice(0, 1400) })) : { none: 'nothing in the docs about that' } };
      },
    },
    docs_read: {
      label: 'Read the docs', access: 'read', input: z.object({ page: z.string().describe('as docs_search names it, e.g. docs/configuration') }),
      description: 'One whole page of Valet\'s documentation, by the name docs_search gave it.',
      async run({ page }) {
        const all = await pages(), p = all.find(x => x.page === page);
        return { data: p ? { title: p.title, text: p.text.slice(0, 12_000) } : { error: `no page ${page}`, pages: all.map(x => x.page) } };
      },
    },
    report_issue: {
      label: 'Wrote up an issue', access: 'read',
      description: 'For a bug in Valet itself, a feature idea, or asking for a new integration: makes a link to the project\'s GitHub issue form, filled in, for the person to read and submit. It sends nothing. A service being down is not a Valet bug. Write what they said and what tools showed, in their words, and never add a cause you worked out yourself. Leave out names, addresses and anything private.',
      input: z.object({
        kind: z.enum(['bug', 'feature', 'integration']),
        title: z.string().describe('one line'),
        what: z.string().describe('bug: what happened. feature: what they are trying to do. integration: what the card should show'),
        expected: z.string().optional().describe('bug: what should have happened. feature: what they would like to see'),
        steps: z.string().optional().describe('bug: how to make it happen'),
        area: z.enum(AREAS).optional().describe('bug: where it is'),
        integration: z.string().optional().describe('bug: the integration type, if it is about one. integration: the service'),
        link: z.string().optional().describe('integration: its API docs'),
        logs: z.string().optional().describe('bug: an error message or a few log lines'),
        config: z.string().optional().describe('bug: the few lines of YAML that matter, with secrets as ${NAME}'),
      }),
      async run({ kind, title, what, expected, steps, area, integration, link, logs, config }) {
        const url = kind === 'bug'
          ? issueUrl('bug', title, { what: clip(what, 1500), steps: clip(steps, 1000), expected: clip(expected, 600), area, integration: clip(integration, 60), version: await version(), logs: clip(logs, 1000), config: clip(config, 800) })
          : kind === 'feature' ? issueUrl('feature', title, { problem: clip(what, 1500), idea: clip(expected, 1500) })
          : issueUrl('integration', title, { service: clip(integration, 100), api: clip(link, 300), show: clip(what, 1500) });
        return { data: { url, shown: true, sent: false, note: 'nothing has been sent; they read it and submit it on GitHub' },
          card: { type: 'links', title: 'Report this on GitHub', icon: 'pulse', items: [{ name: title.slice(0, 80), href: url, icon: '/api/icon/github', note: 'Filled in for you. Read it, then submit.' }] } };
      },
    },
  };
}
