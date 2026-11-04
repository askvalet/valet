// Valet's own push notifications: the encryption against RFC 8291's worked example, the VAPID signature, which push
// services it will post to, and a delivery round trip through a stand-in push service. No network.
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.VALET_DATA = await mkdtemp(join(tmpdir(), 'valet-push-'));
const { allowed, encrypt, forget, pushAll, subscribe, subscriptions, unsubscribe, vapidAuth, vapidKeys } = await import('../src/server/webpush.ts');
const { Config, PUSH_SERVICES } = await import('../src/server/config.ts');
const { placeOf } = await import('../src/server/site.ts');

const b64 = (s: string) => Buffer.from(s, 'base64url');

/** What a browser does with a push: the RFC 8291 steps again, from the receiving side. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const ua = createECDH('prime256v1'); ua.setPrivateKey(uaPrivate);
  const hk = (s: Buffer, k: Buffer, info: Buffer, n: number) => createHmac('sha256', createHmac('sha256', s).update(k).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n);
  const ikm = hk(auth, ua.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32);
  const d = createDecipheriv('aes-128-gcm', hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
  const end = plain.lastIndexOf(2);
  assert.ok(end >= 0 && plain.subarray(end + 1).every(b => b === 0), 'one record, padded with zeros after the delimiter');
  return plain.subarray(0, end).toString();
}
const browser = () => { const e = createECDH('prime256v1'); e.generateKeys(); const auth = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 7)); return { e, auth, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }; };

test('encryption matches RFC 8291\'s example byte for byte', () => {
  const body = encrypt(Buffer.from('When I grow up, I want to be a watermelon'),
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), b64('DGv6ra1nlYgDCS1FRnbzlw'));
  assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  assert.equal(decrypt(body, b64('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'), b64('BTBZMqHH6r4Tts7J_aSIgg')), 'When I grow up, I want to be a watermelon');
});

test('each push has a fresh key and salt, and only its browser can read it', () => {
  const b = browser(), text = JSON.stringify({ title: 'Plex is down', body: 'since 10:42' });
  const one = encrypt(Buffer.from(text), b.keys), two = encrypt(Buffer.from(text), b.keys);
  assert.notDeepEqual(one.subarray(0, 86), two.subarray(0, 86));
  assert.equal(decrypt(one, b.e.getPrivateKey(), b.auth), text);
  assert.throws(() => decrypt(one, browser().e.getPrivateKey(), b.auth));
});

test('VAPID: a key made once and kept private, and a JWT the push service can check', async () => {
  const v = await vapidKeys(), again = await vapidKeys();
  assert.equal(v.publicKey, again.publicKey);
  assert.equal((await stat(join(process.env.VALET_DATA!, 'vapid.json'))).mode & 0o777, 0o600);
  const header = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', v, 'mailto:me@example.com', 1_700_000_000_000);
  const [, t, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert.equal(k, v.publicKey);
  const [h, c, sig] = t.split('.');
  assert.deepEqual(JSON.parse(b64(h).toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(b64(c).toString()), { aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:me@example.com' });
  const raw = b64(k), pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, b64(sig)));
  forget();
  assert.equal((await vapidKeys()).publicKey, v.publicKey, 'read back from the data folder');
});

test('Valet posts only to real push services, or ones the config names', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.ok(allowed(ok, PUSH_SERVICES), ok);
  for (const no of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://192.168.1.1/x', 'https://evilpush.apple.com/x', 'https://user:pw@fcm.googleapis.com/x', 'not a url']) assert.ok(!allowed(no, PUSH_SERVICES), no);
  assert.ok(allowed('http://127.0.0.1:8099/push/1', ['http://127.0.0.1:8099']));
  assert.ok(!allowed('http://127.0.0.1:8098/push/1', ['http://127.0.0.1:8099']));
  assert.ok(!allowed('http://127.0.0.1:8099/x', ['127.0.0.1']), 'a bare host means HTTPS');
});

test('a round trip through a stand-in push service: delivered, readable, and gone means removed', async () => {
  const live = browser(), dead = browser(), seen: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: init.body as Buffer });
    return new Response(null, { status: url.endsWith('/dead') ? 410 : 201 });
  }) as typeof fetch;
  await subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/live', keys: live.keys }, 'me');
  await subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/dead', keys: dead.keys }, 'me');
  await subscribe({ endpoint: 'https://evil.example/x', keys: live.keys }, 'me');   // a service the config stopped listing: never posted to, and dropped
  await pushAll({ title: 'Downloads finished', body: 'Dune', url: '/#media', urgent: true }, { contact: 'https://askvalet.dev', services: PUSH_SERVICES, send });
  assert.deepEqual(seen.map(s => s.url).sort(), ['https://fcm.googleapis.com/fcm/send/dead', 'https://fcm.googleapis.com/fcm/send/live']);
  const got = seen.find(s => s.url.endsWith('/live'))!;
  assert.equal(got.headers['Content-Encoding'], 'aes128gcm'); assert.equal(got.headers.Urgency, 'high'); assert.match(got.headers.Authorization, /^vapid t=.+, k=/);
  assert.deepEqual(JSON.parse(decrypt(got.body, live.e.getPrivateKey(), live.auth)), { title: 'Downloads finished', body: 'Dune', url: '/#media', urgent: true });
  assert.deepEqual((await subscriptions()).map(s => s.endpoint).sort(), ['https://fcm.googleapis.com/fcm/send/live']);
  assert.equal((await stat(join(process.env.VALET_DATA!, 'push.json'))).mode & 0o777, 0o600);
  // someone else can't switch off your device; you can
  assert.equal(await unsubscribe('https://fcm.googleapis.com/fcm/send/live', 'other'), false);
  assert.equal(await unsubscribe('https://fcm.googleapis.com/fcm/send/live', 'me'), true);
});

test('notify.webPush defaults, and where a notification opens', () => {
  const c = Config.parse({ layout: [{ widgets: ['a.x'] }, { title: 'PC & desk', widgets: ['b.y'] }, { tab: 'Media', title: 'Now playing', widgets: ['c.z'] }] });
  assert.deepEqual(c.notify.webPush, { enabled: true, contact: 'https://askvalet.dev', services: PUSH_SERVICES });
  assert.ok(!Config.safeParse({ notify: { webPush: { contact: 'me@example.com' } } }).success, 'a contact is a mailto: or https: URI');
  assert.equal(placeOf(c, 'a.x'), '/'); assert.equal(placeOf(c, 'b.y'), '/#pc-desk'); assert.equal(placeOf(c, 'c.z'), '/#media'); assert.equal(placeOf(c), '/'); assert.equal(placeOf(c, 'nope.w'), '/');
});
