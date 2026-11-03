// Just enough XML for feeds (RSS, Atom, YouTube): find elements, read text and attributes, decode entities. Not a
// general parser; it reads well-formed feeds and shrugs at anything odd.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const uncdata = (s: string) => {
  let out = '', at = 0;
  for (;;) {
    const open = s.indexOf('<![CDATA[', at), close = open < 0 ? -1 : s.indexOf(']]>', open + 9);
    if (close < 0) return out + s.slice(at);
    out += s.slice(at, open) + s.slice(open + 9, close); at = close + 3;
  }
};
/** Tags out, by walking the text: a regex here goes quadratic on a feed that's nothing but `<`, and stalls the whole server. */
const untag = (s: string) => {
  let out = '', at = 0;
  for (;;) {
    const open = s.indexOf('<', at), close = open < 0 ? -1 : s.indexOf('>', open + 2);
    if (close < 0) return out + s.slice(at);
    out += `${s.slice(at, open)} `; at = close + 1;
  }
};
export const decode = (s: string) => uncdata(s)
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(Number(e[1] === 'x' ? `0${e.slice(1)}` : e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

/** Text without tags, whitespace tidied: a summary you can show. */
export const text = (html: string) => untag(decode(html)).replace(/\s+/g, ' ').trim();

export interface El { tag: string; attrs: Record<string, string>; inner: string }

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], decode(m[2] ?? m[3] ?? '')]));

const EDGE = new Set([' ', '\t', '\n', '\r', '/', '>']);
const seek = (xml: string, mark: string, from: number) => {
  for (let i = xml.indexOf(mark, from); i >= 0; i = xml.indexOf(mark, i + 1)) if (EDGE.has(xml[i + mark.length])) return i;
  return -1;
};
/** Each opening and closing `tag`, in order, by walking the text once: feeds are written by strangers, and a regex over
 *  one can be made to take minutes while the whole server waits. */
function* tags(xml: string, tag: string) {
  let at = 0, open = -2, close = -2;
  for (;;) {
    if (open !== -1 && open < at) open = seek(xml, `<${tag}`, at);
    if (close !== -1 && close < at) close = seek(xml, `</${tag}`, at);
    if (open < 0 && close < 0) return;
    const closing = open < 0 || (close >= 0 && close < open), i = closing ? close : open, gt = xml.indexOf('>', i);
    if (gt < 0) return;
    const self = !closing && xml[gt - 1] === '/';
    yield { i, closing, self, head: closing ? '' : xml.slice(i + tag.length + 1, Math.min(self ? gt - 1 : gt, i + 8192)), end: gt + 1 };
    at = gt + 1;
  }
}

/** Every `<tag …>…</tag>` (or `<tag …/>`) directly inside `xml`, in order. Nested same-named tags are skipped over. */
export function elements(xml: string, tag: string): El[] {
  const out: El[] = [];
  let depth = 0, first: { head: string; end: number } | undefined;
  for (const t of tags(xml, tag)) {
    if (!depth) {
      if (t.closing) continue;
      if (t.self) out.push({ tag, attrs: attrs(t.head), inner: '' });
      else { depth = 1; first = t; }
    } else if (t.closing) { if (!--depth) out.push({ tag, attrs: attrs(first!.head), inner: xml.slice(first!.end, t.i) }); }
    else if (!t.self) depth++;
  }
  return out;
}

/** The first child's text, decoded, or an attribute of it (`attr`), or undefined. */
export function child(xml: string, tag: string, attr?: string): string | undefined {
  const el = elements(xml, tag)[0];
  if (!el) return undefined;
  return attr ? el.attrs[attr] : decode(el.inner).trim();
}
