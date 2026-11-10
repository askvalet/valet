// A small MQTT 3.1.1 publisher over node:net and node:tls, so events can reach a broker with no dependency. It is a
// client that only speaks: it never subscribes, and nothing a broker sends is acted on beyond the three answers a
// publisher is owed (CONNACK, PUBACK, PINGRESP). What arrives is parsed as another program's bytes: a bad length or a
// packet bigger than those answers drops the connection. While there's no connection, messages wait in a bounded queue
// that lets go of the oldest, and it reconnects with a growing pause, saying so once.
import { connect as tcp, isIP, type Socket } from 'node:net';
import { connect as tls } from 'node:tls';

export interface Message { topic: string; payload: string; qos?: 0 | 1; retain?: boolean }
export interface MqttOptions {
  url: string; clientId: string; username?: string; password?: string;
  keepalive?: number;                  // seconds the broker allows between packets; a ping goes out every half of it
  ping?: number;                       // ms between pings, when half the keepalive isn't it (a test's)
  will?: Message;                      // what the broker says for this client if it vanishes
  hello?: Message;                     // sent first on every connection, ahead of what waited (an online status)
  queue?: number;                      // how many messages wait for a connection
  backoff?: [number, number];          // ms before the first reconnect, and the most between two
  log?: (line: string) => void;
  onConnect?: () => void;
}

export const MAX_LENGTH = 268_435_455, MAX_IN = 4096, WINDOW = 32, HIGH_WATER = 2 ** 20, CONNECT_MS = 10_000;
const REFUSED: Record<number, string> = { 1: 'protocol version', 2: 'client id', 3: 'server unavailable', 4: 'bad user name or password', 5: 'not authorised' };

// --- packets --------------------------------------------------------------------------------------------------------

/** The remaining length: seven bits a byte, low bits first, four bytes at most. */
export function varint(n: number) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_LENGTH) throw new RangeError('an MQTT packet holds 268,435,455 bytes at most');
  const out: number[] = [];
  do { const b = n % 128; n = Math.floor(n / 128); out.push(n ? b | 128 : b); } while (n);
  return Buffer.from(out);
}
const str = (s: string) => { const b = Buffer.from(s, 'utf8'), len = Buffer.alloc(2); if (b.length > 65535) throw new RangeError('an MQTT string holds 65,535 bytes at most'); len.writeUInt16BE(b.length); return Buffer.concat([len, b]); };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const packet = (head: number, ...parts: Buffer[]) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([head]), varint(body.length), body]); };

export function connectPacket(o: Pick<MqttOptions, 'clientId' | 'username' | 'password' | 'keepalive' | 'will'>) {
  // a clean session every time: nothing is owed to this client from before
  const flags = 0x02 | (o.will ? 0x04 | (o.will.retain ? 0x20 : 0) : 0) | (o.username != null ? 0x80 : 0) | (o.username != null && o.password != null ? 0x40 : 0);
  return packet(0x10, str('MQTT'), Buffer.from([4, flags]), u16(o.keepalive ?? 60), str(o.clientId),
    ...(o.will ? [str(o.will.topic), str(o.will.payload)] : []), ...(o.username != null ? [str(o.username)] : []), ...(o.username != null && o.password != null ? [str(o.password)] : []));
}
export const publishPacket = (m: Message, id = 0, dup = false) =>
  packet(0x30 | (dup ? 8 : 0) | ((m.qos ?? 0) << 1) | (m.retain ? 1 : 0), str(m.topic), ...(m.qos ? [u16(id)] : []), Buffer.from(m.payload, 'utf8'));
export const PINGREQ = Buffer.from([0xc0, 0]), DISCONNECT = Buffer.from([0xe0, 0]);

/** A topic a message may go to: something, no wildcards, no NUL, within the length a string holds. */
export const publishable = (topic: string) => topic.length > 0 && Buffer.byteLength(topic) <= 65535 && !/[+#\u0000]/.test(topic);

export interface Packet { type: number; flags: number; body: Buffer }
/** Bytes in, whole packets out, however they were split on the way. It throws on a length field past four bytes or a
 *  packet over `max`, so it never holds more than one small packet and a chunk. */
export class Decoder {
  private buf: Buffer = Buffer.alloc(0);
  private max: number;
  constructor(max = MAX_IN) { this.max = max; }
  /** the first byte of what's still arriving, if anything is */
  get head(): number | undefined { return this.buf[0]; }
  push(chunk: Buffer): Packet[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Packet[] = [];
    for (;;) {
      let len = 0, used = 0, byte = 128;
      while (byte & 128) {
        if (used === 4) throw new Error('malformed length');
        if (1 + used >= this.buf.length) return out;   // the rest hasn't arrived
        byte = this.buf[1 + used]; len += (byte & 127) * 128 ** used++;
      }
      if (len > this.max) throw new Error('packet too large');
      const end = 1 + used + len;
      if (this.buf.length < end) return out;
      out.push({ type: this.buf[0] >> 4, flags: this.buf[0] & 15, body: this.buf.subarray(1 + used, end) });
      this.buf = this.buf.subarray(end);
    }
  }
}

// --- the client -----------------------------------------------------------------------------------------------------

type Queued = Message & { dup?: boolean };

export class Mqtt {
  /** how many messages were let go because the queue was full */
  dropped = 0;
  private o: MqttOptions;
  private queue: Queued[] = [];                  // not yet sent, oldest first
  private flying = new Map<number, Queued>();    // QoS 1: sent, not yet acknowledged
  private socket?: Socket;
  private up = false; private stopped = true; private failed = false; private pinged = false;
  private id = 0; private wait: number; private why?: string;
  private retry?: NodeJS.Timeout; private beat?: NodeJS.Timeout;
  constructor(o: MqttOptions) { this.o = o; this.wait = this.pause[0]; }
  private get pause() { return this.o.backoff ?? [1000, 60_000]; }
  private get room() { return this.o.queue ?? 200; }
  get connected() { return this.up; }
  get waiting() { return this.queue.length + this.flying.size; }

  start() { if (this.stopped) { this.stopped = false; this.open(); } }

  /** Queue a message and send it when there's a connection. False if it can't be one (a wildcard topic, too long). */
  publish(m: Message) {
    if (!publishable(m.topic) || Buffer.byteLength(m.topic) + Buffer.byteLength(m.payload) + 4 > MAX_LENGTH) return false;
    this.queue.push(m);
    this.trim();
    this.flush();
    return true;
  }

  /** Say goodbye and close. `last` goes out first if there's a connection to send it on. */
  stop(last?: Message) {
    this.stopped = true;
    clearTimeout(this.retry); clearInterval(this.beat);
    const s = this.socket;
    if (!s) return;
    if (this.up) { if (last && publishable(last.topic)) s.write(publishPacket({ ...last, qos: 0 })); s.end(DISCONNECT); }
    else s.destroy();
    this.up = false;
  }

  private trim() { while (this.queue.length > this.room) { this.queue.shift(); this.dropped++; } }

  private open() {
    const u = new URL(this.o.url), secure = u.protocol === 'mqtts:', host = u.hostname.replace(/^\[|\]$/g, ''), port = Number(u.port) || (secure ? 8883 : 1883);
    const s = secure ? tls({ host, port, servername: isIP(host) ? undefined : host }) : tcp({ host, port });
    const decoder = new Decoder();
    this.socket = s; this.why = undefined;
    s.setNoDelay(true);
    // until the broker has said hello, silence is a failure; after that the pings watch for it
    s.setTimeout(CONNECT_MS, () => s.destroy(new Error('no answer')));
    s.once(secure ? 'secureConnect' : 'connect', () => s.write(connectPacket(this.o)));
    s.on('data', chunk => { try {
      for (const p of decoder.push(chunk as Buffer)) this.got(s, p);
      // the first thing a broker says is CONNACK: anything else is known by its first byte, without waiting for the rest
      if (!this.up && decoder.head !== undefined && decoder.head !== 0x20) throw new Error('not an MQTT broker');
    } catch (e) { s.destroy(e as Error); } });
    s.on('drain', () => this.flush());
    s.on('error', e => { this.why = e.message; });
    s.on('close', () => this.closed(s));
  }

  private got(s: Socket, p: Packet) {
    if (p.type === 2) {   // CONNACK
      if (this.up || p.body.length !== 2) throw new Error('unexpected CONNACK');
      if (p.body[1] !== 0) throw new Error(`the broker refused the connection (${REFUSED[p.body[1]] ?? `code ${p.body[1]}`})`);
      this.up = true; this.pinged = false; this.wait = this.pause[0];
      s.setTimeout(0);
      if (this.failed) this.o.log?.(`mqtt: connected to ${this.where} again`);
      this.failed = false;
      this.beat = setInterval(() => {
        if (this.pinged) return s.destroy(new Error('no answer to a ping'));
        this.pinged = true; s.write(PINGREQ);
      }, this.o.ping ?? (this.o.keepalive ?? 60) * 500);
      this.beat.unref();
      if (this.o.hello) this.queue.unshift(this.o.hello);
      this.o.onConnect?.();
      this.flush();
    } else if (!this.up) throw new Error('a packet before CONNACK');
    else if (p.type === 4 && p.body.length === 2) { this.flying.delete(p.body.readUInt16BE(0)); this.flush(); }   // PUBACK
    else if (p.type === 13) this.pinged = false;   // PINGRESP
    // anything else is ignored: this client asked for nothing, so it is owed nothing
  }

  private get where() { const u = new URL(this.o.url); return u.host; }

  private closed(s: Socket) {
    if (s !== this.socket) return;
    this.socket = undefined; this.up = false;
    clearInterval(this.beat);
    // what wasn't acknowledged goes again, first, marked as a repeat
    this.queue.unshift(...[...this.flying.values()].map(m => ({ ...m, dup: true })));
    this.flying.clear(); this.trim();
    if (this.stopped) return;
    if (!this.failed) this.o.log?.(`mqtt: ${this.where}: ${this.why ?? 'the connection closed'}; trying again until it answers`);
    this.failed = true;
    this.retry = setTimeout(() => this.open(), this.wait);
    this.retry.unref();
    this.wait = Math.min(this.wait * 2, this.pause[1]);
  }

  private flush() {
    const s = this.socket;
    if (!s || !this.up) return;
    while (this.queue.length && s.writableLength < HIGH_WATER) {
      const m = this.queue[0];
      if (m.qos) {
        if (this.flying.size >= WINDOW) return;
        do { this.id = this.id % 65535 + 1; } while (this.flying.has(this.id));
        this.flying.set(this.id, m);
        s.write(publishPacket(m, this.id, m.dup));
      } else s.write(publishPacket(m));
      this.queue.shift();
    }
  }
}
