// An approval's words: what a tool is about to do, as the service itself says it, for the card on the page and for
// anywhere else an approval is asked (a chat app). It only reads. The same doors the chat has: a page that can't act gets
// no words, a tool only ever sees checked input, and what's said is what the tool says, never what the model wrote.
import type { Config } from './config.ts';
import type { Instance, Tool } from './core.ts';
import { rank, toolAccess } from './run.ts';
import type { Confirm } from '../shared/cards.ts';

/** `strict`: for someone with a profile, words only for a tool their assistant could really call, since a tool's words may look things up. */
export interface ConfirmSite { config: Config; instances: Map<string, Instance>; acting: boolean; redact: (s: string) => string; strict?: boolean }
export type Said = Partial<Confirm> & { steps?: (Confirm | null)[] };

export async function confirmWords(site: ConfirmSite, tool: unknown, input: any): Promise<Said> {
  const [inst, name] = String(tool ?? '').split('__'), t = name ? site.instances.get(inst)?.tools?.[name] : undefined;
  const type = site.config.integrations[inst]?.type, logo = type ? `/api/icon/${type}` : undefined;
  const may = (id: string, n: string, step: Tool) => { const level = toolAccess(site.config.assistant, id, n); return level > rank.none && (!site.strict || rank[step.access] <= level); };
  if (!site.acting) return { logo };
  const words = async (id: string, n: string, step: Tool, raw: unknown) => {
    const args = step.input.safeParse(raw ?? {});
    if (!args.success || !step.confirm || !may(id, n, step)) return null;
    return step.confirm(args.data);
  };
  const clean = <T>(x: T): T => JSON.parse(site.redact(JSON.stringify(x)));
  try {
    if (tool === 'plan' && Array.isArray(input?.steps)) {
      // each step in the service's own words, so what's approved is what the tool says, not what the model wrote beside it
      const steps = await Promise.all(input.steps.map(async (s: any) => {
        const [id, n] = String(s?.tool ?? '').split('__'), step = site.instances.get(id)?.tools?.[n];
        return step ? await words(id, n, step, s.input).catch(() => null) : null;
      }));
      return clean({ steps, danger: steps.some(s => s?.danger) || undefined });
    }
    if (!t?.confirm) return { logo };
    const said = await words(inst, name, t, input);
    return said ? clean({ logo, ...said }) : { logo };
  } catch { return { logo }; }
}
