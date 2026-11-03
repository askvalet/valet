// OpenID Connect sign-in (Authelia, Authentik, Keycloak, Pocket ID, Zitadel, Google…): the authorization-code flow
// with PKCE, the ID token checked against the provider's keys, and then Valet's own session cookie as with local
// accounts. No library: it's discovery, one redirect, one token request and one signature check.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySig } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from './config.ts';

export interface OidcConfig { issuer: string; clientId: string; clientSecret: string; claim: string; scope: string; allow: string[]; redirectUrl?: string }

interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }
const b64 = (b: Buffer) => b.toString('base64url');
const json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());

/** Only ever back into this page: browsers read `/\\x` and a tab or newline in a path their own way, so it's judged as they would. */
export const backHere = (to: unknown) => {
  if (typeof to !== 'string' || !to.startsWith('/') || /[\\\t\r\n]/.test(to)) return '/';
  try { return new URL(to, 'http://valet.invalid').origin === 'http://valet.invalid' ? to : '/'; } catch { return '/'; }
};
/** An address only counts once the provider says it checked it; otherwise anyone there could just type yours. */
export const allowed = (list: string[], name: string, claims: Record<string, unknown>) => !list.length || list.some(a => a.toLowerCase() === name.toLowerCase()
  || (claims.email_verified === true && a.toLowerCase() === String(claims.email ?? '').toLowerCase()));

export function setupOidc(app: Hono, config: Config, sign: (body: string) => string, startSession: (c: Context, name: string) => void) {
  const o = config.auth.oidc as OidcConfig;
  const secure = config.auth.secureCookie, trusted = new Set(config.auth.proxy.trusted);
  let discovery: Promise<Discovery> | undefined, jwks: { at: number; keys: any[] } | undefined;
  const discover = () => (discovery ??= fetch(`${o.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })
    .then(r => { if (!r.ok) throw new Error(`discovery answered ${r.status}`); return r.json() as Promise<Discovery>; })
    .catch(e => { discovery = undefined; throw e; }));
  const keys = async (fresh = false) => {
    if (!jwks || fresh || Date.now() - jwks.at > 3_600_000) jwks = { at: Date.now(), keys: ((await (await fetch((await discover()).jwks_uri, { signal: AbortSignal.timeout(10_000) })).json()) as any).keys ?? [] };
    return jwks.keys;
  };

  // where the provider should send the person back: configured, or this page's address as the (trusted) proxy or the
  // request says
  const callback = (c: Context) => {
    if (o.redirectUrl) return o.redirectUrl;
    const viaProxy = trusted.has((c.env as any)?.incoming?.socket?.remoteAddress?.replace(/^::ffff:/, '') ?? '');
    const host = (viaProxy && c.req.header('x-forwarded-host')) || c.req.header('host');
    const proto = (viaProxy && c.req.header('x-forwarded-proto')) || (secure ? 'https' : 'http');
    return `${proto}://${host}/api/auth/oidc/callback`;
  };

  // the flow's state travels in a short-lived signed cookie, so nothing is kept on the server
  app.get('/api/auth/oidc/start', async c => {
    let d: Discovery;
    try { d = await discover(); } catch (e) { return c.text(`Can't reach the sign-in provider: ${(e as Error).message}`, 502); }
    const state = b64(randomBytes(16)), nonce = b64(randomBytes(16)), verifier = b64(randomBytes(32));
    const body = b64(Buffer.from(JSON.stringify({ state, nonce, verifier, exp: Date.now() + 600_000, to: c.req.query('to') ?? '/' })));
    setCookie(c, 'valet_oidc', `${body}.${sign(body)}`, { httpOnly: true, sameSite: 'Lax', secure, path: '/api/auth/oidc', maxAge: 600 });
    const u = new URL(d.authorization_endpoint);
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: o.clientId, redirect_uri: callback(c), scope: o.scope, state, nonce,
      code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' })) u.searchParams.set(k, v);
    return c.redirect(u.toString());
  });

  app.get('/api/auth/oidc/callback', async c => {
    const fail = (why: string, status = 400) => { deleteCookie(c, 'valet_oidc', { path: '/api/auth/oidc' }); return c.text(`Sign-in failed: ${why}`, status as 400); };
    const raw = getCookie(c, 'valet_oidc') ?? '';
    const [body, mac] = raw.split('.');
    if (!body || !mac || mac.length !== 43 || !timingSafeEqual(Buffer.from(mac), Buffer.from(sign(body)))) return fail('no sign-in in progress (start again)');
    const flow = json(body);
    if (Date.now() > flow.exp) return fail('that took too long; start again');
    if (c.req.query('error')) return fail(`${c.req.query('error')}: ${c.req.query('error_description') ?? ''}`);
    if (c.req.query('state') !== flow.state) return fail('state mismatch');
    const code = c.req.query('code');
    if (!code) return fail('no code');
    let d: Discovery;
    try { d = await discover(); } catch (e) { return fail(`can't reach the provider: ${(e as Error).message}`, 502); }
    const tok = await fetch(d.token_endpoint, { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${encodeURIComponent(o.clientId)}:${encodeURIComponent(o.clientSecret)}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback(c), code_verifier: flow.verifier, client_id: o.clientId }) }).catch(() => null);
    const t = (await tok?.json().catch(() => null)) as any;
    if (!tok?.ok || !t?.id_token) return fail(`the provider refused the code${t?.error ? ` (${t.error})` : ''}`, 502);
    let claims: Record<string, any>;
    try { claims = await verifyIdToken(t.id_token, d.issuer, o.clientId, keys); }
    catch (e) { return fail(`bad ID token: ${(e as Error).message}`, 401); }
    if (claims.nonce !== flow.nonce) return fail('nonce mismatch', 401);
    const name = String(claims[o.claim] ?? claims.preferred_username ?? claims.email ?? claims.sub ?? '');
    if (!name) return fail(`the token has no "${o.claim}" claim`, 401);
    if (!allowed(o.allow, name, claims)) return fail(`${name} isn't on the allow list`, 403);
    deleteCookie(c, 'valet_oidc', { path: '/api/auth/oidc' });
    startSession(c, name);
    return c.redirect(backHere(flow.to));   // only back into this page
  });
}

/** The ID token's signature (RS256 / ES256 against the provider's JWKS), issuer, audience and expiry. */
export async function verifyIdToken(jwt: string, issuer: string, clientId: string, keys: (fresh?: boolean) => Promise<any[]>) {
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) throw new Error('not a JWT');
  const header = json(h), claims = json(p);
  const alg = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512', ES256: 'sha256', ES384: 'sha384' }[header.alg as string];
  if (!alg) throw new Error(`unsupported alg ${header.alg}`);
  let jwk = (await keys()).find(k => k.kid === header.kid) ?? (header.kid ? (await keys(true)).find(k => k.kid === header.kid) : (await keys())[0]);
  if (!jwk) throw new Error('no matching key');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = verifySig(alg, Buffer.from(`${h}.${p}`), header.alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('signature');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer && claims.iss !== issuer.replace(/\/$/, '')) throw new Error('issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('audience');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new Error('expired');
  return claims;
}
