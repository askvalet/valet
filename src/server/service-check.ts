// Runs a service() against the sample it carries, the way Valet would run it for real. The test suite uses this for every
// service in the catalog, and `check-integration` uses it for yours, so what passes here passes there.
import { checkCard } from '../shared/cards.schema.ts';
import { session, type Context } from './core.ts';
import type { ServiceDef } from './service.ts';
import { BackupShape } from './backups.ts';

const creds = (def: ServiceDef<any>) => {
  const a: any = def.auth, needs = a?.needs ?? ['username', 'password'];
  return { ...(a === 'bearer' || a === 'token' || a?.header || a?.query || (a?.login && needs.includes('key')) ? { key: 'sample-key' } : {}), ...(a === 'basic' || (a?.login && needs.includes('username')) ? { username: 'u' } : {}), ...(a === 'basic' || (a?.login && needs.includes('password')) ? { password: 'p' } : {}) };
};
export const sampleConfig = (def: ServiceDef<any>) => ({ url: 'http://svc', ...creds(def), ...def.sampleOptions });

export function fakeContext(def: ServiceDef<any>, status = 200) {
  const options: any = { url: 'http://svc', session: 'tok', ...def.sampleOptions };
  const first = typeof def.get === 'function' ? def.get(options) : def.get;
  const gets = [...Object.entries(first), ...Object.entries(def.then?.(def.sample, options) ?? {}), ...Object.entries(def.backupGet?.(def.sample, options) ?? {})] as [string, any][];
  const pathOf = (g: any) => typeof g === 'string' ? g : g.path;
  let signedIn = false;
  const c: Context & { asked: string[] } = {
    id: 'sample', asked: [], log() {}, image: (r: string) => `/img/${r}`, upload: async () => ({ name: 'f', type: 'text/plain', data: Buffer.from('') }) as any, session,
    async http(url: string, init: any = {}) {
      c.asked.push(url);
      const auth = def.auth as any, login = auth?.login;
      // the first call to the sign-in path signs in, even where sign-in and data share one (Deluge)
      if (login && !signedIn && url.endsWith(login)) { signedIn = true; const a = def.loginSample ?? { token: 'tok', access_token: 'tok', result: 'tok', sid: 'tok', jwt: 'tok' }; return new Response(typeof a === 'string' ? a : JSON.stringify(a), { headers: { 'set-cookie': 'sid=abc; Path=/' } }) as any; }
      if (auth?.handshake && !init.headers?.[auth.handshake.header]) return new Response('', { status: auth.handshake.status, headers: { [auth.handshake.header]: 'session-1' } }) as any;
      if (status !== 200) return new Response('nope', { status }) as any;
      const u = new URL(url), asked = u.pathname + (u.search.replace(/[?&](apikey|api_key|apiKey|token|key|auth)=[^&]*/g, '').replace(/^&/, '?'));
      const body = init.body == null ? undefined : String(init.body);
      const same = gets.filter(([, g]) => pathOf(g) === asked || pathOf(g).split('?')[0] === u.pathname);   // one endpoint can serve several calls
      const hit = same.find(([, g]) => typeof g === 'object' && g.body != null && (typeof g.body === 'object' && !(g.body instanceof URLSearchParams) ? JSON.stringify(g.body) : String(g.body)) === body) ?? same.find(([, g]) => pathOf(g) === asked) ?? same[0];
      const out = hit ? def.sample[hit[0]] : undefined, as = hit && typeof hit[1] === 'object' ? hit[1].as : undefined;
      const res = new Response(as === 'text' ? String(out) : JSON.stringify(out ?? {}), { headers: as === 'headers' ? out as Record<string, string> : {} });
      return (init.as === 'response' ? res : init.as === 'text' ? res.text() : res.json()) as any;
    },
  } as any;
  return c;
}

/** What's wrong with a service, in plain words; empty when it's good. */
export async function checkService(s: { def: ServiceDef<any>; config: any; create: any }) {
  const problems: string[] = [], def = s.def;
  const parsed = s.config.safeParse(sampleConfig(def));
  if (!parsed.success) return [`the config doesn't accept its own sample: ${parsed.error.issues[0].message}`];
  const inst = s.create(parsed.data, fakeContext(def));
  let card: any;
  try { card = await inst.widgets.status.fetch(); } catch (e) { return [`it can't read its own sample: ${(e as Error).message}`]; }
  const valid = checkCard(card);
  if (!valid.success) problems.push(`its card isn't valid: ${valid.error.issues.slice(0, 2).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  if (!card.summary) problems.push('it has no headline for small tiles');
  const shown: Record<string, unknown> = Object.fromEntries((card.items ?? []).map((i: any) => [i.label ?? i.name ?? i.title, i.value ?? i.meta ?? i.subtitle ?? i.ok]));
  for (const [k, want] of Object.entries(def.expect ?? {})) if (String(shown[k]) !== String(want)) problems.push(`"${k}" shows ${String(shown[k])}, expected ${want}`);
  for (const i of card.type === 'stats' ? card.items : []) if (['–', 'undefined', 'NaN', 'null'].includes(String(i.value))) problems.push(`"${i.label}" came up empty: the sample doesn't have that field`);
  if (def.recap) {
    const slides = await inst.recap({ year: 2026, from: 0, to: Date.now() }).catch((e: Error) => { problems.push(`its recap failed: ${e.message}`); return null; });
    if (slides && !slides.length) problems.push('its recap said nothing about its own sample');
    for (const s of slides ?? []) if (/undefined|NaN|null/.test(`${s.value} ${s.line}`)) problems.push(`its recap came up empty: "${s.value}", "${s.line}"`);
  }
  if (def.backups) {
    const jobs = await inst.backups().catch((e: Error) => { problems.push(`its backups failed: ${e.message}`); return null; });
    if (jobs && !jobs.length) problems.push('its backups said nothing about its own sample');
    for (const j of jobs ?? []) { const r = BackupShape.safeParse(j); if (!r.success) problems.push(`a backup job doesn't fit: ${r.error.issues[0].path.join('.')}: ${r.error.issues[0].message}`); }
  }
  if (!Object.keys(def.expect ?? {}).length) problems.push('add `expect`, so a test proves the numbers land in the right place');
  if (Object.values(inst.tools ?? {}).some((t: any) => t.access !== 'read')) problems.push('its tool must only read');
  try { await s.create(parsed.data, fakeContext(def, 500)).widgets.status.fetch(); problems.push('it reported success when the service answered 500'); } catch (e) { if (/sample-key|[?&](api_?key|token)=/i.test((e as Error).message)) problems.push('its error message leaks the key'); }
  return problems;
}
