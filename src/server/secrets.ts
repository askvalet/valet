// Where a `${NAME}` comes from when the environment doesn't have it: a file (`NAME_FILE`, or a folder of them, as Docker
// and Kubernetes mount secrets), HashiCorp Vault, or a 1Password Connect server. Plain HTTP, no SDK. Values stay in
// memory: nothing here writes or logs one, and an error names the variable and the provider, never a value or a token.
import { closeSync, openSync, readSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { redactor } from './security.ts';

/** every value a ${…} was replaced with, and the providers' own tokens: Valet redacts these from anything it sends out */
export const usedSecrets: string[] = [];
export const remember = (value: string) => { if (!usedSecrets.includes(value)) usedSecrets.push(value); };
const redact = redactor(usedSecrets);

// a secret is a line or a key, not a download: bigger than this is a mistake, or someone else's file
const FILE_MAX = 64 * 1024, ANSWER_MAX = 512 * 1024, TIMEOUT = 10_000;

/** What a secret file holds, without the newline an editor leaves. */
export function readSecret(path: string, what: string): string {
  let fd: number | undefined, n = 0;
  const buf = Buffer.alloc(FILE_MAX + 1);
  try {
    fd = openSync(path, 'r');
    for (let got; n < buf.length && (got = readSync(fd, buf, n, buf.length - n, null)) > 0;) n += got;
  } catch { throw new Error(`config: ${what}: can't read ${path}`); }
  finally { if (fd !== undefined) closeSync(fd); }
  if (n > FILE_MAX) throw new Error(`config: ${what}: ${path} is over ${FILE_MAX / 1024} KB, too big to be a secret`);
  return buf.toString('utf8', 0, n).trim();
}

/** A file in a secrets folder, wherever its links lead (Kubernetes mounts each as a link), as long as that's still
 *  inside the folder. Nothing when it isn't there. */
export function inFolder(dir: string, file: string, what: string): string | undefined {
  let root: string, real: string;
  try { root = realpathSync(dir); real = realpathSync(join(dir, file)); } catch { return undefined; }
  if (!real.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error(`config: ${what}: ${join(dir, file)} leads outside ${dir}`);
  return readSecret(real, what);
}

// what Vault or 1Password answered for the names the config needed, until the next load asks again
const given = new Map<string, string>();

/** One name from the first place that has it: the environment, `NAME_FILE`, the secrets folder (a file called NAME, or
 *  name), then what the providers gave. `kept` says whether it's a secret however it's named: it came from a store of them. */
export function lookup(name: string, o: { files?: string; providers?: boolean } = {}): { value: string; kept: boolean } | undefined {
  const what = `\${${name}}`;
  if (process.env[name] !== undefined) return { value: process.env[name]!, kept: false };
  if (process.env[`${name}_FILE`]) return { value: readSecret(process.env[`${name}_FILE`]!, what), kept: false };
  const filed = o.files ? inFolder(o.files, name, what) ?? inFolder(o.files, name.toLowerCase(), what) : undefined;
  if (filed !== undefined) return { value: filed, kept: true };
  return o.providers && given.has(name) ? { value: given.get(name)!, kept: true } : undefined;
}

interface Access { url: string; token?: string; tokenFile?: string }
export interface Providers {
  vault?: Access & { mount: string; path: string; namespace?: string };
  onepassword?: Access & { vault: string; item: string };
}
const NAMES = { vault: 'Vault', onepassword: '1Password' } as const;
/** The providers a config has, as a person would call them, for a message that says where Valet looked. */
export const providersOf = (p: Providers) => (Object.keys(NAMES) as (keyof typeof NAMES)[]).filter(k => p[k]).map(k => NAMES[k]);

async function body(res: Response) {
  const tooBig = new Error(`its answer is over ${ANSWER_MAX / 1024} KB`);
  if (Number(res.headers.get('content-length')) > ANSWER_MAX) { await res.body?.cancel(); throw tooBig; }
  const reader = res.body?.getReader(), parts: Uint8Array[] = [];
  for (let n = 0; reader;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((n += value.length) > ANSWER_MAX) { await reader.cancel(); throw tooBig; }
    parts.push(value);
  }
  return Buffer.concat(parts).toString('utf8');
}
/** One GET, with the token in a header. No redirect is followed, so the token only ever goes to the address in the config. */
async function ask(url: string, headers: Record<string, string>, missing: string, send: typeof fetch): Promise<any> {
  let res: Response;
  try { res = await send(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) }); }
  catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    throw new Error(/Timeout|Abort/.test(err.name) ? `no answer in ${TIMEOUT / 1000} seconds` : `can't reach it${err.cause?.code ? ` (${err.cause.code})` : ''}`);
  }
  if (res.status >= 300 && res.status < 400) {
    let to = ''; try { to = new URL(res.headers.get('location') ?? '', url).host; } catch { /* no address to name */ }
    await res.body?.cancel();
    throw new Error(`it redirects${to ? ` to ${to}` : ''}, which isn't followed: put the address it really answers at in the config`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(res.status === 401 || res.status === 403 ? `the token was refused (${res.status})` : res.status === 404 ? `${missing} (404)` : `it answered ${res.status}`);
  }
  try { return JSON.parse(await body(res)); } catch (e) { throw /over \d+ KB/.test((e as Error).message) ? e : new Error('its answer isn\'t JSON'); }
}

const tokenOf = (a: Access, where: string) => { const t = a.token ?? readSecret(a.tokenFile!, `${where}.tokenFile`); remember(t); return t; };
const base = (url: string) => url.replace(/\/+$/, '');
const segments = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/** KV version 2: one secret, whose keys are the names. */
async function vault(v: NonNullable<Providers['vault']>, send: typeof fetch) {
  const j = await ask(`${base(v.url)}/v1/${segments(v.mount)}/data/${segments(v.path)}`,
    { 'X-Vault-Token': tokenOf(v, 'secrets.vault'), 'X-Vault-Request': 'true', ...(v.namespace ? { 'X-Vault-Namespace': v.namespace } : {}) },
    `there's no secret at ${v.mount}/${v.path}, or the token may not read it`, send);
  const data = j?.data?.data, out = new Map<string, string>();
  if (!data || typeof data !== 'object') throw new Error(`${v.mount} doesn't look like a KV version 2 engine`);
  for (const [k, x] of Object.entries(data)) if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out.set(k, String(x));
  return out;
}

/** 1Password Connect: one item, whose field labels are the names. A vault or an item is its ID, or its name looked up. */
async function onepassword(o: NonNullable<Providers['onepassword']>, send: typeof fetch) {
  const headers = { Authorization: `Bearer ${tokenOf(o, 'secrets.onepassword')}` }, vaults = `${base(o.url)}/v1/vaults`;
  const idOf = async (list: string, key: 'name' | 'title', called: string, what: string) => {
    if (/^[a-z0-9]{26}$/.test(called)) return called;
    const all = await ask(`${list}?filter=${encodeURIComponent(`${key} eq "${called}"`)}`, headers, `it has no ${what}s to list`, send);
    const hits = (Array.isArray(all) ? all : []).filter(x => x?.[key] === called && /^[a-z0-9]+$/i.test(String(x.id)));
    if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} ${what}s are called "${called}": use the ID` : `no ${what} called "${called}", or the token may not read it`);
    return String(hits[0].id);
  };
  const vaultId = await idOf(vaults, 'name', o.vault, 'vault'), itemId = await idOf(`${vaults}/${vaultId}/items`, 'title', o.item, 'item');
  const item = await ask(`${vaults}/${vaultId}/items/${itemId}`, headers, `there's no item ${o.item} in ${o.vault}`, send), out = new Map<string, string>();
  for (const f of Array.isArray(item?.fields) ? item.fields : []) if (typeof f?.label === 'string' && typeof f.value === 'string' && f.value && !out.has(f.label)) out.set(f.label, f.value);
  return out;
}

/** Ask the providers for the names nothing nearer had: Vault first, then 1Password for what's still missing. A provider
 *  that can't be asked fails the whole load, so the config before it keeps running with the values it had. */
export async function askProviders(p: Providers, need: string[], send: typeof fetch = fetch) {
  const found = new Map<string, string>();
  for (const k of Object.keys(NAMES) as (keyof typeof NAMES)[]) {
    const left = need.filter(n => !found.has(n));
    if (!p[k] || !left.length) continue;
    let got: Map<string, string>;
    try { got = await (k === 'vault' ? vault(p.vault!, send) : onepassword(p.onepassword!, send)); }
    catch (e) { throw new Error(redact(`config: can't get ${left.map(n => `\${${n}}`).join(', ')} from ${NAMES[k]} at ${new URL(p[k]!.url).host}: ${(e as Error).message.replace(/^config: /, '')}`)); }
    for (const n of left) { const v = got.get(n) ?? got.get(n.toLowerCase()); if (v !== undefined) found.set(n, v); }
  }
  for (const n of need) { const v = found.get(n); if (v === undefined) given.delete(n); else { given.set(n, v); remember(v); } }
}
/** Forget what the providers gave (a config that no longer has them, and tests). */
export const forget = () => given.clear();

/** `secrets.refresh`: ask again every so often. One run at a time, and `set` only restarts it when the time changed. */
export class Refresh {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private run: () => Promise<unknown>;
  every: number | undefined;
  constructor(run: () => Promise<unknown>) { this.run = run; }
  set(ms?: number) {
    if (ms === this.every) return;
    this.stop(); this.every = ms;
    if (ms) { this.timer = setInterval(() => void this.tick(), ms); this.timer.unref(); }
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try { await this.run(); } finally { this.busy = false; }
  }
  stop() { clearInterval(this.timer); this.timer = undefined; this.every = undefined; }
}
