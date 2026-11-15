// A small expression language for `type: api` cards: `mem / maxmem`, `pct > 0.8 and not contains(id, 'node/')`. Read by
// hand into a tree and walked, never handed to eval or Function, so a config can do arithmetic and filtering and nothing
// else. Paths read only the data's own properties, the same rule as api.ts's `pick`; there are no assignments, no loops
// and no way to call anything but the functions below, and the length and nesting are capped, so every expression is
// cheap to read and to run.
//
//   literals     42  1.5  'text'  "text"  true  false  null
//   paths        name  a.b[0].c  a['odd key']  $ (the whole thing)
//   arithmetic   + - * / %   (+ joins text when either side is text)
//   comparison   == != < <= > >=
//   logic        and or not
//   functions    len lower upper contains min max round abs num hours days

export const MAX_LENGTH = 500, MAX_DEPTH = 24;
const BANNED = new Set(['__proto__', 'constructor', 'prototype']);

type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'path'; steps: (string | number)[] }
  | { k: 'un'; op: '-' | 'not'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };
type Tok = { t: 'num' | 'str' | 'name' | 'op'; v: string; at: number };

const fail = (msg: string, at?: number): never => { throw new Error(at == null ? msg : `${msg} (at character ${at + 1})`); };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const at = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      if (/[eE]/.test(src[i] ?? '') && /[-+0-9]/.test(src[i + 1] ?? '')) { i += 2; while (/[0-9]/.test(src[i] ?? '')) i++; }
      const v = src.slice(at, i);
      if (!Number.isFinite(Number(v))) fail(`"${v}" isn't a number`, at);
      out.push({ t: 'num', v, at }); continue;
    }
    if (c === "'" || c === '"') {
      let v = ''; i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\' && i + 1 < src.length) i++; v += src[i++]; }
      if (src[i] !== c) fail('a quote is never closed', at);
      i++; out.push({ t: 'str', v, at }); continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
      out.push({ t: 'name', v: src.slice(at, i), at }); continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>='].includes(two)) { out.push({ t: 'op', v: two, at }); i += 2; continue; }
    if ('+-*/%<>()[].,'.includes(c)) { out.push({ t: 'op', v: c, at }); i++; continue; }
    if (c === '=') fail('"=" compares as "=="', at);
    if (c === '&' || c === '|') fail(`write "${c === '&' ? 'and' : 'or'}" instead of "${c}"`, at);
    fail(`"${c}" isn't part of an expression`, at);
  }
  return out;
}

/** Read an expression into a tree, or say plainly what's wrong with it. */
export function parse(src: string): Node {
  if (typeof src !== 'string' || !src.trim()) fail('the expression is empty');
  if (src.length > MAX_LENGTH) fail(`the expression is ${src.length} characters long; ${MAX_LENGTH} at most`);
  const toks = tokens(src);
  let p = 0, depth = 0;
  const peek = () => toks[p], end = () => p >= toks.length;
  const is = (t: Tok['t'], v?: string) => !end() && toks[p].t === t && (v == null || toks[p].v === v);
  const word = (v: string) => is('name', v);
  const expect = (v: string) => { if (!is('op', v)) fail(end() ? `"${v}" is missing at the end` : `expected "${v}" but found "${peek().v}"`, end() ? undefined : peek().at); p++; };
  const deeper = <T>(f: () => T): T => { if (++depth > MAX_DEPTH) fail(`the expression nests more than ${MAX_DEPTH} deep`); try { return f(); } finally { depth--; } };

  const or = (): Node => { let a = and(); while (word('or')) { p++; a = { k: 'bin', op: 'or', a, b: and() }; } return a; };
  const and = (): Node => { let a = not(); while (word('and')) { p++; a = { k: 'bin', op: 'and', a, b: not() }; } return a; };
  const not = (): Node => word('not') ? (p++, deeper(() => ({ k: 'un', op: 'not', a: not() }) as Node)) : cmp();
  const cmp = (): Node => {
    const a = add();
    if (is('op') && ['==', '!=', '<', '<=', '>', '>='].includes(peek().v)) { const op = toks[p++].v; const b = add(); return { k: 'bin', op, a, b }; }
    return a;
  };
  const add = (): Node => { let a = mul(); while (is('op', '+') || is('op', '-')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: mul() }; } return a; };
  const mul = (): Node => { let a = unary(); while (is('op', '*') || is('op', '/') || is('op', '%')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: unary() }; } return a; };
  const unary = (): Node => is('op', '-') ? (p++, deeper(() => ({ k: 'un', op: '-', a: unary() }) as Node)) : primary();
  const key = (name: string, at: number) => { if (BANNED.has(name)) fail(`"${name}" can't be read`, at); return name; };
  const primary = (): Node => {
    if (end()) fail('the expression stops too soon');
    const t = toks[p++];
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'op' && t.v === '(') return deeper(() => { const e = or(); expect(')'); return e; });
    if (t.t !== 'name') return fail(`"${t.v}" can't start a value`, t.at);
    if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
    if (t.v === 'null') return { k: 'lit', v: null };
    if (['and', 'or', 'not'].includes(t.v)) fail(`"${t.v}" needs something before it`, t.at);
    if (is('op', '(')) {
      if (!Object.hasOwn(FUNCTIONS, t.v)) fail(`there's no function "${t.v}" (there are: ${Object.keys(FUNCTIONS).join(', ')})`, t.at);
      p++;
      return deeper(() => {
        const args: Node[] = [];
        if (!is('op', ')')) { do args.push(or()); while (is('op', ',') && ++p); }
        expect(')');
        const [lo, hi] = FUNCTIONS[t.v].arity;
        if (args.length < lo || args.length > hi) fail(`${t.v}() takes ${lo === hi ? lo : `${lo} to ${hi === Infinity ? 'any number of' : hi}`} value${hi === 1 ? '' : 's'}, not ${args.length}`, t.at);
        return { k: 'call', name: t.v, args };
      });
    }
    const steps: (string | number)[] = t.v === '$' ? [] : [key(t.v, t.at)];
    for (;;) {
      if (is('op', '.')) {
        p++;
        if (!is('name')) fail('a name should follow "."', end() ? undefined : peek().at);
        const n = toks[p++]; steps.push(key(n.v, n.at));
      } else if (is('op', '[')) {
        p++;
        const n = peek();
        if (!n || (n.t !== 'num' && n.t !== 'str')) fail('"[" takes a number or a quoted name', n?.at);
        p++;
        if (n.t === 'num' && !/^\d+$/.test(n.v)) fail(`"${n.v}" isn't a position in a list`, n.at);
        steps.push(n.t === 'num' ? Number(n.v) : key(n.v, n.at));
        expect(']');
      } else break;
    }
    return { k: 'path', steps };
  };

  const tree = or();
  if (!end()) fail(`"${peek().v}" is out of place`, peek().at);
  return tree;
}

// a timestamp: ISO text, or seconds or milliseconds since 1970 (as api.ts reads them)
const when = (v: unknown) => +new Date(typeof v === 'number' && v < 1e11 ? v * 1000 : v as string);
const since = (v: unknown, unit: number) => { const t = when(v); return v == null || v === '' || Number.isNaN(t) ? null : (Date.now() - t) / unit; };
const num = (v: unknown) => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
// the number a card's text starts with: "42%", "1,024", "51°C" and "1.5 GB" are 42, 1024, 51 and 1.5 (linear, no backtracking)
const lead = (s: string) => { const m = /^[-+]?(?:\d[\d,]*)?(?:\.\d+)?/.exec(s.trim()); return m && m[0] && /\d/.test(m[0]) ? num(m[0].replace(/,/g, '')) : null; };

const FUNCTIONS: Record<string, { arity: [number, number]; run: (...a: unknown[]) => unknown }> = {
  len: { arity: [1, 1], run: v => Array.isArray(v) || typeof v === 'string' ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0 },
  lower: { arity: [1, 1], run: v => v == null ? null : String(v).toLowerCase() },
  upper: { arity: [1, 1], run: v => v == null ? null : String(v).toUpperCase() },
  contains: { arity: [2, 2], run: (h, n) => Array.isArray(h) ? h.some(x => x === n) : h == null || n == null ? false : String(h).toLowerCase().includes(String(n).toLowerCase()) },
  min: { arity: [1, Infinity], run: (...a) => { const l = a.flat().map(num).filter((n): n is number => n != null); return l.length ? Math.min(...l) : null; } },
  max: { arity: [1, Infinity], run: (...a) => { const l = a.flat().map(num).filter((n): n is number => n != null); return l.length ? Math.max(...l) : null; } },
  round: { arity: [1, 2], run: (v, d) => { const n = num(v), k = Math.max(0, Math.min(10, Math.trunc(num(d) ?? 0))); return n == null ? null : Number(n.toFixed(k)); } },
  abs: { arity: [1, 1], run: v => { const n = num(v); return n == null ? null : Math.abs(n); } },
  // a number out of text a card already wrote: "42%" or "1,024" is 42 or 1024
  num: { arity: [1, 1], run: v => typeof v === 'number' ? v : typeof v === 'string' ? lead(v) : null },
  hours: { arity: [1, 1], run: v => since(v, 3_600_000) },
  days: { arity: [1, 1], run: v => since(v, 86_400_000) },
};

const truthy = (v: unknown) => !(v == null || v === false || v === 0 || v === '' || Number.isNaN(v));
function compare(op: string, a: unknown, b: unknown): boolean {
  // a number and a number written as text compare as numbers; anything else compares as it is
  const na = typeof a === 'number' ? a : typeof a === 'string' && typeof b === 'number' ? num(a) : null;
  const nb = typeof b === 'number' ? b : typeof b === 'string' && typeof a === 'number' ? num(b) : null;
  const [x, y] = na != null && nb != null ? [na, nb] : [a ?? null, b ?? null];
  if (op === '==') return x === y;
  if (op === '!=') return x !== y;
  if (x == null || y == null) return false;
  if (typeof x !== typeof y || (typeof x !== 'number' && typeof x !== 'string')) return false;
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

function run(n: Node, data: unknown): unknown {
  switch (n.k) {
    case 'lit': return n.v;
    case 'path': {
      let v: any = data;
      for (const s of n.steps) { if (v == null || typeof v !== 'object' || !Object.hasOwn(v, s)) return undefined; v = v[s]; }
      return v;
    }
    case 'un': { const a = run(n.a, data); return n.op === 'not' ? !truthy(a) : (x => x == null ? null : -x)(num(a)); }
    case 'call': return FUNCTIONS[n.name].run(...n.args.map(a => run(a, data)));
    case 'bin': {
      if (n.op === 'and') return truthy(run(n.a, data)) && truthy(run(n.b, data));
      if (n.op === 'or') return truthy(run(n.a, data)) || truthy(run(n.b, data));
      const a = run(n.a, data), b = run(n.b, data);
      if (['==', '!=', '<', '<=', '>', '>='].includes(n.op)) return compare(n.op, a, b);
      if (n.op === '+' && (typeof a === 'string' || typeof b === 'string')) return `${a ?? ''}${b ?? ''}`;
      const x = num(a), y = num(b);
      // a missing number leaves the answer missing (the card shows –) rather than becoming 0
      if (x == null || y == null) return null;
      const r = n.op === '+' ? x + y : n.op === '-' ? x - y : n.op === '*' ? x * y : n.op === '/' ? x / y : x % y;
      return Number.isFinite(r) ? r : null;
    }
  }
}

const seen = new Map<string, Node>();
/** Read once, then kept: a card's expressions run on every refresh. */
export function compile(src: string) {
  let tree = seen.get(src);
  if (!tree) { tree = parse(src); seen.set(src, tree); if (seen.size > 500) seen.delete(seen.keys().next().value!); }
  return (data: unknown) => run(tree, data);
}
export const evaluate = (src: string, data: unknown) => compile(src)(data);
export const isTrue = truthy;
