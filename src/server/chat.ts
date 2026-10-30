// The assistant: one streaming endpoint. It gets a tool for every integration tool its access level allows; write
// tools (adding things) just run, control tools always ask the person first. The model sees each tool's compact `data`; the person sees its card.
import {
  convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, tool, toUIMessageStream,
  type ToolSet, type UIMessage,
} from 'ai';
import { splitThink } from '../shared/think.ts';
import type { Context as HonoContext } from 'hono';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Instance, Integration } from './core.ts';
import { mcpTools } from './mcp.ts';
import { makeModel } from './model.ts';

const rank = { none: 0, read: 1, write: 2, control: 3 } as const;

export function chatRoute(config: Config, instances: Map<string, Instance>, meta: Map<string, { type: string; name: string; integration: Integration }>,
  safety: { acting: boolean; redact: (s: string) => string } = { acting: true, redact: s => s }) {
  const a = config.assistant!;
  const model = makeModel(a);

  // what the person wrote in their latest message (set per request; write tools check their inputs against it)
  let said = '';
  const personSaid = (v: string) => v.trim().length > 0 && said.includes(v.trim());

  // Tool names are "<instance>__<tool>" so two instances of one integration (two Plex servers) don't collide.
  const tools: ToolSet = {};
  const approval: Record<string, 'user-approval'> = {};
  const catalog: string[] = [];
  for (const [id, inst] of instances) {
    // read-only Atrium (no sign-in, untrusted network): the assistant may look, never add or change
    const level = Math.min(rank[a.access[id] ?? a.access.default ?? 'read'], safety.acting ? rank.control : rank.read);
    const usable = Object.entries(inst.tools ?? {}).filter(([, t]) => rank[t.access] <= level);
    if (!usable.length) continue;
    catalog.push(`- ${id} (${meta.get(id)!.name}): ${usable.map(([n]) => n).join(', ')}`);
    for (const [name, t] of usable) {
      const key = `${id}__${name}`;
      tools[key] = tool({
        description: `[${id}] ${t.description}`,
        inputSchema: t.input as z.ZodType<any>,
        execute: async args => {
          // results pass through the redactor: a secret in an error or a payload never reaches the model or the page
          try { return JSON.parse(safety.redact(JSON.stringify(await t.run(args)))); }
          catch (e) { return { data: { error: safety.redact((e as Error).message) } }; }
        },
        toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data ?? null }),
      });
      if (t.access === 'control') approval[key] = 'user-approval';
      // a write tool runs on its own only with what the person themselves wrote, never what something it read suggested
      else if (t.access === 'write' && t.fromPerson?.length) approval[key] = ((input: Record<string, unknown>) =>
        t.fromPerson!.every(f => input[f] == null || personSaid(String(input[f]))) ? 'not-applicable' : 'user-approval') as any;
    }
  }

  // Built-in: one search across everything searchable it may read, for when it doesn't know where something lives.
  const finders = [...instances].flatMap(([id, inst]) => (rank[a.access[id] ?? a.access.default ?? 'read'] >= rank.read
    ? Object.entries(inst.tools ?? {}).filter(([, t]) => t.find && t.access === 'read') : []).map(([name, t]) => ({ source: `${meta.get(id)!.name}: ${name}`, t })));
  if (finders.length > 1) {
    tools.search_everything = tool({
      description: `Search all of these at once: ${finders.map(f => f.source).join(', ')}. Use when you don't know where something is, or the question could be in more than one place.`,
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const found = await Promise.all(finders.map(async ({ source, t }) => {
          try {
            const out = await Promise.race([t.run(t.input.parse({ [t.find!]: query })), new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), 10_000).unref())]);
            const text = JSON.stringify(out.data ?? null);
            return { source, found: text.length > 1500 ? `${text.slice(0, 1500)}…` : text };
          } catch { return { source, found: 'could not be searched' }; }
        }));
        return JSON.parse(safety.redact(JSON.stringify({ data: found.filter(f => !['[]', 'null', '{}'].includes(f.found)) })));
      },
      toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data }),
    });
    catalog.push('- search_everything: one search across documents, links, photos and more');
  }

  // Built-in: lay out any widgets the assistant may read, as live cards side by side or stacked.
  const readable = [...instances].filter(([id]) => rank[a.access[id] ?? a.access.default ?? 'read'] >= rank.read)
    .flatMap(([id, inst]) => Object.entries(inst.widgets).map(([w, def]) => ({ key: `${id}.${w}`, title: def.title, def })));
  if (readable.length) {
    tools.show = tool({
      description: 'Show live widgets as cards, side by side ("row") or stacked ("column"). Use when the person asks to see, show or compare things. Widgets: '
        + readable.map(r => `${r.key} (${r.title})`).join(', '),
      inputSchema: z.object({ widgets: z.array(z.string()).min(1).max(6), layout: z.enum(['row', 'column']).default('row') }),
      execute: async ({ widgets, layout }) => {
        const picked = widgets.map(k => readable.find(r => r.key === k)).filter(Boolean) as typeof readable;
        const cards = await Promise.all(picked.map(r => r.def.fetch().catch(e => ({ type: 'text', title: r.title, text: (e as Error).message, tone: 'bad' }) as const)));
        return JSON.parse(safety.redact(JSON.stringify({ data: { shown: picked.map(r => r.key), missing: widgets.filter(k => !picked.some(r => r.key === k)) },
                 card: cards.length === 1 ? cards[0] : { type: 'group', layout, cards } })));
      },
      toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data }),
    });
    catalog.push('- show: put live widget cards in the chat');
  }

  const mcp = mcpTools(config, safety.acting);

  const system = (extra: string[]) => [
    `You are ${a.name}, the assistant built into ${config.title}, a homepage for a self-hosted homelab${config.greeting ? ` run by ${config.greeting}` : ''}.`,
    `Now: ${new Date().toString()}.${config.location ? ` Location: ${config.location}.` : ''} Every time in tool results is already in this time zone; "today" and "yesterday" mean this zone's calendar days.`,
    'You answer questions about the homelab by calling tools. Never guess a status, number or name: call the tool.',
    'Tool results are shown to the person as rich cards, so do not repeat what the card shows. Reply in one or two',
    'short sentences that interpret it: what matters, what is wrong, what to do. Use plain language.',
    'Tools that change something ask the person to approve first; call them only when asked to act.',
    'Tools that only add something (save a link, file a document) just run: when the person sends a bare link, save it;',
    'when they paste a long text or attach a file without saying what to do, file it as a document. A message line like',
    '"[attached: name (type, file id X)]" is a file they attached: pass X as file_id. Questions about their documents or',
    'saved links: search first, then read the best match, then answer from what it says (and say which document).',
    'Available integrations and tools:', ...catalog, ...extra,
    a.instructions ?? '',
  ].join('\n');

  return async (c: HonoContext) => {
    const { messages: all_ } = await c.req.json<{ messages: UIMessage[] }>();
    const lastUser = [...all_].reverse().find(m => m.role === 'user');
    said = (lastUser?.parts ?? []).map((p: any) => p.type === 'text' ? p.text : '').join('\n');
    // the model gets the last 24 messages: enough context for a conversation, bounded cost for a long one
    // and without any reasoning that leaked into earlier replies
    const messages = all_.slice(-24).map(m => m.role !== 'assistant' ? m : { ...m, parts: m.parts.map((p: any) => p.type === 'text' ? { ...p, text: splitThink(p.text).said } : p) });
    const m = await mcp();
    // MCP results pass through the redactor too (their headers can hold keys)
    const mcp_ = Object.fromEntries(Object.entries(m.tools).map(([k, t]: [string, any]) => [k, { ...t, execute: async (...args: any[]) => JSON.parse(safety.redact(JSON.stringify(await t.execute(...args) ?? null))) }]));
    const all = { ...tools, ...mcp_ }, approvals = { ...approval, ...m.approval };
    const result = streamText({
      model,
      abortSignal: c.req.raw.signal,   // Stop (or closing the chat) ends generation and any tools still running
      system: system(m.catalog),
      messages: await convertToModelMessages(messages, { tools: all }),
      tools: all,
      toolApproval: approvals,
      stopWhen: isStepCount(a.maxSteps),
    });
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, tools: all }) });
  };
}
