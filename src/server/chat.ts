// The assistant: one streaming endpoint. It gets a tool for every integration tool its access level allows; write
// tools (adding things) and control tools always ask the person first. The model sees each tool's compact `data`; the person sees its card.
import {
  asSchema, convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, tool, toUIMessageStream, wrapLanguageModel,
  type LanguageModel, type ToolSet, type UIMessage,
} from 'ai';
import { TARGET, TOO_LONG_ANSWER, calibrate, compactNow, fit, pinnedIn, retryShorter, size, squeezeSteps, summariser, tokensOf, tooLong } from './compact.ts';
import { checkMentions, commandsOf, expanded, focusLine, readAsk } from './slash.ts';
import { splitThink } from '../shared/think.ts';
import { skipUnanswered } from '../shared/approvals.ts';
import { randomBytes } from 'node:crypto';
import type { Context as HonoContext } from 'hono';
import { z } from 'zod';
import type { Activity } from './activity.ts';
import { Reasoning, type Config } from './config.ts';
import type { Instance, Integration } from './core.ts';
import { mcpTools } from './mcp.ts';
import { callSettings, chatAgent, choices, contextWindow, discovery, lastStepSettings, makeAgentModel, makeModel } from './model.ts';
import { checkCard } from '../shared/cards.schema.ts';
import { accessOf as granted, asker, rank, runTool as run, toolAccess, who } from './run.ts';
import { CORE, LAZY_BELOW, askedFor, groupOf, indexLine, resolve, usedBefore, type Group } from './lazy.ts';

export { trimHistory } from './compact.ts';

// Approvals are signed when they're asked for and checked when they come back, so a request can't just claim one.
const APPROVALS = randomBytes(32);

export function chatRoute(config: Config, instances: Map<string, Instance>, meta: Map<string, { type: string; name: string; integration: Integration }>,
  safety: { acting: boolean; redact: (s: string) => string; activity?: Activity; model?: LanguageModel; models?: Record<string, LanguageModel>; fetch?: typeof fetch } = { acting: true, redact: s => s }) {
  const a = config.assistant!;
  const model = safety.model ?? makeModel(a);
  // assistant.models: a chat may name one of these by id, and nothing else; each is made once, on its first use
  const picks = new Map(choices(a).map(c => [c.id, { s: c.settings, model: c.settings === a ? model : safety.models?.[c.id] }]));
  // `auto`: or one a listed server has (asked again once if it isn't there), on that server's own settings, made on its
  // first use and kept a while (by server and model, so an id that comes to mean another server's model gets its own)
  const listed = discovery(a, { fetch: safety.fetch }), found = new Map<string, LanguageModel>();
  const discovered = async (id: string) => {
    const hit = await listed.find(id);
    if (!hit) return undefined;
    const { server, ...s } = hit, key = `${server} ${s.model}`;
    let llm = found.get(key) ?? safety.models?.[id];
    if (!llm) { llm = makeModel(s); found.set(key, llm); if (found.size > 50) found.delete(found.keys().next().value!); }
    return { s, model: llm };
  };
  // Valet's own tools (what happened, reminders, rules) work without being granted; read-only pages still cap them
  const accessOf = (id: string) => granted(a, id);
  // one tool's level: its own dotted key (`plex.plex_stop_stream: control`), else its integration's; a read-only Valet only looks
  const levelOf = (id: string, name: string) => Math.min(toolAccess(a, id, name), safety.acting ? rank.control : rank.read);
  // the chat's built-ins answer to `valet.<name>: none` too
  const builtin = (name: string) => a.access[`valet.${name}`] !== 'none';

  // Tool names are "<instance>__<tool>" so two instances of one integration (two Plex servers) don't collide.
  const tools: ToolSet = {};
  const approval: Record<string, 'user-approval'> = {};
  const catalog: string[] = [];
  // for assistant.tools: lazy, each integration's tools by instance, and its line in the catalog (which the index replaces)
  const groups = new Map<string, Group>(), lineOf = new Map<string, string>();
  const steps = new Map<string, { id: string; name: string; t: Instance['tools'] extends Record<string, infer T> | undefined ? T : never }>();
  // every tool call goes through one door (run.ts): redacted, and logged unless it only looks
  const runTool = (id: string, name: string, t: any, args: any, via: 'chat' | 'plan') => run({ id, name, t, args, via, who: who(), activity: safety.activity, redact: safety.redact });
  for (const [id, inst] of instances) {
    // read-only Valet (no sign-in, untrusted network): the assistant may look, never add or change
    const usable = Object.entries(inst.tools ?? {}).filter(([name, t]) => rank[t.access] <= levelOf(id, name));
    if (!usable.length) continue;
    catalog.push(`- ${id} (${meta.get(id)!.name}): ${usable.map(([n]) => n).join(', ')}`);
    if (!CORE.has(id)) { groups.set(id, { id, name: meta.get(id)!.name, type: meta.get(id)!.type, keys: usable.map(([n]) => `${id}__${n}`) }); lineOf.set(id, catalog.at(-1)!); }
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
  if (safety.acting && builtin('plan')) {
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
    ? Object.entries(inst.tools ?? {}).filter(([name, t]) => t.find && t.access === 'read' && levelOf(id, name) >= rank.read) : []).map(([name, t]) => ({ source: `${meta.get(id)!.name}: ${name}`, t })));
  if (finders.length > 1 && builtin('search_everything')) {
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
  if (builtin('present')) tools.present = tool({
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
  if (builtin('present')) catalog.push('- present: draw a chart or table from numbers you already have');

  // Built-in: lay out any widgets the assistant may read, as live cards side by side or stacked.
  const readable = [...instances].filter(([id]) => accessOf(id) >= rank.read)
    .flatMap(([id, inst]) => Object.entries(inst.widgets).map(([w, def]) => ({ key: `${id}.${w}`, title: def.title, def })));
  if (readable.length && builtin('show')) {
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

  const system = (extra: string[], index?: string[]) => [
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
      ? 'You can change Valet: any page, tab, card, widget, integration, its look, words and layout are its config, and config_* tools edit it. Read with config_read, look up what a section accepts with config_options or the docs, check it with config_preview and fix what it reports, then save with config_apply, which asks the person. It applies at once. config_undo takes the last save back. Do several edits as one set of ops. The person\'s own chat commands (/morning) are chat.commands: a name and the prompt it sends.'
      : 'You cannot change Valet from here: tell them the page, cards and look are in config.yaml, or that `assistant.access: { config: control }` lets you edit it with their approval.',
    'What you can never change, so say so plainly and point to the docs: sign-in, allowed hosts, plugins, MCP, notifications, your own access, model or instructions, files on disk, and secrets, which go in .env by hand. You cannot change Valet\'s code, install anything, or restart it.',
    'If something looks like a bug in Valet itself, not a service that is down, say so and use report_issue to give them a filled-in GitHub issue to read and submit. Also use it when they ask for a feature or an integration Valet lacks.',
    ...(index ? [
      'Your own tools are loaded. Each integration\'s tools load when you ask: call tools with the ids of every integration the question needs, all in one call, and use their tools from your next step. Integrations:',
      ...index, 'Valet\'s own tools:', ...catalog.filter(l => ![...lineOf.values()].includes(l)),
    ] : ['Available integrations and tools:', ...catalog, ...extra]),
    a.instructions ?? '',
  ].join('\n');

  // chat.commands, and what a question may be about: an integration whose tools this chat may use
  const commands = commandsOf(config), mentionable = new Set(groups.keys());

  return async (c: HonoContext) => asker.run((c.get as (k: string) => string | undefined)('user') ?? 'you', async () => {
    const body = await c.req.json<{ messages: UIMessage[]; model?: unknown; reasoning?: unknown; mentions?: unknown; compact?: unknown }>();
    // an approval card left unanswered when they asked something else is a no: it never ran, and the model hears so
    const skipped = skipUnanswered(body.messages);
    // a custom command runs on its own model and reasoning, when it names them, and is about the integrations it lists;
    // the model reads its prompt where the page shows what was typed
    const ask = readAsk(skipped, commands, mentionable), all_ = expanded(skipped, commands);
    const named = checkMentions(body.mentions, mentionable);
    if ('error' in named) return c.json({ error: named.error }, 400);
    const focus = [...new Set([...named.ok, ...ask.mentions])];
    const asked = ask.custom?.model ?? body.model, level = ask.custom?.reasoning ?? body.reasoning;
    // the page sends a choice's id, never a model or a server: anything else is refused
    const pick = asked == null ? picks.get(a.model) : typeof asked === 'string' ? picks.get(asked) ?? await discovered(asked) : undefined;
    if (!pick) return c.json({ error: 'That model is not one of the choices in assistant.models.' }, 400);
    // and how much it thinks, for this chat: one of the levels, or the model's own (auto, or left out)
    const thinking = level == null ? undefined : Reasoning.safeParse(level).data;
    if (level != null && !thinking) return c.json({ error: 'reasoning is one of auto, off, low, medium, high.' }, 400);
    const s = pick.s, llm = pick.model ??= makeModel(s);
    const other = chatAgent(a, safety.acting);
    // /compact: the conversation so far becomes one summary now, by the same summariser the automatic path uses
    if (body.compact === true) {
      if (other) return c.json({ error: `${other.name} keeps its own conversation.` }, 400);
      const window = await contextWindow(s);
      const done = await compactNow(all_, who(), summariser(llm, { redact: safety.redact, signal: c.req.raw.signal, chars: window ? Math.floor(window * .4 * 3) : undefined }));
      return done === 'summary' ? c.json({ compacted: 'summary' }) : c.json({ error: done === 'nothing' ? 'There is nothing new to summarise yet.' : "The model couldn't summarise it. Try again, or start a new chat." }, done === 'nothing' ? 400 : 502);
    }
    if (other) {
      const plain = all_.slice(-24).filter(m => m.role !== 'system')
        .map(m => ({ ...m, parts: m.parts.flatMap((p: any) => p.type === 'text' && splitThink(p.text).said ? [{ type: 'text' as const, text: splitThink(p.text).said }] : []) }))
        .filter(m => m.parts.length);
      const result = streamText({ model: makeAgentModel(other), abortSignal: c.req.raw.signal, messages: await convertToModelMessages(plain) });
      return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
    }
    const m = await mcp();
    // MCP results pass through the redactor too (their headers can hold keys)
    const mcp_ = Object.fromEntries(Object.entries(m.tools).map(([k, t]: [string, any]) => [k, { ...t, execute: async (...args: any[]) => {
      // logged as it really went: a call that throws or answers with an error is a failure, not a success
      const log = (ok: boolean, error?: string) => { if (m.approval[k]) safety.activity?.add({ who: who(), via: 'chat', what: k.replace(/_/g, ' '), input: args[0], ok, error }); };
      let out: any;
      try { out = JSON.parse(safety.redact(JSON.stringify(await t.execute(...args) ?? null))); }
      catch (e) { log(false, safety.redact((e as Error).message)); throw e; }
      log(!out?.isError, out?.isError ? safety.redact(JSON.stringify(out.content ?? '').slice(0, 300)) : undefined);
      return out;
    } }]));
    const all: ToolSet = { ...tools, ...mcp_ }, approvals = { ...approval, ...m.approval };
    const chars = (x: unknown) => size(x), tokens = (n: number) => tokensOf(n, s.model);
    const cost = Object.fromEntries(await Promise.all(Object.entries(all).map(async ([k, t]: [string, any]) =>
      [k, k.length + size(t.description ?? '') + size(await Promise.resolve(asSchema(t.inputSchema).jsonSchema).catch(() => ({})))] as const)));
    const sum = (keys: string[]) => keys.reduce((x, k) => x + (cost[k] ?? 0), 0);
    // assistant.tools: lazy (or auto, with enough tools to matter): integrations' tools go only once asked for, or used earlier in the chat
    const lazy = a.tools === 'lazy' || (a.tools === 'auto' && tokens(sum(Object.keys(all))) >= LAZY_BELOW) ? (() => {
      const g = new Map(groups);
      for (const k of Object.keys(mcp_)) { const id = groupOf(k)!; const e = g.get(id) ?? { id, name: m.names?.[id] ?? id, type: 'mcp', keys: [] }; e.keys.push(k); g.set(id, e); }
      return g;
    })() : undefined;
    if (lazy) {
      all.tools = tool({
        description: 'Load the tools of integrations from the list in your instructions, by id, so you can call them from your next step. Name every integration the question needs in one call.',
        inputSchema: z.object({ use: z.array(z.string()).min(1).max(12).describe('integration ids, e.g. ["plex", "downloads"]') }),
        execute: async ({ use }) => {
          const { found, unknown } = resolve(use, lazy);
          return { data: { loaded: Object.fromEntries([...found].map(id => [id, lazy.get(id)!.keys])), ...(unknown.length ? { unknown, ids: [...lazy.keys()] } : {}) } };
        },
        toModelOutput: ({ output }) => ({ type: 'json', value: (output as { data: any }).data }),
      });
      cost.tools = 'tools'.length + 400;
    }
    const core = lazy ? Object.keys(all).filter(k => { const g = groupOf(k); return !g || !lazy.has(g); }) : undefined;
    const before = lazy ? usedBefore(all_, lazy) : undefined;
    // what the question is about is loaded from the first step, so there's no step spent asking for it
    if (lazy) for (const id of focus) if (lazy.has(id)) before!.add(id);
    // Valet's own first, then integrations in the order they were loaded, so each step's tools start like the last one's
    // (a server's prompt cache keeps the part that didn't change)
    const activeFor = (more: Set<string>) => [...core!, ...[...new Set([...before!, ...more])].flatMap(id => lazy!.get(id)?.keys ?? [])];
    const about = focusLine(focus, id => meta.get(id)?.name ?? id, !!lazy);
    const prompt = system(m.catalog, lazy && [...lazy.values()].map(g => indexLine(g))) + (about ? `\n${about}` : '');
    // what's sent is sized against the window: the system prompt and tools are fixed, the history gets the rest of the
    // target, and what doesn't fit is summarised (or, without a window, the last 24 messages go as they always have).
    // Lazy loading still reserves room for every tool, since any of them may be loaded during the answer.
    const window = await contextWindow(s), auto = a.compact && !!window;
    const fixed = size(prompt) + sum(Object.keys(all));
    const budget = auto ? Math.max(0, Math.floor(window! * TARGET) - tokens(fixed)) : undefined;
    const fitted = await fit(all_, { budget, cost: msg => tokens(chars(msg)), pinned: pinnedIn(all_, who()),
      summarise: summariser(llm, { redact: safety.redact, signal: c.req.raw.signal, chars: window ? Math.floor(window * .4 * 3) : undefined }) });
    const messages = fitted.messages, sent = (lazy ? size(prompt) + sum(activeFor(new Set())) : fixed) + chars(messages);
    let squeezed = false;   // the provider said it was too long, and it went again cut right down
    const lastStep = `${prompt}\n\nYou have no more lookups. Answer now in plain words from what you already found. If it doesn't settle the question, say what you checked and that you can't tell. Do not write tool calls.`;
    const result = streamText({
      model: wrapLanguageModel({ model: llm as Parameters<typeof wrapLanguageModel>[0]['model'], middleware: retryShorter(() => { squeezed = true; }) }),
      abortSignal: c.req.raw.signal,   // Stop (or closing the chat) ends generation and any tools still running
      system: prompt,
      messages: await convertToModelMessages(messages, { tools: all }),
      tools: all,
      toolApproval: approvals,
      experimental_toolApprovalSecret: APPROVALS,
      stopWhen: isStepCount(a.maxSteps),
      ...callSettings(s, thinking),   // the chat's reasoning, else assistant.reasoning, and assistant.options; nothing when they're left out
      ...(lazy ? { activeTools: activeFor(new Set()), toolOrder: activeFor(new Set()) } : {}),
      prepareStep: ({ stepNumber, messages: now, steps: done }) => {
        // a turn whose tool results pile up: earlier steps' results shrink before the next step, so one turn can't fill the window
        const smaller = auto && stepNumber > 0 ? squeezeSteps(now, budget!, tokens) : undefined;
        // the last step is for answering: a model still looking things up when its steps run out would otherwise say nothing
        // It's short and doesn't think first: a model forced to answer sometimes loops instead ("Let me check…" over and over)
        const last = stepNumber >= a.maxSteps - 1 ? { toolChoice: 'none' as const, system: lastStep, ...lastStepSettings(s) } : {};
        const loaded = lazy && stepNumber > 0 ? activeFor(askedFor(done, lazy)) : undefined;
        const active = loaded ? { activeTools: loaded, toolOrder: loaded } : {};
        return smaller || lazy || stepNumber >= a.maxSteps - 1 ? { ...last, ...active, ...(smaller ? { messages: smaller } : {}) } : undefined;
      },
    });
    // how full the model's context is after each step, for the meter beside its name: what it was given, and what it said.
    // The first step's real count also teaches the estimate how many characters make a token for this model.
    let first = true;
    const messageMetadata = ({ part }: { part: { type: string; usage?: { inputTokens?: number; outputTokens?: number } } }) => {
      if (part.type === 'start' && fitted.compacted) return { compacted: fitted.compacted };
      if (part.type !== 'finish-step') return undefined;
      if (first && !squeezed) calibrate(s.model, sent, part.usage?.inputTokens);
      first = false;
      const shown = squeezed ? { compacted: 'dropped' } : {};
      return part.usage?.inputTokens ? { ...shown, context: { used: part.usage.inputTokens + (part.usage.outputTokens ?? 0), window, ...(auto ? { auto } : {}) } } : squeezed ? shown : undefined;
    };
    // a tool that throws past runTool (a failed input check, say): the log and the page should both say what happened
    const failed = (e: unknown) => { if (tooLong(e)) return TOO_LONG_ANSWER; const m = safety.redact((e as Error)?.message ?? String(e)); console.error(`assistant: ${m}`); return m; };
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, tools: all, onError: failed, messageMetadata } as Parameters<typeof toUIMessageStream>[0]) });
  });
}
