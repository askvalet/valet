// Security in one place: what the page may load, what never leaves the server, and when Atrium may change things.
import type { MiddlewareHandler } from 'hono';
import type { Config } from './config.ts';

/** Atrium may press buttons and use tools that add or change things only when someone signed in, or the config says
 *  the network itself is trusted. Otherwise it's a read-only dashboard. */
export const canAct = (config: Config) => config.auth.mode !== 'none' || config.auth.trustNetwork;

/** Every secret Atrium knows (each ${VAR} the config used), so none can slip out in an error message or a tool result. */
export function redactor(secrets: string[]) {
  const list = [...new Set(secrets.filter(s => s && s.length >= 4))].sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = list.length ? new RegExp(list.map(esc).join('|'), 'g') : null;
  return (text: string) => (re ? text.replace(re, '•••') : text);
}

/** Headers for every response: only Atrium's own scripts run, nothing frames it, referrers stay home. */
export const headers: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",   // React sets inline style attributes
    "img-src 'self' data: blob: https:", "font-src 'self' data:", "connect-src 'self'", "media-src 'self' blob:",
    "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '));
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  // live data and anything behind sign-in: never kept by the browser or a proxy cache
  if (c.req.path.startsWith('/api/') && !c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
};

/** Answer only to names Atrium is meant to have. A malicious site can point its own domain at your Atrium's IP (DNS
 *  rebinding) and script your browser against it; refusing unknown Host headers closes that. IP addresses and
 *  localhost are always fine: an attacker's page can't use those names. */
export function hostGuard(allowed: string[] | (() => string[])): MiddlewareHandler {
  // the list may come from a config that reloads, so it's read per request (it's a few names)
  const list = () => typeof allowed === 'function' ? allowed() : allowed;
  const ok = (raw: string | undefined) => {
    if (!raw) return true;
    const exact = new Set(list().filter(h => !h.startsWith('*.')).map(h => h.toLowerCase()));
    const wild = list().filter(h => h.startsWith('*.')).map(h => h.slice(1).toLowerCase());
    const host = raw.toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.includes(':')   // IPv4, IPv6
      || exact.has(host) || wild.some(w => host.endsWith(w));
  };
  return async (c, next) => {
    // both must pass: a page in the browser can set X-Forwarded-Host on its own same-origin requests, so it may only
    // narrow what Host allows, never vouch for it
    const host = [c.req.header('host'), c.req.header('x-forwarded-host')].find(h => !ok(h));
    if (host !== undefined) return c.text(`Atrium doesn't answer to "${host}". If that's your address for it, add it to allowedHosts in config.yaml.`, 421);
    return next();
  };
}
