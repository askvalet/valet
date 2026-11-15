// The network map: addresses grouped into machines and networks, what's running from what the widgets last said, the
// containers and VMs under the machine they're on, and nothing of a URL but its host and port ever reaching the card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import network, { mapFrom, summaryOf, told, whereIs } from '../src/integrations/network.ts';
import { addressesOf, addressOf } from '../src/server/lab.ts';
import { session, type Peer, type PeerWidget } from '../src/server/core.ts';
import { redactor } from '../src/server/security.ts';
import { parseConfig } from '../src/server/config.ts';
import { check } from '../src/server/site.ts';
import { registry } from '../src/integrations/index.ts';
import { checkCard } from '../src/shared/cards.schema.ts';
import type { Card, MapCard, MapNode } from '../src/shared/cards.ts';

const opts = (o: Record<string, unknown> = {}) => network.config.parse(o);
const widget = (name: string, w: Partial<PeerWidget> = {}): PeerWidget => ({ name, title: name, placed: true, read: async () => w.card, ...w });
const peer = (id: string, type: string, url: string | string[], widgets: PeerWidget[] = [widget('status', { card: { type: 'text', text: 'fine' } })], name = type): Peer => ({
  id, type, name, icon: `/api/icon/${type}`, widgets,
  addresses: [url].flat().map((u, i) => ({ ...addressOf(u)!, field: Array.isArray(url) ? `targets.${i}.url` : 'url' })),
});
const node = (card: MapCard, label: string) => card.nodes.find(n => n.label === label);
const parentOf = (card: MapCard, label: string) => card.nodes.find(n => n.id === node(card, label)?.parent);
const valid = (card: Card) => { const r = checkCard(card); assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))); };

test('where an address is: private, public, the tailnet, and the machine Valet runs on', () => {
  assert.deepEqual(whereIs('192.168.2.55'), { at: 'lan', net: '192.168.2' });
  assert.deepEqual(whereIs('10.0.0.4'), { at: 'lan', net: '10.0.0' });
  assert.deepEqual(whereIs('172.20.1.9'), { at: 'lan', net: '172.20.1' });
  for (const h of ['localhost', '127.0.0.1', '172.17.0.1', 'host.docker.internal', 'valet-dockerproxy']) assert.equal(whereIs(h).at, 'here', h);
  for (const h of ['100.101.2.3', 'nas.tail1234.ts.net']) assert.equal(whereIs(h).at, 'tailnet', h);
  for (const h of ['nas.lan', 'pi.local', 'printer.home.arpa']) assert.equal(whereIs(h).at, 'lan', h);
  for (const h of ['api.open-meteo.com', '8.8.8.8', 'api.github.com']) assert.equal(whereIs(h).at, 'internet', h);
});

test('an address is its host and port, never its path, query, user or a secret', () => {
  assert.deepEqual(addressOf('http://admin:hunter22@192.168.1.5:8989/api/v3?apikey=abc#x'), { host: '192.168.1.5', port: 8989 });
  assert.deepEqual(addressOf('https://nas.lan/'), { host: 'nas.lan', port: 443 });
  assert.deepEqual(addressOf('http://[fd00::5]:81'), { host: 'fd00::5', port: 81 });
  assert.equal(addressOf('not a url'), undefined);
  assert.equal(addressOf('file:///etc/passwd'), undefined);
  // the whole URL a secret, or a secret in the host: left out, as the page would only see dots
  const secrets = ['http://10.9.9.9:32400', 'secret-host.example'], redact = redactor(secrets);
  assert.equal(addressOf('http://10.9.9.9:32400', redact), undefined);
  assert.equal(addressOf('https://secret-host.example/x', redact), undefined);
  // a key in the query is a secret too, but the host isn't
  assert.deepEqual(addressOf('http://10.0.0.2:80/?token=abcdefgh123', redactor(['abcdefgh123'])), { host: '10.0.0.2', port: 80 });
});

test('every url option in a config, labelled by the name beside it or the key above it', () => {
  const found = addressesOf({ url: 'http://10.0.0.1:1', href: 'https://public.example', targets: [{ name: 'Router', url: 'http://10.0.0.254' }], hosts: { nas: { url: 'http://10.0.0.5:7576', token: 't' } } });
  assert.deepEqual(found.map(a => [a.field, a.host, a.port, a.label]), [['url', '10.0.0.1', 1, undefined], ['targets.0.url', '10.0.0.254', 80, 'Router'], ['hosts.nas.url', '10.0.0.5', 7576, 'nas']]);
});

test('integrations grouped by machine: one network, the internet above, the machine Valet runs on first', () => {
  const card = mapFrom([
    peer('sonarr', 'arr', 'http://192.168.2.55:8989', undefined, 'Sonarr'),
    peer('plex', 'plex', 'http://192.168.2.55:32400', undefined, 'Plex'),
    peer('nas', 'synology', 'https://192.168.2.60:5001', undefined, 'Synology'),
    peer('ha', 'homeassistant', 'http://172.17.0.1:8123', undefined, 'Home Assistant'),
    { ...peer('weather', 'weather', 'https://api.open-meteo.com', undefined, 'Weather'), addresses: [{ host: 'api.open-meteo.com', port: 443, field: '', seen: true }] },
  ], opts());
  valid(card);
  assert.equal(parentOf(card, 'Sonarr')?.label, '192.168.2.55');
  assert.equal(parentOf(card, 'Plex')?.id, parentOf(card, 'Sonarr')?.id);
  assert.equal(parentOf(card, 'Synology')?.label, '192.168.2.60');
  assert.equal(parentOf(card, 'Home Assistant')?.label, "Valet's machine");
  assert.equal(parentOf(card, 'Weather')?.kind, 'internet');
  assert.equal(node(card, 'Weather')?.address, 'api.open-meteo.com');
  assert.equal(node(card, 'Sonarr')?.address, '192.168.2.55:8989');
  // one network for them all, with its range
  const nets = card.nodes.filter(n => n.kind === 'network');
  assert.deepEqual(nets.map(n => [n.label, n.detail]), [['Local network', '192.168.2.0/24']]);
  assert.equal(card.nodes.filter(n => n.kind === 'host')[0].label, "Valet's machine");
  // Valet's machine isn't shown at Docker's gateway: that's only how a container reaches it
  assert.equal(node(card, "Valet's machine")?.address, undefined);
});

test('names: an address gets a name, and two addresses with one name are one machine', () => {
  const card = mapFrom([peer('a', 'arr', 'http://192.168.2.55:8989'), peer('b', 'homeassistant', 'http://localhost:8123'), peer('c', 'pihole', 'http://192.168.2.70')],
    opts({ names: { '192.168.2.55': 'Server', localhost: 'Server', '192.168.2.70': 'Pi' } }));
  const hosts = card.nodes.filter(n => n.kind === 'host');
  assert.deepEqual(hosts.map(h => h.label).sort(), ['Pi', 'Server']);
  assert.equal(node(card, 'Server')?.address, '192.168.2.55');
  assert.match(node(card, 'Server')!.detail!, /Valet runs here/);
  assert.equal(card.nodes.filter(n => n.parent === node(card, 'Server')!.id).length, 2);
});

test('hide leaves out an integration, a machine or a container by name', () => {
  const card = mapFrom([peer('a', 'arr', 'http://192.168.2.55:8989', undefined, 'Sonarr'), peer('b', 'pihole', 'http://192.168.2.70', undefined, 'Pi-hole')], opts({ hide: ['a', '192.168.2.70'] }));
  assert.equal(node(card, 'Sonarr'), undefined);
  assert.equal(node(card, 'Pi-hole'), undefined);
});

test('what is running comes from the widgets: an error is down, a card is up, off the page is not known', () => {
  const card = mapFrom([
    peer('ok', 'arr', 'http://10.0.0.2:1', [widget('queue', { card: { type: 'text', text: 'x' } })], 'Sonarr'),
    peer('bad', 'plex', 'http://10.0.0.2:2', [widget('now', { error: 'timed out', card: { type: 'text', text: 'old' } })], 'Plex'),
    peer('away', 'mealie', 'http://10.0.0.3:3', [widget('meals', { placed: false })], 'Mealie'),
    peer('gone', 'pihole', 'http://10.0.0.4', [widget('stats', { error: 'not reachable' })], 'Pi-hole'),
  ], opts());
  valid(card);
  assert.equal(node(card, 'Sonarr')?.state, 'up');
  assert.equal(node(card, 'Plex')?.state, 'down');
  assert.match(node(card, 'Plex')!.detail!, /timed out/);
  assert.equal(node(card, 'Mealie')?.state, undefined);
  assert.match(node(card, 'Mealie')!.detail!, /not on the page/);
  // a machine with something answering is up; one where nothing does is down
  assert.equal(node(card, '10.0.0.2')?.state, 'up');
  assert.equal(node(card, '10.0.0.4')?.state, 'down');
  assert.equal(node(card, '10.0.0.3')?.state, undefined);
  const s = summaryOf('Network', card.nodes);
  assert.equal(s.value, '3 hosts');
  assert.match(s.sub!, /^2 down: (Plex, Pi-hole|Pi-hole, Plex)$/);   // not the machine too: it's down because they are
  assert.equal(s.tone, 'bad');
});

test('http checks: a node for each target, each with its own state', () => {
  const card = mapFrom([{ ...peer('checks', 'http', ['http://10.0.0.1', 'http://10.0.0.9:9000'], [widget('status', { card: { type: 'status', items: [{ name: 'Router', ok: true }, { name: 'Printer', ok: false, detail: 'timed out' }] } })]),
    addresses: [{ host: '10.0.0.1', port: 80, field: 'targets.0.url', label: 'Router' }, { host: '10.0.0.9', port: 9000, field: 'targets.1.url', label: 'Printer' }] }], opts());
  assert.equal(node(card, 'Router')?.state, 'up');
  assert.equal(node(card, 'Printer')?.state, 'down');
  assert.equal(parentOf(card, 'Printer')?.label, '10.0.0.9');
});

test('containers and VMs hang from the machine they run on, and a container that is a service on the map is that service', () => {
  const status = (items: { name: string; ok: boolean; group?: string; detail?: string }[]): Card => ({ type: 'status', items });
  const card = mapFrom([
    peer('docker', 'docker', 'http://valet-dockerproxy:2375', [widget('containers', { card: status([{ name: 'plex', ok: true }, { name: 'redis', ok: false, detail: 'exited (1)' }]) })], 'Docker'),
    peer('plex', 'plex', 'http://172.17.0.1:32400', undefined, 'Plex'),
    { ...peer('boxes', 'machines', [], [widget('fleet', { card: { type: 'status', items: [{ name: 'nas', ok: false, detail: 'not reachable' }] } }), widget('containers', { card: status([{ name: 'immich', ok: true, group: 'nas' }, { name: 'paperless', ok: true, group: 'nas · not reachable · last seen 4:02 PM' }]) })], 'Machines'),
      addresses: [{ host: '192.168.2.60', port: 7576, field: 'hosts.nas.url', label: 'nas' }] },
    peer('pve', 'proxmox', 'https://192.168.2.10:8006', [widget('guests', { card: { type: 'list', items: [{ id: 'node/pve', title: 'pve', section: 'pve' }, { id: 'qemu/100', title: 'homeassistant', subtitle: 'VM 100 · up 3d', section: 'pve' }, { id: 'lxc/101', title: 'backup', subtitle: 'CT 101 · stopped', section: 'pve' }] } })], 'Proxmox'),
  ], opts());
  valid(card);
  const here = node(card, "Valet's machine")!;
  assert.equal(parentOf(card, 'redis')?.id, here.id);
  assert.equal(node(card, 'redis')?.kind, 'container');
  assert.equal(node(card, 'redis')?.state, 'down');
  // plex the container is Plex the service: one node, which says so
  assert.equal(card.nodes.filter(n => n.label.toLowerCase() === 'plex').length, 1);
  assert.match(node(card, 'Plex')!.detail!, /container plex/);
  // a machine's containers are under that machine, which is down because its agent says so
  assert.equal(parentOf(card, 'immich')?.label, 'nas');
  assert.equal(parentOf(card, 'paperless')?.label, 'nas');
  assert.equal(node(card, 'nas')?.state, 'down');
  assert.equal(node(card, 'Machines'), undefined);   // the agents are the machines, not a service on one
  assert.equal(node(card, 'homeassistant')?.kind, 'vm');
  assert.equal(node(card, 'backup')?.state, 'off');
  assert.equal(parentOf(card, 'homeassistant')?.label, '192.168.2.10');
  // containers: false leaves them all out
  const bare = mapFrom([peer('docker', 'docker', 'http://valet-dockerproxy:2375', [widget('containers', { card: status([{ name: 'redis', ok: true }]) })], 'Docker')], opts({ containers: false }));
  assert.equal(node(bare, 'redis'), undefined);
});

test('through a real config: no credentials, paths, queries or secrets reach the card, and the tool answers for one machine', async () => {
  process.env.NETMAP_TEST_KEY = 'sk-very-secret-key-123';
  process.env.NETMAP_TEST_SECRET = 'http://10.66.66.66:9999';
  const config = parseConfig(`
integrations:
  sonarr: { type: api, url: "http://admin:pass1234@192.168.7.5:8989/sonarr?x=1", headers: { X-Api-Key: "\${NETMAP_TEST_KEY}" }, stats: [{ label: Queue, value: total }] }
  hidden: { type: api, url: "\${NETMAP_TEST_SECRET}", stats: [{ label: Queue, value: total }] }
  checks:
    type: http
    targets:
      - { name: Router, url: "http://192.168.7.1/login?pw=letmein" }
  net: { type: network, names: { 192.168.7.5: Server } }
layout:
  - widgets: [net.map]
`);
  const { problems, instances } = check(config, registry);
  assert.deepEqual(problems, []);
  const card = await instances.get('net')!.widgets.map.fetch() as MapCard;
  valid(card);
  const text = JSON.stringify(card);
  for (const leak of ['admin', 'pass1234', '/sonarr', 'x=1', 'sk-very-secret', 'letmein', '/login', '10.66.66.66', '9999']) assert.ok(!text.includes(leak), `leaked ${leak}`);
  assert.equal(node(card, 'Server')?.address, '192.168.7.5');
  assert.equal(node(card, 'Router')?.address, '192.168.7.1:80');
  const out = await instances.get('net')!.tools!.network_map.run({ host: 'Server' });
  assert.deepEqual((out.data as ReturnType<typeof told>).machines.map(m => m.machine), ['Server']);
  assert.ok((out.data as ReturnType<typeof told>).machines[0].runs.some(r => r.startsWith('sonarr')));
  const shown = (out.card as MapCard).nodes;
  assert.ok(shown.some(n => n.label === 'Server') && !shown.some(n => n.label === '192.168.7.1'));
  valid(out.card!);
});

test('the integration reads a container list that is off the page at most once a minute', async () => {
  let reads = 0;
  const peers = () => [peer('docker', 'docker', 'http://valet-dockerproxy:2375', [{ name: 'containers', title: 'Containers', placed: false, read: async () => { reads++; return { type: 'status', items: [{ name: 'redis', ok: true }] }; } }], 'Docker')];
  const inst = network.create(opts(), { id: 'net', log() {}, image: r => r, upload: async () => { throw new Error('no'); }, session, http: async () => { throw new Error('no network'); }, lab: peers });
  const a = await inst.widgets.map.fetch() as MapCard, b = await inst.widgets.map.fetch() as MapCard;
  assert.equal(reads, 1);
  assert.ok(node(a, 'redis') && node(b, 'redis'));
  // without a lab (a test, a check) it draws only the internet, and says nothing is there
  const alone = await network.create(opts(), { id: 'n', log() {}, image: r => r, upload: async () => { throw new Error('no'); }, session, http: async () => { throw new Error('no'); } }).widgets.map.fetch() as MapCard;
  valid(alone);
  assert.deepEqual(alone.nodes.map(n => n.kind), ['internet']);
});

test('the map card: its schema refuses a repeated id or an unknown kind', () => {
  const nodes: MapNode[] = [{ id: 'a', label: 'A', kind: 'host' }, { id: 'a', label: 'B', kind: 'service', parent: 'a' }];
  assert.equal(checkCard({ type: 'map', nodes }).success, false);
  assert.equal(checkCard({ type: 'map', nodes: [{ id: 'a', label: 'A', kind: 'router' }] }).success, false);
  assert.equal(checkCard({ type: 'map', nodes: [{ id: 'a', label: 'A', kind: 'host', state: 'up', address: '10.0.0.1' }] }).success, true);
});
