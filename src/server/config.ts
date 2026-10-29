// config.yaml: one file, readable top to bottom. `${NAME}` anywhere is replaced from the environment, so secrets
// can live in .env / docker secrets instead of the file. Unknown keys are errors, with the path in the message.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const Access = z.enum(['none', 'read', 'control']);

export const AssistantConfig = z.object({
  // any OpenAI-compatible server (Ollama, llama.cpp, vLLM, OpenRouter, OpenAI…) or Anthropic
  provider: z.enum(['openai-compatible', 'anthropic']).default('openai-compatible'),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string(),
  name: z.string().default('Assistant'),
  instructions: z.string().optional(),     // extra system prompt
  // what the assistant may use: a default plus per-integration overrides, e.g. { default: read, lights: control }
  access: z.record(z.string(), Access).default({ default: 'read' }),
  maxSteps: z.number().int().min(1).max(20).default(6),
}).strict();

const Section = z.object({
  title: z.string().optional(),
  widgets: z.array(z.string()),            // "instance.widget"
  columns: z.number().int().min(1).max(4).optional(),
}).strict();

// An MCP server whose tools the assistant may use. `access: read` offers only the tools the server marks read-only
// (plus any listed in readOnly); `control` offers all of them, and anything not read-only asks the person first.
export const McpServer = z.object({
  url: z.string().url(),
  transport: z.enum(['http', 'sse']).default('http'),
  headers: z.record(z.string(), z.string()).optional(),
  access: Access.default('read'),
  readOnly: z.array(z.string()).default([]),
  name: z.string().optional(),
}).strict();

// Look and feel. A wallpaper turns every card into frosted glass over it.
export const Appearance = z.object({
  wallpaper: z.string().optional(),        // local file path (served by Atrium) or an image URL
  dim: z.number().min(0).max(0.9).default(0.35),
  blur: z.number().min(0).max(40).default(0),
}).strict();

export const Config = z.object({
  title: z.string().default('Home'),
  greeting: z.string().optional(),         // name to greet, e.g. "Ibrahim"
  location: z.string().optional(),
  appearance: Appearance.default({ dim: 0.35, blur: 0 }),
  assistant: AssistantConfig.optional(),
  integrations: z.record(z.string(), z.object({ type: z.string() }).loose()).default({}),
  mcp: z.record(z.string(), McpServer).default({}),
  layout: z.array(Section).default([]),
}).strict();
export type Config = z.infer<typeof Config>;

function substitute(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
    if (process.env[k] === undefined) throw new Error(`config: environment variable ${k} is not set`);
    return process.env[k]!;
  });
  if (Array.isArray(v)) return v.map(substitute);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x)]));
  return v;
}

export function loadConfig(path: string): Config {
  const raw = substitute(parse(readFileSync(path, 'utf8')) ?? {});
  const r = Config.safeParse(raw);
  if (!r.success) throw new Error('config.yaml:\n' + r.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  return r.data;
}
