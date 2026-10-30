// The assistant: one streaming endpoint. It gets a tool for every integration tool its access level allows; write
// tools (adding things) just run, control tools always ask the person first. The model sees each tool's compact `data`; the person sees its card.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, tool, toUIMessageStream,
  type ToolSet, type UIMessage,
} from 'ai';
import type { Context as HonoContext } from 'hono';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Instance, Integration } from './core.ts';
import { mcpTools } from './mcp.ts';

const rank = { none: 0, read: 1, write: 2, control: 3 } as const;

export function chatRoute(config: Config, instances: Map<string, Instance>, meta: Map<string, { type: string; name: string; integration: Integration }>) {
  const a = config.assistant!;
  const model = a.provider === 'anthropic'
    ? createAnthropic({ apiKey: a.apiKey, baseURL: a.baseURL })(a.model)
    : createOpenAICompatible({ name: 'assistant', baseURL: a.baseURL ?? 'http://localhost:11434/v1', apiKey: a.apiKey, includeUsage: true, headers: { 'User-Agent': 'Atrium' } })(a.model);

  // Tool names are "<instance>__<tool>" so two instances of one integration (two Plex servers) don't collide.
  const tools: ToolSet = {};
  const approval: Record<string, 'user-approval'> = {};
  const catalog: string[] = [];
  for (const [id, inst] of instances) {
    const level = rank[a.access[id] ?? a.access.default ?? 'read'];
    const usable = Object.entries(inst.tools ?? {}).filter(([, t]) => rank[t.access] <= level);
    if (!usable.length) continue;
    catalog.push(`- ${id} (${meta.get(id)!.name}): ${usable.map(([n]) => n).join(', ')}`);
    for (const [name, t] of usable) {
      const key = `${id}__${name}`;
      tools[key] = tool({
        description: `[${id}] ${t.description}`,
        inputSchema: t.input as z.ZodType<any>,
        execute: async args => {
          try { return await t.run(args); }
          catch (e) { return { data: { error: (e as Error).message } }; }
        },
        toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data ?? null }),
      });
      if (t.access === 'control') approval[key] = 'user-approval';
    }
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
        return { data: { shown: picked.map(r => r.key), missing: widgets.filter(k => !picked.some(r => r.key === k)) },
                 card: cards.length === 1 ? cards[0] : { type: 'group', layout, cards } };
      },
      toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data }),
    });
    catalog.push('- show: put live widget cards in the chat');
  }

  const mcp = mcpTools(config);

  const system = (extra: string[]) => [
    `You are ${a.name}, the assistant built into ${config.title}, a homepage for a self-hosted homelab${config.greeting ? ` run by ${config.greeting}` : ''}.`,
    `Now: ${new Date().toString()}.${config.location ? ` Location: ${config.location}.` : ''}`,
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
    const { messages } = await c.req.json<{ messages: UIMessage[] }>();
    const m = await mcp();
    const all = { ...tools, ...m.tools }, approvals = { ...approval, ...m.approval };
    const result = streamText({
      model,
      system: system(m.catalog),
      messages: await convertToModelMessages(messages, { tools: all }),
      tools: all,
      toolApproval: approvals,
      stopWhen: isStepCount(a.maxSteps),
    });
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, tools: all }) });
  };
}
