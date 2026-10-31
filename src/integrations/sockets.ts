// The two that don't speak HTTP: a Minecraft server's status ping, and apcupsd's status port for a UPS.
import { connect } from 'node:net';
import { z } from 'zod';
import { defineIntegration, fmt } from '../server/core.ts';

/** Sends bytes and collects the answer until `done` says it's whole or the socket closes. */
function ask(host: string, port: number, send: Buffer, done: (got: Buffer) => boolean) {
  return new Promise<Buffer>((ok, no) => {
    const s = connect({ host, port, timeout: 5000 }), parts: Buffer[] = [];
    const finish = () => { s.destroy(); ok(Buffer.concat(parts)); };
    s.once('connect', () => s.write(send));
    s.on('data', (d: Buffer) => { parts.push(d); if (done(Buffer.concat(parts))) finish(); });
    s.once('end', finish);
    s.once('timeout', () => { s.destroy(); parts.length ? ok(Buffer.concat(parts)) : no(new Error(`${host}:${port} timed out`)); });
    s.once('error', e => no(new Error(`${host}:${port} ${(e as NodeJS.ErrnoException).code ?? e.message}`)));
  });
}
const varint = (n: number) => { const out: number[] = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const readVarint = (b: Buffer, at: number) => { let v = 0, i = 0; for (;;) { if (at + i >= b.length) return null; const x = b[at + i]; v |= (x & 127) << (7 * i++); if (!(x & 128)) return { value: v, at: at + i }; if (i > 5) return null; } };
const packet = (...parts: Buffer[]) => { const body = Buffer.concat(parts); return Buffer.concat([varint(body.length), body]); };

/** Minecraft's Server List Ping: a handshake and a status request, answered with JSON. */
export async function ping(host: string, port: number) {
  const name = Buffer.from(host), hello = packet(varint(0), varint(767), varint(name.length), name, Buffer.from([port >> 8, port & 255]), varint(1));
  const whole = (b: Buffer) => { const n = readVarint(b, 0); return !!n && b.length >= n.at + n.value; };
  const got = await ask(host, port, Buffer.concat([hello, packet(varint(0))]), whole);
  const len = readVarint(got, 0), id = len && readVarint(got, len.at), size = id && readVarint(got, id.at);
  if (!size) throw new Error(`${host}:${port} isn't answering like a Minecraft server`);
  return JSON.parse(got.subarray(size.at, size.at + size.value).toString('utf8'));
}

/** apcupsd's NIS port: ask for `status`, get KEY : VALUE lines ending in an empty record. */
export async function upsStatus(host: string, port: number) {
  const got = await ask(host, port, Buffer.from([0, 6, ...Buffer.from('status')]), b => b.length >= 2 && b.subarray(-2).equals(Buffer.from([0, 0])));
  const out: Record<string, string> = {};
  for (let at = 0; at + 2 <= got.length;) {
    const n = got.readUInt16BE(at); at += 2;
    if (!n) break;
    const m = /^(\w+)\s*:\s*(.*?)\s*$/.exec(got.subarray(at, at + n).toString('latin1'));
    if (m) out[m[1]] = m[2];
    at += n;
  }
  return out;
}

export const minecraft = defineIntegration({
  type: 'minecraft', name: 'Minecraft',
  config: z.object({ host: z.string(), port: z.number().int().default(25565), title: z.string().default('Minecraft') }),
  create: cfg => ({
    widgets: { status: { title: cfg.title, interval: 60_000, async fetch() {
      const s = await ping(cfg.host, cfg.port), on = s.players?.online ?? 0;
      return { type: 'stats', title: cfg.title, icon: 'game', items: [{ label: 'Players', value: `${on} of ${s.players?.max ?? '?'}` }, { label: 'Version', value: s.version?.name ?? '–' }], summary: { label: cfg.title, icon: 'game', value: String(on), sub: 'playing', tone: 'good' } };
    } } },
  }),
});

export const apcups = defineIntegration({
  type: 'apcups', name: 'APC UPS',
  config: z.object({ host: z.string(), port: z.number().int().default(3551), title: z.string().default('UPS') }),
  create(cfg) {
    const read = async () => {
      const u = await upsStatus(cfg.host, cfg.port), n = (k: string) => parseFloat(u[k] ?? ''), charge = n('BCHARGE'), left = n('TIMELEFT');
      return { status: u.STATUS ?? 'unknown', charge, minutes: left, load: n('LOADPCT'), onBattery: /ONBATT/.test(u.STATUS ?? '') };
    };
    return {
      widgets: { status: { title: cfg.title, interval: 30_000, async fetch() {
        const u = await read();
        return { type: 'stats', title: cfg.title, icon: 'bulb', items: [{ label: 'Status', value: u.status, tone: u.onBattery ? 'bad' : 'good' }, { label: 'Charge', value: u.charge, unit: '%', pct: u.charge / 100 }, { label: 'Time left', value: fmt.duration(u.minutes * 60) }, { label: 'Load', value: u.load, unit: '%', pct: u.load / 100 }],
          summary: { label: cfg.title, icon: 'bulb', value: `${u.charge}%`, sub: u.status, tone: u.onBattery ? 'bad' : 'good', pct: u.charge / 100 } };
      } } },
      tools: { ups_status: { label: 'Checked the UPS', access: 'read', input: z.object({}), description: 'UPS status: on mains or battery, charge, minutes left, load.', async run() { return { data: await read() }; } } },
    };
  },
});
