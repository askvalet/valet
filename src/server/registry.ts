// What's the newest version of an image? Every registry speaks the same API, and Docker Hub, GHCR, lscr and Quay all hand
// out an anonymous token through the same challenge, so one path covers them. No digests: this reads tag names only, which
// is what a pinned compose file needs. A floating tag (latest) can't be compared this way, and says so.

export interface Ref { registry: string; repo: string; tag: string }
export function parseImage(image: string): Ref | null {
  if (!image || image.startsWith('sha256:')) return null;
  const at = image.split('@')[0], colon = at.lastIndexOf(':'), hasTag = colon > at.lastIndexOf('/');
  const name = hasTag ? at.slice(0, colon) : at, tag = hasTag ? at.slice(colon + 1) : 'latest';
  const parts = name.split('/'), first = parts[0];
  if (/[.:]/.test(first) || first === 'localhost') return { registry: first === 'docker.io' ? 'registry-1.docker.io' : first, repo: parts.slice(1).join('/'), tag };
  return { registry: 'registry-1.docker.io', repo: parts.length === 1 ? `library/${name}` : name, tag };
}

interface Version { prefix: string; nums: number[]; suffix: string }
/** "v1.2.3-alpine" → parts. A commit hash on the end ("2026.10.25-54ca1d9cf") isn't part of the version's identity. */
export function parseVersion(tag: string): Version | null {
  const m = tag.match(/^([a-zA-Z]*?)(\d+(?:\.\d+)*)(.*)$/);
  if (!m) return null;
  return { prefix: m[1], nums: m[2].split('.').map(Number), suffix: m[3].replace(/-[0-9a-f]{7,40}$/, '') };
}
const UNSTABLE = /(^|[-._])(rc|beta|alpha|dev|nightly|edge|canary|pre|test|snapshot)/i;
const newer = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

/** The newest tag of the same shape: same prefix, same parts, same flavour (-alpine stays -alpine), stable only. */
export function newest(current: string, tags: string[]) {
  const me = parseVersion(current);
  if (!me) return null;
  let best: { tag: string; nums: number[] } | null = null;
  for (const t of tags) {
    if (t === current || UNSTABLE.test(t)) continue;
    const v = parseVersion(t);
    if (!v || v.prefix !== me.prefix || v.suffix !== me.suffix || v.nums.length !== me.nums.length) continue;
    if (newer(v.nums, best?.nums ?? me.nums)) best = { tag: t, nums: v.nums };
  }
  return best && { tag: best.tag, major: best.nums[0] !== me.nums[0] };
}

type Get = (url: string, headers?: Record<string, string>) => Promise<Response>;
/** Every tag of an image, or null if the registry won't say. */
export async function listTags(ref: Ref, get: Get) {
  const url = `https://${ref.registry}/v2/${ref.repo}/tags/list?n=2000`;
  let r = await get(url);
  if (r.status === 401) {
    const c = r.headers.get('www-authenticate') ?? '', part = (k: string) => c.match(new RegExp(`${k}="([^"]+)"`))?.[1];
    const realm = part('realm');
    if (!realm) return null;
    const q = new URLSearchParams({ service: part('service') ?? '', scope: part('scope') ?? `repository:${ref.repo}:pull` });
    const t = await get(`${realm}?${q}`);
    if (!t.ok) return null;
    const j = await t.json() as { token?: string; access_token?: string };
    r = await get(url, { Authorization: `Bearer ${j.token ?? j.access_token}` });
  }
  if (!r.ok) return null;
  return ((await r.json() as { tags?: string[] }).tags ?? []);
}

/** The lines of release notes someone updating needs to see. */
export const warnings = (notes: string) => notes.split('\n').map(l => l.replace(/\*\*|`/g, '').replace(/^[\s#*>-]+/, '').trim())
  .filter(l => /breaking|migrat|action required|manual step|must (update|change|run)|deprecat|removed support|no longer supported/i.test(l) && l.length < 240).slice(0, 5);
