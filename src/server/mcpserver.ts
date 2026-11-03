// Valet as an MCP server, read-only: an AI client you already use (Claude Desktop, an IDE) can look at your homelab
// through the same tools Valet's own assistant has, and nothing else. Off unless `mcpServer` is set, behind its own
// bearer token, with its own access per integration. Only tools that just look are offered, never one that adds or
// changes something, so there's nothing to approve. Results pass the same redactor as the chat's, and every call is in
// the activity log.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Instance } from './core.ts';
import type { Site } from './site.ts';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
// Valet's own version: package.json sits beside dist/ in the image, and at the repo root in development
const VERSION = (() => { for (const f of ['package.json', '../package.json']) { try { return JSON.parse(readFileSync(resolve(process.cwd(), f), 'utf8')).version as string; } catch { /* next */ } } return 'unknown'; })();
// Valet's own setup tools read the config file itself: that stays with the owner and the assistant
const PRIVATE = new Set(['config']);
type Tool = NonNullable<Instance['tools']>[string];

const digest = (s: string) => createHash('sha256').update(s).digest();
const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** What an outside client may use: read tools of the integrations the owner opened to it, by MCP-safe names. */
export function catalog(site: Site) {
  const cfg = site.config.mcpServer!, out = new Map<string, { id: string; name: string; t: Tool; title: string }>();
  for (const [id, inst] of site.instances) {
    if (PRIVATE.has(id) || (cfg.access[id] ?? cfg.access.default ?? 'read') !== 'read') continue;
    for (const [name, t] of Object.entries(inst.tools ?? {})) {
      if (t.access !== 'read') continue;
      const key = `${id}__${name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      out.set(key, { id, name, t, title: `${site.meta.get(id)?.name ?? id}: ${t.label ?? name}` });
    }
  }
  return out;
}

export async function mcpServer(c: Context, site: Site) {
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
      instructions: `${site.config.title}: a homelab's services, read-only. Look things up with these tools; nothing here can change anything.` }));
  }
  if (method === 'ping') return c.json(reply(id, {}));
  const tools = catalog(site);
  if (method === 'tools/list') return c.json(reply(id, { tools: [...tools].map(([name, x]) => ({
    name, title: x.title, description: x.t.description ?? x.t.label ?? x.name,
    inputSchema: { type: 'object', ...(z.toJSONSchema(x.t.input as z.ZodType, { io: 'input', unrepresentable: 'any' }) as object) },
    annotations: { title: x.title, readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  })) }));
  if (method === 'tools/call') {
    const x = tools.get(String(params?.name ?? ''));
    if (!x) return c.json(fail(id, -32602, `no tool ${params?.name}`));
    const args = (x.t.input as z.ZodType).safeParse(params?.arguments ?? {});
    if (!args.success) return c.json(reply(id, { content: [{ type: 'text', text: `bad arguments: ${args.error.issues[0]?.message}` }], isError: true }));
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
