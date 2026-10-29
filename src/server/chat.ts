// The assistant: one streaming endpoint. It gets a tool for every integration tool its access level allows; control
// tools always ask the person first. The model sees each tool's compact `data`; the person sees its card.
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

const rank = { none: 0, read: 1, control: 2 } as const;

export function chatRoute(config: Config, instances: Map<string, Instance>, meta: Map<string, { type: string; name: string; integration: Integration }>) {
  const a = config.assistant!;
  const model = a.provider === 'anthropic'
    ? createAnthropic({ apiKey: a.apiKey, baseURL: a.baseURL })(a.model)
    : createOpenAICompatible({ name: 'assistant', baseURL: a.baseURL ?? 'http://localhost:11434/v1', apiKey: a.apiKey, includeUsage: true })(a.model);

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

  const system = () => [
    `You are ${a.name}, the assistant built into ${config.title}, a homepage for a self-hosted homelab${config.greeting ? ` run by ${config.greeting}` : ''}.`,
    `Now: ${new Date().toString()}.${config.location ? ` Location: ${config.location}.` : ''}`,
    'You answer questions about the homelab by calling tools. Never guess a status, number or name: call the tool.',
    'Tool results are shown to the person as rich cards, so do not repeat what the card shows. Reply in one or two',
    'short sentences that interpret it: what matters, what is wrong, what to do. Use plain language.',
    'Tools that change something ask the person to approve first; call them only when asked to act.',
    'Available integrations and tools:', ...catalog,
    a.instructions ?? '',
  ].join('\n');

  return async (c: HonoContext) => {
    const { messages } = await c.req.json<{ messages: UIMessage[] }>();
    const result = streamText({
      model,
      system: system(),
      messages: await convertToModelMessages(messages, { tools }),
      tools,
      toolApproval: approval,
      stopWhen: isStepCount(a.maxSteps),
    });
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, tools }) });
  };
}
