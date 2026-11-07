// `assistant.tools: lazy`: the model starts with Valet's own tools and a line per connected integration, and loads an
// integration's tools by name (the `tools` tool) when a question needs them. Every tool stays registered, so approvals
// and execution are exactly as before; only which definitions go to the model changes, step by step.
// Nothing here knows any integration: the index is made from each one's own tool names.
import type { UIMessage } from 'ai';

/** Valet's own tools: always there, whatever the mode. */
export const CORE = new Set(['valet', 'config', 'pins']);
/** Below this many tokens of tool definitions, lazy loading costs a step and saves nothing: send them all. */
export const LAZY_BELOW = 6000;

export type Group = { id: string; name: string; type: string; keys: string[] };

/** "<instance>__<tool>" → the instance; built-ins (plan, show…) have none */
export const groupOf = (key: string) => { const i = key.indexOf('__'); return i < 0 ? null : key.slice(0, i); };

/** A tool's name in words, without the integration's own name: plex_recently_added on plex → "recently added". */
export function phrase(tool: string, id: string, type: string) {
  const own = new Set([...id.split(/[_-]/), ...type.split(/[_-]/)].map(s => s.toLowerCase()).filter(Boolean));
  const words = tool.replace(/([a-z])([A-Z])/g, '$1_$2').split(/[_\s-]+/).filter(Boolean);
  while (words.length > 1 && own.has(words[0]!.toLowerCase())) words.shift();
  return words.join(' ').toLowerCase();
}

/** One line per integration, from what its tools are called. */
export const indexLine = (g: Group) => {
  const said = [...new Set(g.keys.map(k => phrase(k.slice(g.id.length + 2), g.id, g.type)))];
  return `- ${g.id} (${g.name}): ${said.join(', ')}`;
};

/** The integrations asked for, matched on id, then type, then name ("tautulli" or "Plex" find the plex instance). */
export function resolve(asked: string[], groups: Map<string, Group>) {
  const found = new Set<string>(), unknown: string[] = [];
  const all = [...groups.values()], low = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const raw of asked) {
    const q = low(String(raw).split('__')[0]!);
    if (!q) continue;
    const hit = all.filter(g => low(g.id) === q);
    const byType = hit.length ? hit : all.filter(g => low(g.type) === q || low(g.id) === `mcp${q}`);
    const byName = byType.length ? byType : (q.length < 3 ? [] : all.filter(g => low(g.name).includes(q) || low(g.id).startsWith(q)));
    if (byName.length) for (const g of byName) found.add(g.id); else unknown.push(String(raw));
  }
  return { found, unknown };
}

/** Integrations whose tools this chat already used: they stay loaded for follow-ups. */
export function usedBefore(messages: UIMessage[], groups: Map<string, Group>) {
  const used = new Set<string>();
  for (const m of messages) for (const p of m.parts as any[]) {
    const name: string | undefined = p.type === 'dynamic-tool' ? p.toolName : typeof p.type === 'string' && p.type.startsWith('tool-') ? p.type.slice(5) : undefined;
    if (!name) continue;
    if (name === 'tools' && Array.isArray(p.input?.use)) for (const id of resolve(p.input.use, groups).found) used.add(id);
    const g = groupOf(name);
    if (g && groups.has(g)) used.add(g);
  }
  return used;
}

/** Integrations asked for in this answer's steps so far: by `tools`, or by calling one of their tools before loading it. */
export function askedFor(steps: { toolCalls: { toolName: string; input?: unknown }[] }[], groups: Map<string, Group>) {
  const asked = new Set<string>();
  for (const s of steps) for (const c of s.toolCalls) {
    if (c.toolName === 'tools') { const use = (c.input as { use?: unknown })?.use; if (Array.isArray(use)) for (const id of resolve(use, groups).found) asked.add(id); }
    const g = groupOf(c.toolName);
    if (g && groups.has(g)) asked.add(g);
  }
  return asked;
}
