// The configured model, for the chat and for the small background jobs alike.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Config } from './config.ts';

/** Agents add their own named events to an OpenAI stream (Hermes' tool progress, say). The SDK reads every frame as a
 *  completion chunk and fails on those, so only the unnamed ones get through. */
export function plainEvents(body: ReadableStream<Uint8Array>) {
  let held = '';
  const keep = (frame: string) => /^event:/m.test(frame) && !/^event:\s*message\s*$/m.test(frame) ? '' : `${frame}\n\n`;
  return body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).pipeThrough(new TransformStream<string, string>({
    transform(chunk, out) {
      const frames = (held + chunk).split(/\r?\n\r?\n/);
      held = frames.pop() ?? '';
      for (const f of frames) { const k = keep(f); if (k) out.enqueue(k); }
    },
    flush(out) { if (held.trim()) out.enqueue(keep(held)); },
  })).pipeThrough(new TextEncoderStream());
}
const agentFetch: typeof fetch = async (url, init) => {
  const r = await fetch(url, init);
  return r.body && r.headers.get('content-type')?.includes('text/event-stream') ? new Response(plainEvents(r.body), { status: r.status, headers: r.headers }) : r;
};

/** Another agent, reached the same way. It's only ever given the conversation: never tools, never Atrium's data. */
export function makeAgentModel(a: NonNullable<Config['assistant']>['agents'][number]) {
  return createOpenAICompatible({ name: 'agent', baseURL: a.baseURL, apiKey: a.apiKey, headers: { 'User-Agent': 'Atrium' }, fetch: agentFetch })(a.model);
}

export function makeModel(a: NonNullable<Config['assistant']>) {
  return a.provider === 'anthropic'
    ? createAnthropic({ apiKey: a.apiKey, baseURL: a.baseURL })(a.model)
    : createOpenAICompatible({ name: 'assistant', baseURL: a.baseURL ?? 'http://localhost:11434/v1', apiKey: a.apiKey, includeUsage: true, headers: { 'User-Agent': 'Atrium' } })(a.model);
}
