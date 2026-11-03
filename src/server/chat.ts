// The assistant: one streaming endpoint. It gets a tool for every integration tool its access level allows; write
// tools (adding things) and control tools always ask the person first. The model sees each tool's compact `data`; the person sees its card.
import {
  convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, tool, toUIMessageStream,
  type LanguageModel, type ToolSet, type UIMessage,
} from 'ai';
import { splitThink } from '../shared/think.ts';
import { randomBytes } from 'node:crypto';
import type { Context as HonoContext } from 'hono';
import { z } from 'zod';
import type { Activity } from './activity.ts';
import type { Config } from './config.ts';
import type { Instance, Integration } from './core.ts';
import { mcpTools } from './mcp.ts';
import { chatAgent, makeAgentModel, makeModel } from './model.ts';
import { checkCard } from '../shared/cards.schema.ts';
import { accessOf as granted, asker, rank, runTool as run, who } from './run.ts';

// Approvals are signed when they're asked for and checked when they come back, so a request can't just claim one.
const APPROVALS = randomBytes(32);

/** What goes back to the model: reasoning left in old replies comes out, and tool results from earlier turns shrink to a
 *  preview. It keeps the thread of the conversation; a question about old logs can look again. Without this a chat's
 *  prompt grows by a whole set of logs each turn and every answer gets slower. */
export function trimHistory(messages: UIMessage[], keep = 6, limit = 1200) {
  return messages.map((m, i) => {
    if (m.role !== 'assistant') return m;
    const old = i < messages.length - keep;
    return { ...m, parts: m.parts.map((p: any) => {
      if (p.type === 'text') return { ...p, text: splitThink(p.text).said };
      if (old && p.output?.data !== undefined) {
        const text = JSON.stringify(p.output.data);
        if (text.length > limit) return { ...p, output: { data: { earlierResult: `${text.slice(0, limit)}…`, note: 'shortened; call the tool again for all of it' } } };
      }
      return p;
    }) };
  });
}

export function chatRoute(config: Config, instances: Map<string, Instance>, meta: Map<string, { type: string; name: string; integration: Integration }>,
  safety: { acting: boolean; redact: (s: string) => string; activity?: Activity; model?: LanguageModel } = { acting: true, redact: s => s }) {
  const a = config.assistant!;
  const model = safety.model ?? makeModel(a);
  // Valet's own tools (what happened, reminders, rules) work without being granted; read-only pages still cap them
  const accessOf = (id: string) => granted(a, id);

  // Tool names are "<instance>__<tool>" so two instances of one integration (two Plex servers) don't collide.
  const tools: ToolSet = {};
  const approval: Record<string, 'user-approval'> = {};
  const catalog: string[] = [];
  const steps = new Map<string, { id: string; name: string; t: Instance['tools'] extends Record<string, infer T> | undefined ? T : never }>();
  // every tool call goes through one door (run.ts): redacted, and logged unless it only looks
  const runTool = (id: string, name: string, t: any, args: any, via: 'chat' | 'plan') => run({ id, name, t, args, via, who: who(), activity: safety.activity, redact: safety.redact });
  for (const [id, inst] of instances) {
    // read-only Valet (no sign-in, untrusted network): the assistant may look, never add or change
    const level = Math.min(accessOf(id), safety.acting ? rank.control : rank.read);
    const usable = Object.entries(inst.tools ?? {}).filter(([, t]) => rank[t.access] <= level);
    if (!usable.length) continue;
    catalog.push(`- ${id} (${meta.get(id)!.name}): ${usable.map(([n]) => n).join(', ')}`);
    for (const [name, t] of usable) {
      const key = `${id}__${name}`;
      // a plan can't edit the config or set up a rule: each of those gets an approval of its own
      if (id !== 'config' && key !== 'valet__rule_add') steps.set(key, { id, name, t });
      tools[key] = tool({
        description: `[${id}] ${t.description}`,
        inputSchema: t.input as z.ZodType<any>,
        execute: args => runTool(id, name, t, args, 'chat'),
        toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data ?? null }),
      });
      if (t.access !== 'read') approval[key] = 'user-approval';   // reading is free; anything that changes something asks
    }
  }

  // Built-in: several changes approved once. Every step is still a tool this access level allows, with checked input, and
  // the person sees the whole list before anything runs. It stops at the first failure.
  if (safety.acting) {
    tools.plan = tool({
      description: 'Do several things in order, with one approval, when a request takes more than one change ("clear space", "get ready for movie night"). Look things up first, then list the exact tool calls. Each step needs a why in plain words. Never use it for a single change.',
      inputSchema: z.object({ title: z.string().describe('what this achieves, in plain words'), steps: z.array(z.object({ tool: z.string().describe('its full name, e.g. downloads__pause_downloads'), input: z.record(z.string(), z.unknown()).optional(), why: z.string() })).min(2).max(8) }),
      execute: async ({ title, steps: list }) => {
        const ready: { key: string; step: NonNullable<ReturnType<typeof steps.get>>; args: unknown; why: string }[] = [];
        for (const s of list) {
          const step = steps.get(s.tool);
          if (!step) return { data: { error: `no tool ${s.tool}; nothing was run` } };
          const args = step.t.input.safeParse(s.input ?? {});
          if (!args.success) return { data: { error: `${s.tool}: ${args.error.issues[0]?.message}; nothing was run` } };
          ready.push({ key: s.tool, step, args: args.data, why: s.why });
        }
        const results: { step: string; ok: boolean; error?: string }[] = [];
        for (const r of ready) {
          const out = await runTool(r.step.id, r.step.name, r.step.t, r.args, 'plan'), error = out?.data?.error;
          results.push({ step: r.step.t.label ?? r.key, ok: !error, error });
          if (error) break;
        }
        const left = ready.slice(results.length).map(r => r.step.t.label ?? r.key);
        return { data: { done: results, notRun: left }, card: { type: 'list', title, icon: 'pulse', items: [
          ...results.map(r => ({ title: r.step, subtitle: r.error, meta: r.ok ? 'Done' : 'Failed', tone: r.ok ? 'good' as const : 'bad' as const })),
          ...left.map(t => ({ title: t, meta: 'Not run' }))] } };
      },
      toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data }),
    });
    approval.plan = 'user-approval';
    catalog.push('- plan: several changes, one approval');
  }

  // Built-in: one search across everything searchable it may read, for when it doesn't know where something lives.
  const finders = [...instances].flatMap(([id, inst]) => (accessOf(id) >= rank.read
    ? Object.entries(inst.tools ?? {}).filter(([, t]) => t.find && t.access === 'read') : []).map(([name, t]) => ({ source: `${meta.get(id)!.name}: ${name}`, t })));
  if (finders.length > 1) {
    tools.search_everything = tool({
      description: `Search all of these at once: ${finders.map(f => f.source).join(', ')}. Use when you don't know where something is, or the question could be in more than one place.`,
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const found = await Promise.all(finders.map(async ({ source, t }) => {
          try {
            const out = await Promise.race([t.run(t.input.parse({ [t.find!]: query })), new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), 10_000).unref())]);
            const text = safety.redact(JSON.stringify(out.data ?? null));   // before it's cut, or a cut secret slips past
            return { source, found: text.length > 1500 ? `${text.slice(0, 1500)}…` : text };
          } catch { return { source, found: 'could not be searched' }; }
        }));
        return JSON.parse(safety.redact(JSON.stringify({ data: found.filter(f => !['[]', 'null', '{}'].includes(f.found)) })));
      },
      toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data }),
    });
    catalog.push('- search_everything: one search across documents, links, photos and more');
  }

  // Built-in: numbers it already has, drawn properly. It only makes a card: no data of its own, no effect on anything.
  tools.present = tool({
    description: 'Draw a chart or table in the chat from numbers you already got from tools, when that reads better than a sentence: comparisons, rankings, several rows. Never invent or estimate a value. For a number over time use metric_chart instead.',
    inputSchema: z.object({ kind: z.enum(['chart', 'table']), title: z.string(), unit: z.string().optional(), labels: z.array(z.string()).optional().describe('chart: a name per point'),
      series: z.array(z.object({ name: z.string(), points: z.array(z.number()) })).optional().describe('chart'), columns: z.array(z.string()).optional().describe('table'), rows: z.array(z.array(z.union([z.string(), z.number()]))).optional().describe('table') }),
    execute: async ({ kind, title, unit, labels, series, columns, rows }) => {
      const card = kind === 'chart' ? { type: 'chart', title, unit, labels, series: series ?? [] } : { type: 'table', title, columns: columns ?? [], rows: rows ?? [] };
      const ok = checkCard(card);
      if (!ok.success || (kind === 'chart' ? !series?.length : !rows?.length)) return { data: { error: 'that needs series (chart) or columns and rows (table)' } };
      return JSON.parse(safety.redact(JSON.stringify({ data: { shown: true }, card })));
    },
    toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data }),
  });
  catalog.push('- present: draw a chart or table from numbers you already have');

  // Built-in: lay out any widgets the assistant may read, as live cards side by side or stacked.
  const readable = [...instances].filter(([id]) => accessOf(id) >= rank.read)
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
    'Tools that add something (save a link, file a document) show the person a card to approve: when they send a bare link, save it;',
    'when they paste a long text or attach a file without saying what to do, file it as a document. A message line like',
    '"[attached: name (type, file id X)]" is a file they attached: pass X as file_id. Questions about their documents or',
    'saved links: search first, then read the best match, then answer from what it says (and say which document).',
    'For why something happened, look before answering: the timeline for what went on, then logs if there are any. Say what you found, not a guess.',
    'A service can run in Docker or directly on a machine. Check both kinds of status and logs before saying you cannot find one.',
    'Name a cause only if a tool result shows it. If two things happened at the same time, say that, not that one caused the other. If you cannot tell, say so.',
    'When asked to be told about something later, set a reminder with watch_add; do not offer to check back yourself.',
    'When asked to do something every time something happens, or every day at a time ("when a download finishes, pause the rest", "every morning at 7 tell me what is down"), set up a rule with rule_add: it then runs by itself, with no model. One action per rule, and never for a one-off.',
    `You are part of Valet, the software behind this page. For any question about Valet itself, what it can do or how to set something up, search its docs with docs_search and answer from them, never from memory.`,
    instances.has('config')
      ? 'You can change Valet: any page, tab, card, widget, integration, its look, words and layout are its config, and config_* tools edit it. Read with config_read, look up what a section accepts with config_options or the docs, check it with config_preview and fix what it reports, then save with config_apply, which asks the person. It applies at once. config_undo takes the last save back. Do several edits as one set of ops.'
      : 'You cannot change Valet from here: tell them the page, cards and look are in config.yaml, or that `assistant.access: { config: control }` lets you edit it with their approval.',
    'What you can never change, so say so plainly and point to the docs: sign-in, allowed hosts, plugins, MCP, notifications, your own access, model or instructions, files on disk, and secrets, which go in .env by hand. You cannot change Valet\'s code, install anything, or restart it.',
    'If something looks like a bug in Valet itself, not a service that is down, say so and use report_issue to give them a filled-in GitHub issue to read and submit. Also use it when they ask for a feature or an integration Valet lacks.',
    'Available integrations and tools:', ...catalog, ...extra,
    a.instructions ?? '',
  ].join('\n');

  return async (c: HonoContext) => asker.run((c.get as (k: string) => string | undefined)('user') ?? 'you', async () => {
    const { messages: all_ } = await c.req.json<{ messages: UIMessage[] }>();
    const other = chatAgent(a, safety.acting);
    if (other) {
      const plain = all_.slice(-24).filter(m => m.role !== 'system')
        .map(m => ({ ...m, parts: m.parts.flatMap((p: any) => p.type === 'text' && splitThink(p.text).said ? [{ type: 'text' as const, text: splitThink(p.text).said }] : []) }))
        .filter(m => m.parts.length);
      const result = streamText({ model: makeAgentModel(other), abortSignal: c.req.raw.signal, messages: await convertToModelMessages(plain) });
      return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
    }
    // the model gets the last 24 messages: enough context for a conversation, bounded cost for a long one
    // and without any reasoning that leaked into earlier replies
    const messages = trimHistory(all_.slice(-24));
    const m = await mcp();
    // MCP results pass through the redactor too (their headers can hold keys)
    const mcp_ = Object.fromEntries(Object.entries(m.tools).map(([k, t]: [string, any]) => [k, { ...t, execute: async (...args: any[]) => {
      const out = JSON.parse(safety.redact(JSON.stringify(await t.execute(...args) ?? null)));
      if (m.approval[k]) safety.activity?.add({ who: who(), via: 'chat', what: k.replace(/_/g, ' '), input: args[0], ok: true });
      return out;
    } }]));
    const all = { ...tools, ...mcp_ }, approvals = { ...approval, ...m.approval };
    const result = streamText({
      model,
      abortSignal: c.req.raw.signal,   // Stop (or closing the chat) ends generation and any tools still running
      system: system(m.catalog),
      messages: await convertToModelMessages(messages, { tools: all }),
      tools: all,
      toolApproval: approvals,
      experimental_toolApprovalSecret: APPROVALS,
      stopWhen: isStepCount(a.maxSteps),
      // the last step is for answering: a model still looking things up when its steps run out would otherwise say nothing
      prepareStep: ({ stepNumber }) => stepNumber >= a.maxSteps - 1 ? { toolChoice: 'none' as const, system: `${system(m.catalog)}\n\nYou have no more lookups. Answer now in plain words from what you already found. If it doesn't settle the question, say what you checked and that you can't tell. Do not write tool calls.` } : undefined,
    });
    // a tool that throws past runTool (a failed input check, say): the log and the page should both say what happened
    const failed = (e: unknown) => { const m = safety.redact((e as Error)?.message ?? String(e)); console.error(`assistant: ${m}`); return m; };
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, tools: all, onError: failed } as Parameters<typeof toUIMessageStream>[0]) });
  });
}
