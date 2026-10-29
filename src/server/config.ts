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

export const Config = z.object({
  title: z.string().default('Home'),
  greeting: z.string().optional(),         // name to greet, e.g. "Ibrahim"
  location: z.string().optional(),
  assistant: AssistantConfig.optional(),
  integrations: z.record(z.string(), z.object({ type: z.string() }).loose()).default({}),
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
