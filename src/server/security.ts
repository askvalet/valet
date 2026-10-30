// Security in one place: what the page may load, what never leaves the server, and when Atrium may change things.
import type { MiddlewareHandler } from 'hono';
import type { Config } from './config.ts';

/** Atrium may press buttons and use tools that add or change things only when someone signed in, or the config says
 *  the network itself is trusted. Otherwise it's a read-only dashboard. */
export const canAct = (config: Config) => config.auth.mode !== 'none' || config.auth.trustNetwork;

/** Every secret Atrium knows (each ${VAR} the config used), so none can slip out in an error message or a tool result. */
export function redactor(secrets: string[]) {
  const list = [...new Set(secrets.filter(s => s && s.length >= 6))].sort((a, b) => b.length - a.length);
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
};
