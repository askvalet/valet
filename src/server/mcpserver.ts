// Valet as an MCP server: an AI client you already use (Claude Desktop, an IDE) can look at your homelab through the same
// tools Valet's own assistant has, and nothing else. Off unless `mcpServer` is set, behind its own bearer token, with its
// own access per integration, `read` unless the owner says more. With `write` or `control` for an integration, its tools
// that change something are offered too, and none of them runs on the client's word: each call waits for a signed-in
// person to approve it on Valet's page (asks.ts), in the tool's own words, one exact call at a time. Results pass the same
// redactor as the chat's, and every call is in the activity log.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Instance } from './core.ts';
import type { Site } from './site.ts';
import { type Asks, hashOf } from './asks.ts';
import { rank, runTool } from './run.ts';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
// Valet's own version: package.json sits beside dist/ in the image, and at the repo root in development
const VERSION = (() => { for (const f of ['package.json', '../package.json']) { try { return JSON.parse(readFileSync(resolve(process.cwd(), f), 'utf8')).version as string; } catch { /* next */ } } return 'unknown'; })();
// Valet's own setup tools read the config file itself: that stays with the owner and the assistant
const PRIVATE = new Set(['config']);
// and nothing of Valet's own that changes something: a rule is a standing approval, and pins are the page's
const OWN = new Set(['config', 'valet', 'pins']);
/** how long a call stays on the line for an answer: under the minute most clients give a tool */
export const HOLD = 45_000;
type Tool = NonNullable<Instance['tools']>[string];

const digest = (s: string) => createHash('sha256').update(s).digest();
const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** What an outside client may use: the tools of the integrations the owner opened to it, up to the level given, by
 *  MCP-safe names. Anything past looking needs a page that can act, since a person there has to approve it. */
export function catalog(site: Site) {
  const cfg = site.config.mcpServer!, out = new Map<string, { id: string; name: string; t: Tool; title: string }>();
  for (const [id, inst] of site.instances) {
    const level = Math.min(rank[cfg.access[id] ?? cfg.access.default ?? 'read'], site.acting && !OWN.has(id) ? rank.control : rank.read);
    if (PRIVATE.has(id) || level < rank.read) continue;
    for (const [name, t] of Object.entries(inst.tools ?? {})) {
      if (rank[t.access] > level) continue;
      const key = `${id}__${name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      out.set(key, { id, name, t, title: `${site.meta.get(id)?.name ?? id}: ${t.label ?? name}` });
    }
  }
  return out;
}

export async function mcpServer(c: Context, site: Site, asks?: Asks, hold = HOLD) {
  // switched off looks the same as a wrong token: nobody outside learns whether it's on
  const cfg = site.config.mcpServer, given = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? '';
  if (!cfg || !timingSafeEqual(digest(given), digest(cfg.token))) return c.json(fail(null, -32001, 'unauthorized'), 401, { 'WWW-Authenticate': 'Bearer' });
  if (c.req.method !== 'POST') return c.body(null, 405, { Allow: 'POST' });   // no event stream: every answer comes back on its own POST
  const msg = await c.req.json().catch(() => null) as { jsonrpc?: string; id?: unknown; method?: string; params?: any } | null;
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return c.json(fail(null, -32600, 'one JSON-RPC 2.0 request per POST'), 400);
  const { id, method, params } = msg;
  if (id === undefined) return c.body(null, 202);   // a notification, such as notifications/initialized
  if (method === 'initialize') {
    const asked = String(params?.protocolVersion ?? '');
    return c.json(reply(id, { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'valet', title: 'Valet', version: VERSION },
      instructions: [...catalog(site).values()].some(x => x.t.access !== 'read')
        ? `${site.config.title}: a homelab's services. Tools marked read-only just look. Any other tool changes something, and waits for the owner to approve that exact call on their Valet page: if it answers that it's still waiting, tell them, and call it again with the same arguments once they've approved.`
        : `${site.config.title}: a homelab's services, read-only. Look things up with these tools; nothing here can change anything.` }));
  }
  if (method === 'ping') return c.json(reply(id, {}));
  const tools = catalog(site);
  if (method === 'tools/list') return c.json(reply(id, { tools: [...tools].map(([name, x]) => ({
    name, title: x.title, description: x.t.description ?? x.t.label ?? x.name,
    inputSchema: { type: 'object', ...(z.toJSONSchema(x.t.input as z.ZodType, { io: 'input', unrepresentable: 'any' }) as object) },
    annotations: { title: x.title, readOnlyHint: x.t.access === 'read', destructiveHint: x.t.access === 'control', openWorldHint: false },
  })) }));
  if (method === 'tools/call') {
    const x = tools.get(String(params?.name ?? ''));
    if (!x) return c.json(fail(id, -32602, `no tool ${params?.name}`));
    const args = (x.t.input as z.ZodType).safeParse(params?.arguments ?? {});
    if (!args.success) return c.json(reply(id, { content: [{ type: 'text', text: `bad arguments: ${args.error.issues[0]?.message}` }], isError: true }));
    if (x.t.access !== 'read') {
      const text = (t: string, isError = true) => c.json(reply(id, { content: [{ type: 'text', text: t }], isError }));
      if (!asks) return text('This Valet takes no changes from here.');
      const tool = `${x.id}__${x.name}`, hash = hashOf(tool, args.data);
      // a yes given after an earlier call stopped waiting covers this same call, once
      if (!asks.take(hash)) {
        // the tool's own words for what's about to happen (it may look things up, never change them), else its name and input
        const own = await Promise.resolve(x.t.confirm?.(args.data as never)).catch(() => undefined);
        const type = site.meta.get(x.id)?.type;
        const said = JSON.parse(site.redact(JSON.stringify({ ...(own ?? { title: `${x.title}?`, detail: JSON.stringify(args.data).slice(0, 300) }), logo: type && `/api/icon/${type}` })));
        const asked = asks.request({ from: 'MCP client', tool, hash, said }, hold);
        // told once, wherever the owner hears things: the page shows the card, a phone gets the notification
        if (asked.fresh) { site.push({ title: 'Something is waiting for your approval', text: said.title, urgent: true }); site.events.emit({ type: 'ask', id: asked.id!, from: 'MCP client', tool, title: said.title }); }
        const answer = await asked.answer;
        if (answer === 'full') return text('Too many approvals are already waiting on the Valet page. Ask the owner to answer those first.');
        if (answer === 'declined') { site.activity.add({ who: 'MCP client', via: 'mcp', what: x.t.label ?? x.name, input: args.data, ok: false, error: 'declined on the page' }); return text('The owner declined this on their Valet page. Nothing was changed.'); }
        if (answer === 'waiting') return text(`Not done yet: this is waiting for the owner to approve it on their Valet page (“${said.title}”). Tell them, then call this tool again with exactly the same arguments once they have. It waits there for ten minutes.`);
      }
      const out = await runTool({ id: x.id, name: x.name, t: x.t, args: args.data, via: 'mcp', who: 'MCP client', activity: site.activity, redact: site.redact });
      setTimeout(() => site.hub.refreshInstance(x.id), 300).unref();
      return c.json(reply(id, { content: [{ type: 'text', text: JSON.stringify(out.data ?? null) }], isError: !!out.data?.error }));
    }
    let data: unknown, ok = true;
    try {
      const out = await x.t.run(args.data as never) as { data?: unknown } | undefined;
      data = JSON.parse(site.redact(JSON.stringify(out?.data ?? out ?? null)));
      ok = !(data && typeof data === 'object' && 'error' in data);
    } catch (e) { data = { error: site.redact((e as Error).message) }; ok = false; }
    site.activity.add({ who: 'MCP client', via: 'mcp', what: x.t.label ?? x.name, input: args.data, ok, error: ok ? undefined : String((data as any)?.error ?? '') });
    return c.json(reply(id, { content: [{ type: 'text', text: JSON.stringify(data) }], isError: !ok }));
  }
  return c.json(fail(id, -32601, `no method ${method}`));
}
