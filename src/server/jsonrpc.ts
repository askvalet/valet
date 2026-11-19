// JSON-RPC 2.0 over a WebSocket, for one short conversation: connect, ask, close. RFC 6455 over node:net and node:tls
// rather than Node's own WebSocket, which can't be told to trust one service's self-signed certificate (`insecure`).
// Text frames only, no extensions offered, so nothing arrives compressed. What a server sends is another program's
// bytes: a masked or oversized frame, or a reply that isn't JSON, ends the conversation. Everything, the connection
// included, happens within `timeout`, and the socket is gone when the promise settles, however it settles.
import { createHash, randomBytes } from 'node:crypto';
import { connect as tcp, isIP } from 'node:net';
import { connect as tls } from 'node:tls';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', MAX_HEAD = 16_384;
export const MAX_MESSAGE = 16 * 2 ** 20;

/** It never became a WebSocket: refused, timed out, a certificate not trusted, or an HTTP answer that isn't 101
 *  (`status`, which says something answered that doesn't speak WebSocket there). */
export class Unreachable extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.name = 'Unreachable'; this.status = status; }
}
/** The server's answer to one call was an error. */
export class RpcError extends Error {
  code: number; data?: any;
  constructor(message: string, code: number, data?: unknown) { super(message); this.name = 'RpcError'; this.code = code; this.data = data; }
}

/** One frame; a client's are masked, a server's never are. */
export function frame(opcode: number, payload: Buffer, mask = true) {
  const n = payload.length, len = n < 126 ? 1 : n < 65_536 ? 3 : 9, head = Buffer.alloc(1 + len + (mask ? 4 : 0));
  head[0] = 0x80 | opcode;
  if (n < 126) head[1] = n; else if (n < 65_536) { head[1] = 126; head.writeUInt16BE(n, 2); } else { head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  if (!mask) return Buffer.concat([head, payload]);
  head[1] |= 0x80;
  const key = randomBytes(4), body = Buffer.from(payload);
  key.copy(head, 1 + len);
  for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
  return Buffer.concat([head, body]);
}

/** Whole messages out of a stream of frames: fragments joined, control frames passed through as they come. */
export class Frames {
  private buf: Buffer = Buffer.alloc(0); private parts: Buffer[] = []; private size = 0; private kind = 0;
  private max: number; private masked: boolean;
  /** `masked`: the frames are a client's, as a test's server reads them */
  constructor(max = MAX_MESSAGE, masked = false) { this.max = max; this.masked = masked; }
  push(chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: { opcode: number; data: Buffer }[] = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = !!(b[0] & 0x80), opcode = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      if (masked !== this.masked) throw new Error(masked ? 'the server masked a frame' : 'an unmasked frame');
      let n = b[1] & 0x7f, at = 2;
      if (n === 126) { if (b.length < 4) break; n = b.readUInt16BE(2); at = 4; }
      else if (n === 127) { if (b.length < 10) break; const big = b.readBigUInt64BE(2); if (big > BigInt(this.max)) throw new Error('a message too large'); n = Number(big); at = 10; }
      if (n > this.max) throw new Error('a message too large');
      const key = masked ? b.subarray(at, at + 4) : undefined;
      if (masked) at += 4;
      if (b.length < at + n) break;
      const data = Buffer.from(b.subarray(at, at + n));
      if (key) for (let i = 0; i < data.length; i++) data[i] ^= key[i & 3];
      this.buf = b.subarray(at + n);
      if (opcode >= 8) { if (!fin || n > 125) throw new Error('a bad control frame'); out.push({ opcode, data }); continue; }
      if (opcode !== 0) { if (this.kind) throw new Error('a message inside a message'); this.kind = opcode; }
      else if (!this.kind) throw new Error('a continuation of nothing');
      this.size += n;
      if (this.size > this.max) throw new Error('a message too large');
      this.parts.push(data);
      if (fin) { out.push({ opcode: this.kind, data: Buffer.concat(this.parts) }); this.parts = []; this.size = 0; this.kind = 0; }
    }
    return out;
  }
}

const UNTRUSTED = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const why = (e: NodeJS.ErrnoException) => UNTRUSTED.has(e.code ?? '') ? 'its certificate isn\'t trusted (self-signed? `insecure: true` accepts it)' : e.code ?? e.message;

export interface Conversation { call<T = any>(method: string, params?: unknown[]): Promise<T> }

/** Open `url` (ws: or wss:), let `talk` make its calls (in parallel if it likes: each has its own id), then close. */
export function jsonrpc<T>(url: string, o: { timeout: number; insecure?: boolean }, talk: (c: Conversation) => Promise<T>): Promise<T> {
  const u = new URL(url), secure = u.protocol === 'wss:';
  if (!secure && u.protocol !== 'ws:') return Promise.reject(new Error(`${url} isn't a ws: or wss: address`));
  const host = u.hostname.replace(/^\[|\]$/g, ''), port = Number(u.port) || (secure ? 443 : 80), where = u.host;
  return new Promise<T>((done, fail) => {
    let open = false, over = false, next = 1;
    const pending = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
    const key = randomBytes(16).toString('base64');
    const sock = secure ? tls({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: !o.insecure, ALPNProtocols: ['http/1.1'] }) : tcp({ host, port });
    const end = (e: Error | undefined, value?: T) => {
      if (over) return;
      over = true; clearTimeout(timer);
      for (const p of pending.values()) p.no(e ?? new Error('the conversation ended'));
      pending.clear();
      if (open && !sock.destroyed) { sock.end(frame(8, Buffer.from([0x03, 0xe8]))); sock.setTimeout(1000, () => sock.destroy()); } else sock.destroy();
      if (e) fail(e); else done(value as T);
    };
    const timer = setTimeout(() => end(open ? new Error(`${where} stopped answering`) : new Unreachable(`${where} timed out`)), o.timeout);
    sock.on('error', (e: NodeJS.ErrnoException) => end(open ? new Error(`${where}: ${e.code ?? e.message}`) : new Unreachable(`${where}: ${why(e)}`)));
    sock.on('close', () => end(open ? new Error(`${where} closed the connection`) : new Unreachable(`${where} closed the connection`)));
    sock.once(secure ? 'secureConnect' : 'connect', () => sock.write([`GET ${u.pathname}${u.search} HTTP/1.1`, `Host: ${where}`, 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''].join('\r\n')));

    const frames = new Frames();
    const conversation: Conversation = {
      call: (method, params = []) => new Promise((ok, no) => {
        if (over) return no(new Error('the conversation ended'));
        const id = next++;
        pending.set(id, { ok, no });
        sock.write(frame(1, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))));
      }),
    };
    const hear = (opcode: number, data: Buffer) => {
      if (opcode === 8) return end(new Error(`${where} closed the conversation`));
      if (opcode === 9) return void sock.write(frame(10, data));
      if (opcode !== 1) return;
      let m: any;
      try { m = JSON.parse(data.toString('utf8')); } catch { return end(new Error(`${where} sent something that isn't JSON`)); }
      const p = typeof m?.id === 'number' ? pending.get(m.id) : undefined;
      if (!p) return;                                       // a notification, or an answer nobody waits for
      pending.delete(m.id);
      if (m.error) p.no(new RpcError(String(m.error.message ?? 'error'), Number(m.error.code) || 0, m.error.data));
      else p.ok(m.result);
    };
    let head = Buffer.alloc(0);
    sock.on('data', (chunk: Buffer) => {
      if (over) return;
      if (!open) {
        head = Buffer.concat([head, chunk]);
        const at = head.indexOf('\r\n\r\n');
        if (at < 0) { if (head.length > MAX_HEAD) end(new Unreachable(`${where} sent a header too large`)); return; }
        const lines = head.subarray(0, at).toString('latin1').split('\r\n'), status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(lines[0])?.[1]);
        if (status !== 101) return end(new Unreachable(`${where} answered ${status || 'something that isn\'t HTTP'}`, status || undefined));
        const accept = lines.find(l => /^sec-websocket-accept:/i.test(l))?.split(':')[1]?.trim();
        if (accept !== createHash('sha1').update(key + GUID).digest('base64')) return end(new Unreachable(`${where} didn't accept the WebSocket properly`));
        open = true;
        chunk = head.subarray(at + 4);
        Promise.resolve().then(() => talk(conversation)).then(v => end(undefined, v), e => end(e));
      }
      try { for (const f of frames.push(chunk)) hear(f.opcode, f.data); } catch (e) { end(new Error(`${where} sent ${(e as Error).message}`)); }
    });
  });
}
