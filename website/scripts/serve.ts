// What the harness page loads: the built harness, demo/art, drawn pictures and app icons. Nothing else, and only on 127.0.0.1.
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4' };

const hash = (s: string) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const rng = (seed: string) => { let s = (hash(seed) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const PALETTES = [['#0b1033', '#5b3a8c', '#f2708a', '#ffc27a'], ['#04202b', '#0e5a6b', '#3fb6a8', '#f5e6a8'], ['#1a0b2e', '#7a2a6b', '#ff6f59', '#ffd166'], ['#0a1a12', '#1f5c44', '#8fbf6a', '#f0e6b0'], ['#101726', '#2f4a7a', '#7fa8d6', '#f3d9b1'], ['#23100c', '#7a3220', '#d9743c', '#f6c56f']];
/** The demo's way of drawing a picture: a dusk over ridges, different for every seed. Nothing real, nothing remote. */
export function drawn(seed: string, w = 800, h = 800) {
  const r = rng(seed), p = PALETTES[Math.floor(r() * PALETTES.length)], id = hash(seed) % 9999, sx = w * (.2 + r() * .6), sy = h * (.3 + r() * .25);
  const ridges = [0, 1, 2, 3].map(k => {
    const base = h * (.6 + k * .1), amp = h * (.13 - k * .017), a = r() * 9, b = r() * 9;
    let d = `M0,${h}`;
    for (let x = 0; x <= w; x += w / 48) d += ` L${x.toFixed(0)},${(base - amp * (.6 * Math.sin(x / (w * .19) + a) + .4 * Math.sin(x / (w * .07) + b))).toFixed(0)}`;
    return `<path d="${d} L${w},${h}Z" fill="${p[0]}" opacity="${.45 + k * .18}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset=".45" stop-color="${p[1]}"/><stop offset=".8" stop-color="${p[2]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g${id})"/><circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="${(h * .1).toFixed(0)}" fill="${p[3]}" opacity=".9"/>${ridges}</svg>`;
}
const letter = (s: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#3a3a40"/><text x="16" y="22" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="600" fill="#fff">${s.slice(0, 1).toUpperCase().replace(/[^A-Z0-9]/, '?')}</text></svg>`;

/** The same icons Valet would use: demo/icons first, then dashboard-icons once, kept in .cache so a rebuild needs no network. */
export async function iconFile(slug: string, repo: string, cache: string): Promise<string | null> {
  mkdirSync(cache, { recursive: true });
  const parts = slug.split('-');
  for (let n = parts.length; n > 0; n--) {
    const name = parts.slice(0, n).join('-'), own = join(repo, 'demo/icons', `${name}.png`), kept = join(cache, `${name}.png`), none = join(cache, `${name}.none`);
    if (existsSync(own)) return own;
    if (existsSync(kept)) return kept;
    if (existsSync(none)) continue;
    try {
      const res = await fetch(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${name}.png`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) { writeFileSync(kept, Buffer.from(await res.arrayBuffer())); return kept; }
      if (res.status === 404) writeFileSync(none, '');
    } catch { /* offline: the card goes without, as it would in Valet */ }
  }
  return null;
}

export const portFree = (port: number) => new Promise<boolean>(ok => { const s = createConnection({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); ok(false); }); s.once('error', () => ok(true)); });
export async function freePort(from = 7700) { for (let p = from; p < from + 80; p++) if (await portFree(p)) return p; throw new Error('no free port near 7700'); }

export function serve(root: string, repo: string, port: number) {
  const dist = resolve(root, '.cache/harness'), art = resolve(repo, 'demo/art'), icons = resolve(root, '.cache/icons');
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x'), p = decodeURIComponent(url.pathname);
    const send = (body: string | Buffer, type: string) => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=3600' }); res.end(body); };
    const file = (f: string) => existsSync(f) ? send(readFileSync(f), MIME[extname(f)] ?? 'application/octet-stream') : (res.writeHead(404), res.end());
    if (p === '/wallpaper.jpg') return file(resolve(repo, 'demo/wallpaper.jpg'));
    if (p.startsWith('/art/')) return file(join(art, normalize(p.slice(5)).replace(/^(\.\.[/\\])+/, '')));
    if (p.startsWith('/img/')) return send(drawn(p.slice(5)), MIME['.svg']);
    if (p.startsWith('/api/favicon/')) return send(letter(p.slice(13)), MIME['.svg']);
    if (p.startsWith('/api/icon/')) { const f = /^[a-z0-9-]{1,64}$/.test(p.slice(10)) ? await iconFile(p.slice(10), repo, icons) : null; return f ? file(f) : (res.writeHead(404), res.end()); }
    return file(p === '/' ? join(dist, 'index.html') : join(dist, normalize(p).replace(/^(\.\.[/\\])+/, '')));
  });
  return new Promise<Server>(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}
