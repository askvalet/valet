// Just enough XML for feeds (RSS, Atom, YouTube): find elements, read text and attributes, decode entities. Not a
// general parser; it reads well-formed feeds and shrugs at anything odd.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(Number(e[1] === 'x' ? `0${e.slice(1)}` : e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

/** Text without tags, whitespace tidied: a summary you can show. */
export const text = (html: string) => decode(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export interface El { tag: string; attrs: Record<string, string>; inner: string }

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], decode(m[2] ?? m[3] ?? '')]));

/** Every `<tag …>…</tag>` (or `<tag …/>`) directly inside `xml`, in order. Nested same-named tags are skipped over. */
export function elements(xml: string, tag: string): El[] {
  const out: El[] = [];
  const open = new RegExp(`<${tag}(?=[\\s/>])([^>]*?)(/?)>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    if (m[2] === '/') { out.push({ tag, attrs: attrs(m[1]), inner: '' }); continue; }
    // find the matching close, counting nested opens of the same tag
    let depth = 1, i = open.lastIndex;
    const step = new RegExp(`<(/?)${tag}(?=[\\s/>])[^>]*?(/?)>`, 'g');
    step.lastIndex = i;
    let n: RegExpExecArray | null, end = -1;
    while ((n = step.exec(xml))) {
      if (n[1] === '/') depth--; else if (n[2] !== '/') depth++;
      if (!depth) { end = n.index; i = step.lastIndex; break; }
    }
    if (end < 0) break;
    out.push({ tag, attrs: attrs(m[1]), inner: xml.slice(open.lastIndex, end) });
    open.lastIndex = i;
  }
  return out;
}

/** The first child's text, decoded, or an attribute of it (`attr`), or undefined. */
export function child(xml: string, tag: string, attr?: string): string | undefined {
  const el = elements(xml, tag)[0];
  if (!el) return undefined;
  return attr ? el.attrs[attr] : decode(el.inner).trim();
}
