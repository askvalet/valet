// One page from the public internet, for the assistant's web_read, and from nowhere else. The address comes from a model
// that a stranger's text may have steered, and Valet sits inside a home network, so: http and https only, no sign-in in
// the address, every address the name resolves to must be a public one, the connection goes to the address that was
// checked (a second DNS answer can't swap it), each redirect is checked the same way, nothing is sent but a plain GET
// (no cookies, no keys), and the time, the size and the kind of reply are all capped.
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { createBrotliDecompress, createGunzip } from 'node:zlib';

// everything that isn't a public address: this machine, the home network, link-local, carrier NAT, multicast, reserved
const INSIDE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) INSIDE.addSubnet(net, bits, 'ipv4');
// 2001::/23 holds Teredo and 2002::/16 is 6to4: both carry an IPv4 address inside, so neither is taken on trust
for (const [net, bits] of [['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]] as const) INSIDE.addSubnet(net, bits, 'ipv6');
const NAT64 = new BlockList(); NAT64.addSubnet('64:ff9b::', 96, 'ipv6');

/** Whether an address is out on the internet. An IPv4 address written as IPv6 (mapped, or behind NAT64) is judged as the IPv4 one. */
export function isPublic(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  if (family === 4) return !INSIDE.check(address, 'ipv4');
  if (NAT64.check(address, 'ipv6')) {
    const parts = address.split(':'), last = parts.at(-1)!;
    if (last.includes('.')) return isPublic(last);
    const hi = parseInt(parts.at(-2) || '0', 16), lo = parseInt(last || '0', 16);
    return isPublic(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return !INSIDE.check(address, 'ipv6');   // an IPv4-mapped address meets the IPv4 rules here
}

export type Address = { address: string; family: number };
export type Resolve = (host: string) => Promise<Address[]>;
export interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array>; close(): void }
/** One GET to `url`, connected to `to` whatever the name says by then. */
export type Wire = (url: URL, to: Address, signal: AbortSignal) => Promise<Reply>;

const resolveAll: Resolve = host => lookup(host, { all: true, verbatim: true });

export const wire: Wire = (url, to, signal) => new Promise((ok, no) => {
  const req = (url.protocol === 'https:' ? https : http).request(url, {
    method: 'GET', agent: false, signal,
    headers: { 'User-Agent': 'Valet', Accept: 'text/html, text/plain;q=0.9', 'Accept-Encoding': 'gzip, br' },
    // the pin: the name was resolved and checked already, and this is the only address the socket may go to
    lookup: ((_host: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => o.all ? cb(null, [to]) : cb(null, to.address, to.family)) as never,
  }, res => {
    const coded = String(res.headers['content-encoding'] ?? 'identity').toLowerCase();
    const unpack = coded === 'gzip' ? createGunzip() : coded === 'br' ? createBrotliDecompress() : null;
    const close = () => { res.destroy(); unpack?.destroy(); req.destroy(); };
    if (!unpack && coded !== 'identity') { close(); return no(new Error(`${url.hostname} answered in a form Valet doesn't read (${coded.slice(0, 20)})`)); }
    if (unpack) res.on('error', e => unpack.destroy(e));
    ok({ status: res.statusCode ?? 502, headers: res.headers, body: unpack ? res.pipe(unpack) : res, close });
  });
  req.on('error', no); req.end();
});

/** The address as it will be fetched, or why it won't be. */
export function pageUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('that isn\'t a web address'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http and https pages can be read');
  if (url.username || url.password) throw new Error('an address with a sign-in in it isn\'t read');
  url.hash = '';
  return url;
}

/** The address to connect to for `host`: its first, once every one it has is public. A name with one foot inside the
 *  network is refused whole, since which answer a connection gets is the name's owner's choice. */
export async function publicAddress(host: string, resolve: Resolve = resolveAll): Promise<Address> {
  const name = host.replace(/^\[|\]$/g, ''), literal = isIP(name);
  const found = literal ? [{ address: name, family: literal }] : await resolve(name).catch(() => []);
  if (!found.length) throw new Error(`${name} can't be found`);
  if (!found.every(a => isPublic(a.address))) throw new Error(`${name} is not on the public internet; only public pages can be read`);
  return found[0];
}

export const MAX_PAGE = 2 * 2 ** 20, MAX_HOPS = 4, PAGE_TIMEOUT = 10_000;
const TYPES = new Set(['text/html', 'text/plain']);

export interface Page { url: string; type: string; body: string; cut: boolean }
/** GET one public page as text. Redirects are followed by hand, each hop checked like the first; a reply past `max`
 *  bytes (after unpacking) is cut there, and anything that isn't HTML or plain text is refused unread. */
export async function publicPage(raw: string, o: { resolve?: Resolve; wire?: Wire; signal?: AbortSignal; max?: number } = {}): Promise<Page> {
  const signal = o.signal ?? AbortSignal.timeout(PAGE_TIMEOUT), send = o.wire ?? wire, max = o.max ?? MAX_PAGE;
  const late = new Promise<never>((_, no) => { const stop = () => no(new Error('the page took too long')); if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); });
  late.catch(() => {});
  let open: Reply | undefined;
  const get = async (): Promise<Page> => {
    let url = pageUrl(raw);
    for (let hop = 0; ; hop++) {
      const to = await publicAddress(url.hostname, o.resolve);
      const res = open = await send(url, to, signal);
      const next = res.status >= 300 && res.status < 400 && [res.headers.location].flat()[0];
      if (next) {
        res.close();
        if (hop >= MAX_HOPS) throw new Error('too many redirects');
        url = pageUrl(new URL(next, url).href);
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new Error(`${url.hostname} answered ${res.status}`);
      const [type = '', ...params] = String([res.headers['content-type']].flat()[0] ?? '').toLowerCase().split(';').map(s => s.trim());
      if (!TYPES.has(type)) throw new Error(`that's not a page of text (${type.slice(0, 40) || 'no type given'})`);
      const parts: Uint8Array[] = []; let size = 0, cut = false;
      for await (const chunk of res.body) {
        if (size + chunk.length > max) { parts.push(chunk.subarray(0, max - size)); cut = true; break; }
        parts.push(chunk); size += chunk.length;
      }
      const charset = params.find(p => p.startsWith('charset='))?.slice(8).replace(/["']/g, '') || 'utf-8';
      let decoder: TextDecoder;
      try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
      return { url: url.href, type, body: decoder.decode(Buffer.concat(parts)), cut };
    }
  };
  try { return await Promise.race([get(), late]); }
  catch (e) { throw signal.aborted ? new Error('the page took too long') : e; }
  finally { open?.close(); }
}

// ── a page as words
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return n > 0x1f && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : ' ';
});
/** Whitespace settled: single spaces, at most one empty line. */
export const tidy = (s: string) => s.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// never words for a reader: code, styles, drawings, and the page's own chrome
const SKIP = new Set(['title', 'script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'object', 'select', 'button', 'nav', 'footer', 'aside']);
const BREAK = new Set(['p', 'div', 'br', 'hr', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'tr', 'td', 'th', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'main', 'blockquote', 'pre', 'figure', 'figcaption', 'body']);
const named = (c: number) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57);

/** A page's title and its words, by walking the text once. Pages are written by strangers: every search here either
 *  moves the cursor past what it found or ends the walk, so no page can make it take more than its own length. */
export function pageText(html: string) {
  const low = html.replace(/[A-Z]/g, c => c.toLowerCase());   // ASCII only, so every index means the same in both
  const head = low.indexOf('<title'), start = head < 0 ? -1 : low.indexOf('>', head), end = start < 0 ? -1 : low.indexOf('</title', start);
  const title = end < 0 ? undefined : tidy(decode(html.slice(start + 1, Math.min(end, start + 1 + 300)))).replace(/\n/g, ' ') || undefined;
  let out = '', at = 0;
  for (;;) {
    const lt = low.indexOf('<', at);
    if (lt < 0) { out += html.slice(at); break; }
    out += html.slice(at, lt);
    if (low.startsWith('<!--', lt)) { const close = low.indexOf('-->', lt + 4); if (close < 0) break; at = close + 3; continue; }
    const closing = low[lt + 1] === '/', from = lt + (closing ? 2 : 1);
    let to = from;
    while (to < low.length && named(low.charCodeAt(to))) to++;
    const name = low.slice(from, to);
    if (!name && low[from] !== '!' && low[from] !== '?') { out += '<'; at = lt + 1; continue; }   // "a < b" is words
    const gt = low.indexOf('>', to);
    if (gt < 0) break;
    at = gt + 1;
    if (!closing && SKIP.has(name)) {
      const close = low.indexOf(`</${name}`, at), done = close < 0 ? -1 : low.indexOf('>', close);
      if (done < 0) break;
      at = done + 1;
    }
    if (BREAK.has(name)) out += '\n';
  }
  return { title, text: tidy(decode(out)) };
}
