// The MQTT publisher against a made-up broker on localhost: the bytes it writes, the bytes it survives, what waits while
// there's no connection, and that it only ever speaks. Nothing here sleeps: each step waits for the packet or the
// connection it's about.
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { test } from 'node:test';
import { Decoder, DISCONNECT, MAX_IN, Mqtt, PINGREQ, connectPacket, publishPacket, publishable, varint, type Message, type Packet } from '../src/server/mqtt.ts';

/** resolves once `n` things have arrived */
const arrivals = <T,>() => { const got: T[] = [], waiting: [number, () => void][] = []; return { got, add(x: T) { got.push(x); for (const [n, ok] of waiting) if (got.length >= n) ok(); }, until: (n: number) => new Promise<void>(ok => got.length >= n ? ok() : waiting.push([n, ok])) }; };
const hex = (b: Buffer) => b.toString('hex');
const CONNACK = (code = 0) => Buffer.from([0x20, 2, 0, code]), PUBACK = (id: number) => Buffer.from([0x40, 2, id >> 8, id & 255]), PINGRESP = Buffer.from([0xd0, 0]);
/** a PUBLISH as the broker reads it */
const pub = (p: Packet) => { const n = p.body.readUInt16BE(0), qos = (p.flags >> 1) & 3, id = qos ? p.body.readUInt16BE(2 + n) : 0; return { topic: p.body.subarray(2, 2 + n).toString(), payload: p.body.subarray(2 + n + (qos ? 2 : 0)).toString(), qos, id, retain: !!(p.flags & 1), dup: !!(p.flags & 8) }; };

interface Conn { sock: Socket; packets: ReturnType<typeof arrivals<Packet>>; closed: Promise<void> }
/** A broker that says what it's told to: by default it welcomes, acknowledges and answers pings. */
async function broker(o: { hello?: (c: Conn) => void; ack?: boolean; pong?: boolean } = {}) {
  const conns = arrivals<Conn>();
  const server = createServer(sock => {
    const d = new Decoder(2 ** 20), c: Conn = { sock, packets: arrivals<Packet>(), closed: new Promise(ok => sock.on('close', () => ok())) };
    sock.on('error', () => {});
    sock.on('data', chunk => { for (const p of d.push(chunk as Buffer)) {
      c.packets.add(p);
      if (p.type === 1) (o.hello ?? (x => x.sock.write(CONNACK())))(c);
      if (p.type === 3 && (p.flags >> 1) & 3 && o.ack !== false) sock.write(PUBACK(pub(p).id));
      if (p.type === 12 && o.pong !== false) sock.write(PINGRESP);
    } });
    conns.add(c);
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  return { url: `mqtt://127.0.0.1:${(server.address() as any).port}`, conns, close: () => { for (const c of conns.got) c.sock.destroy(); server.close(); } };
}
const client = (url: string, o: Partial<ConstructorParameters<typeof Mqtt>[0]> = {}) => { const logs = arrivals<string>(), ups = arrivals<number>(); const m = new Mqtt({ url, clientId: 'valet-test', backoff: [2, 10], log: l => logs.add(l), onConnect: () => ups.add(1), ...o }); return { m, logs, ups }; };
/** every packet type a client ever sent on these connections */
const spoke = (conns: Conn[]) => [...new Set(conns.flatMap(c => c.packets.got.map(p => p.type)))].sort((a, b) => a - b);

test('the remaining length: one to four bytes, at each edge, and nothing past the largest packet', () => {
  for (const [n, bytes] of [[0, '00'], [1, '01'], [127, '7f'], [128, '8001'], [16_383, 'ff7f'], [16_384, '808001'], [2_097_151, 'ffff7f'], [2_097_152, '80808001'], [268_435_455, 'ffffff7f']] as const) assert.equal(hex(varint(n)), bytes, String(n));
  for (const bad of [-1, 268_435_456, 1.5, NaN, Infinity]) assert.throws(() => varint(bad), RangeError, String(bad));
  // and back again, through the decoder, for a body on each side of each edge it can hold
  for (const n of [0, 1, 127, 128, 129, 16_383, 16_384, 16_385, 70_000]) {
    const [p] = new Decoder(2 ** 20).push(Buffer.concat([Buffer.from([0x30]), varint(n), Buffer.alloc(n, 7)]));
    assert.equal(p.body.length, n); assert.equal(p.type, 3);
  }
});

test('the packets, byte for byte', () => {
  assert.equal(hex(publishPacket({ topic: 'a/b', payload: 'hi' })), '30070003612f626869');
  assert.equal(hex(publishPacket({ topic: 'a/b', payload: 'hi', qos: 1, retain: true }, 10)), '33090003612f62000a6869');
  assert.equal(hex(publishPacket({ topic: 'a/b', payload: '', qos: 1 }, 0x1234, true)), '3a0700036' + '12f62' + '1234');
  assert.equal(hex(publishPacket({ topic: 't', payload: 'é' })), '3005000174c3a9', 'lengths are bytes, not characters');
  assert.equal(hex(connectPacket({ clientId: 'v' })), '100d00044d5154540402003c000176');
  assert.equal(hex(connectPacket({ clientId: 'v', keepalive: 10, username: 'u', password: 'p' })), '101300044d51545404c2000a000176' + '000175' + '000170');
  assert.equal(hex(connectPacket({ clientId: 'v', username: 'u' })), '101000044d5154540482003c000176' + '000175');
  assert.equal(hex(connectPacket({ clientId: 'v', password: 'p' })), hex(connectPacket({ clientId: 'v' })), 'a password needs a user name');
  assert.equal(hex(connectPacket({ clientId: 'v', will: { topic: 's', payload: 'off', retain: true } })), '101500044d5154540426003c000176' + '000173' + '00036f6666');
  assert.equal(hex(PINGREQ), 'c000'); assert.equal(hex(DISCONNECT), 'e000');
  // a payload at the two-byte edge of the length
  const big = publishPacket({ topic: 't', payload: 'x'.repeat(125) });
  assert.equal(hex(big.subarray(0, 3)), '308001'); assert.equal(big.length, 3 + 128);
  assert.throws(() => publishPacket({ topic: 'x'.repeat(65_536), payload: '' }), RangeError);
  for (const bad of ['', 'a/+/b', 'a/#', '#', 'a\u0000b', 'x'.repeat(65_536)]) assert.equal(publishable(bad), false, JSON.stringify(bad.slice(0, 8)));
  assert.equal(publishable('valet/service/plex'), true);
});

test('what a broker sends is read defensively: split anywhere, and a bad or oversized length is an error, not memory', () => {
  const stream = Buffer.concat([CONNACK(), PUBACK(7), PINGRESP, Buffer.concat([Buffer.from([0x30]), varint(300), Buffer.alloc(300, 1)])]);
  const whole = new Decoder().push(stream);
  assert.deepEqual(whole.map(p => [p.type, p.body.length]), [[2, 2], [4, 2], [13, 0], [3, 300]]);
  // a byte at a time: the same packets, each only once it's all there
  const d = new Decoder(), seen: Packet[] = [];
  for (const byte of stream) seen.push(...d.push(Buffer.from([byte])));
  assert.deepEqual(seen.map(p => [p.type, hex(p.body)]), whole.map(p => [p.type, hex(p.body)]));
  assert.deepEqual(new Decoder().push(Buffer.from([0x40, 2, 0])), [], 'half a packet is no packet');
  assert.deepEqual(new Decoder().push(Buffer.from([0x30])), []);
  assert.deepEqual(new Decoder().push(Buffer.from([0x30, 0x80])), [], 'a length still arriving');
  assert.throws(() => new Decoder().push(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x01])), /malformed length/);
  assert.throws(() => new Decoder().push(Buffer.from([0x30, 0x80, 0x80, 0x80, 0x80])), /malformed length/);
  assert.throws(() => new Decoder().push(Buffer.concat([Buffer.from([0x30]), varint(MAX_IN + 1)])), /too large/, 'refused by its header, before its body arrives');
  assert.throws(() => new Decoder().push(Buffer.from([0x30, 0xff, 0xff, 0xff, 0x7f])), /too large/);
  // a flood of bytes that never forms a length is cut at five
  const flood = new Decoder();
  assert.throws(() => { for (let i = 0; i < 100; i++) flood.push(Buffer.from([0xff])); }, /malformed length/);
});

test('connecting: who it says it is, then what was waiting, in order, and QoS 1 until it\'s acknowledged', async () => {
  const b = await broker(), { m, ups } = client(b.url, { username: 'valet', password: 'pw', keepalive: 30, will: { topic: 'valet/status', payload: 'offline', retain: true } });
  assert.equal(m.publish({ topic: 'valet/a', payload: '1' }), true);
  assert.equal(m.publish({ topic: 'valet/b', payload: '2', qos: 1, retain: true }), true);
  assert.equal(m.publish({ topic: 'valet/+', payload: 'x' }), false);
  assert.equal(m.waiting, 2, 'nothing connects until it is started');
  assert.equal(b.conns.got.length, 0);
  m.start(); m.start();
  await ups.until(1);
  const [c] = b.conns.got;
  await c.packets.until(3);
  assert.equal(hex(Buffer.concat([Buffer.from([0x10]), varint(c.packets.got[0].body.length), c.packets.got[0].body])), hex(connectPacket({ clientId: 'valet-test', username: 'valet', password: 'pw', keepalive: 30, will: { topic: 'valet/status', payload: 'offline', retain: true } })));
  assert.deepEqual(c.packets.got.slice(1).map(pub), [{ topic: 'valet/a', payload: '1', qos: 0, id: 0, retain: false, dup: false }, { topic: 'valet/b', payload: '2', qos: 1, id: 1, retain: true, dup: false }]);
  m.publish({ topic: 'valet/c', payload: '3', qos: 1 });
  await c.packets.until(4);
  assert.equal(pub(c.packets.got[3]).id, 2);
  // the broker acknowledged both as they came; stopping says a last word and goodbye
  m.stop({ topic: 'valet/status', payload: 'offline', retain: true });
  await c.closed;
  assert.deepEqual(c.packets.got.slice(4).map(p => p.type === 3 ? pub(p).payload : p.type), ['offline', 14]);
  assert.equal(b.conns.got.length, 1, 'one connection, and none after stopping');
  assert.deepEqual(spoke(b.conns.got), [1, 3, 14]);
  b.close();
});

test('with no broker: messages wait in a bounded queue that lets go of the oldest, and it says so once', async () => {
  const b = await broker(), url = b.url; b.close();   // an address nothing listens on
  const { m, logs } = client(url, { queue: 5 });
  m.start();
  for (let i = 0; i < 12; i++) m.publish({ topic: 't', payload: String(i), qos: i % 2 as 0 | 1 });
  assert.equal(m.waiting, 5); assert.equal(m.dropped, 7); assert.equal(m.connected, false);
  await logs.until(1);
  assert.match(logs.got[0], /^mqtt: 127\.0\.0\.1:\d+: .*trying again/);
  m.stop();
  assert.equal(logs.got.length, 1);
});

test('a dropped connection: it comes back with a growing pause, sends again what wasn\'t acknowledged, and logs each way once', async () => {
  const b = await broker({ ack: false }), { m, logs, ups } = client(b.url);
  m.start();
  await ups.until(1);
  m.publish({ topic: 't', payload: 'kept', qos: 1 }); m.publish({ topic: 't', payload: 'fire-and-forget' });
  const [first] = b.conns.got;
  await first.packets.until(3);
  first.sock.destroy();
  await logs.until(1);   // it has seen the drop: QoS 0 written to a dying socket is gone, as MQTT means it to be
  m.publish({ topic: 't', payload: 'while down' });
  await ups.until(2);
  const second = b.conns.got[1];
  await second.packets.until(3);
  assert.deepEqual(second.packets.got.slice(1).map(pub).map(p => [p.payload, p.qos, p.dup]), [['kept', 1, true], ['while down', 0, false]], 'the unacknowledged one first, marked a repeat; what QoS 0 sent isn\'t sent twice');
  assert.equal(m.waiting, 1, 'still waiting for its acknowledgement');
  second.sock.end(PUBACK(pub(second.packets.got[1]).id));   // the answer, then goodbye
  await ups.until(3);
  assert.equal(m.waiting, 0, 'acknowledged, so not sent a third time');
  assert.deepEqual(b.conns.got[2].packets.got.filter(p => p.type === 3), []);
  assert.deepEqual(logs.got.map(l => l.replace(/:\d+/, '')), ['mqtt: 127.0.0.1: the connection closed; trying again until it answers', 'mqtt: connected to 127.0.0.1 again', 'mqtt: 127.0.0.1: the connection closed; trying again until it answers', 'mqtt: connected to 127.0.0.1 again']);
  m.stop(); b.close();
});

test('a broker that refuses, says nothing or stops answering pings is left and tried again', async () => {
  const refuses = await broker({ hello: c => c.sock.write(CONNACK(5)) }), r = client(refuses.url);
  r.m.publish({ topic: 't', payload: 'x' });
  r.m.start();
  await refuses.conns.until(3);
  assert.equal(r.logs.got.length, 1, 'said once, however many tries');
  assert.match(r.logs.got[0], /refused the connection \(not authorised\)/);
  assert.equal(r.m.connected, false); assert.equal(r.m.waiting, 1);
  assert.deepEqual(spoke(refuses.conns.got), [1], 'nothing is published to a broker that hasn\'t said yes');
  r.m.stop(); refuses.close();

  const deaf = await broker({ pong: false }), d = client(deaf.url, { ping: 3 });
  d.m.start();
  await deaf.conns.until(2);
  assert.ok(deaf.conns.got[0].packets.got.some(p => p.type === 12), 'it pinged');
  assert.match(d.logs.got[0], /no answer to a ping/);
  d.m.stop(); deaf.close();

  // one that answers pings keeps its connection
  const fine = await broker(), f = client(fine.url, { ping: 2 });
  f.m.start();
  await f.ups.until(1);
  await fine.conns.got[0].packets.until(6);
  assert.equal(fine.conns.got.length, 1); assert.equal(f.m.connected, true);
  f.m.stop(); fine.close();
});

test('a hostile broker: garbage, giant lengths and commands change nothing, and the client never subscribes or obeys', async () => {
  const attacks: Buffer[] = [
    Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0xff]),                                   // a length that never ends
    Buffer.concat([Buffer.from([0x30]), varint(268_435_455)]),                           // "256 MB follow"
    Buffer.concat([CONNACK(), CONNACK()]),                                               // welcomed twice
    Buffer.from([0x20, 3, 0, 0, 0]),                                                     // a CONNACK of the wrong size
    Buffer.from('HTTP/1.1 400 Bad Request\r\n\r\n'),                                     // not MQTT at all
    Buffer.from([0x40, 2, 0, 1]),                                                        // an answer before hello
  ];
  for (const attack of attacks) {
    const b = await broker({ hello: c => c.sock.write(attack) }), { m, logs } = client(b.url);
    m.publish({ topic: 't', payload: 'x', qos: 1 });
    m.start();
    await b.conns.until(2);   // it left and came back: nothing thrown, nothing stuck
    assert.equal(logs.got.length, 1, hex(attack.subarray(0, 6)));
    assert.ok(m.waiting <= 1);
    m.stop(); b.close();
  }
  // after a proper welcome, things a publisher is never owed are ignored: a message, a subscription's answer, an unknown type,
  // an acknowledgement of something never sent. Then a real one still gets through.
  const b = await broker({ hello: c => c.sock.write(Buffer.concat([CONNACK(), publishPacket({ topic: 'valet/cmd', payload: '{"run":"config__config_apply"}' }), Buffer.from([0x90, 3, 0, 1, 0]), Buffer.from([0xf0, 0]), PUBACK(999), Buffer.from([0x82, 5, 0, 1, 0, 1, 0x23])])) });
  const { m, ups, logs } = client(b.url);
  m.start();
  await ups.until(1);
  m.publish({ topic: 'valet/after', payload: 'still here', qos: 1 });
  const [c] = b.conns.got;
  await c.packets.until(2);
  assert.equal(pub(c.packets.got[1]).payload, 'still here');
  assert.equal(b.conns.got.length, 1); assert.deepEqual(logs.got, []);
  assert.deepEqual(spoke(b.conns.got), [1, 3], 'CONNECT and PUBLISH: never SUBSCRIBE (8), never an answer to a command');
  m.stop(); b.close();
});
