// MCP servers as assistant tools. Connected on first use and re-listed every 10 minutes, so a server that's down
// at start-up doesn't block anything and new tools show up without a restart.
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import type { Config } from './config.ts';

interface Entry { client?: MCPClient; tools: ToolSet; readOnly: Set<string>; at: number; error?: string }
const TTL = 10 * 60_000;

export function mcpTools(config: Config, acting = true) {
  const cache = new Map<string, Entry>();

  async function load(id: string): Promise<Entry> {
    const s = config.mcp[id], old = cache.get(id);
    if (old && Date.now() - old.at < TTL) return old;
    try {
      const client = old?.client ?? await createMCPClient({ transport: { type: s.transport, url: s.url, headers: s.headers } });
      const defs = await client.listTools();
      const readOnly = new Set(defs.tools.filter(t => t.annotations?.readOnlyHint || s.readOnly.includes(t.name)).map(t => t.name));
      // read-only Valet offers only an MCP server's read-only tools, whatever its access says
      const offered = s.access === 'control' && acting ? defs.tools : defs.tools.filter(t => readOnly.has(t.name));
      const tools = client.toolsFromDefinitions({ ...defs, tools: offered }) as ToolSet;
      const e = { client, tools, readOnly, at: Date.now() };
      cache.set(id, e);
      return e;
    } catch (err) {
      await old?.client?.close().catch(() => {});
      const e = { tools: {}, readOnly: new Set<string>(), at: Date.now() - TTL + 60_000, error: (err as Error).message };   // retry in a minute
      cache.set(id, e);
      console.error(`[mcp:${id}] ${e.error}`);
      return e;
    }
  }

  /** Tools from every allowed MCP server, named "mcp_<server>__<tool>", plus which of them need approval. */
  return async () => {
    const tools: ToolSet = {}, approval: Record<string, 'user-approval'> = {}, catalog: string[] = [], names_: Record<string, string> = {};
    await Promise.all(Object.entries(config.mcp).filter(([, s]) => s.access !== 'none').map(async ([id, s]) => {
      const e = await load(id);
      const names = Object.keys(e.tools);
      if (!names.length) return;
      catalog.push(`- ${id} (${s.name ?? 'MCP server'}): ${names.join(', ')}`);
      names_[`mcp_${id}`.replace(/[^a-zA-Z0-9_-]/g, '_')] = s.name ?? 'MCP server';
      for (const n of names) {
        const key = `mcp_${id}__${n.replace(new RegExp(`^${id}__`), '')}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        tools[key] = e.tools[n];
        if (!e.readOnly.has(n)) approval[key] = 'user-approval';
      }
    }));
    return { tools, approval, catalog, names: names_ };
  };
}
