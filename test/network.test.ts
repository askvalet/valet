// The network map: addresses grouped into machines and networks, what's running from what the widgets last said, the
// containers and VMs under the machine they're on, and nothing of a URL but its host and port ever reaching the card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import network, { mapFrom, told, whereIs } from '../src/integrations/network.ts';
import { drawn, mapFor, stateNow, summaryOf } from '../src/shared/map.ts';
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
  assert.equal(drawn(card.nodes).filter(n => n.label.toLowerCase() === 'plex').length, 1);
  assert.equal(node(card, 'plex')!.same, 'svc:plex');
  assert.equal(node(card, 'plex')!.from, 'docker');
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

// ── per person: a profile gets only the integrations on its tabs, from the one card the hub keeps

const lab = () => {
  const status = (items: { name: string; ok: boolean; group?: string; detail?: string }[]): Card => ({ type: 'status', items });
  return [
    peer('plex', 'plex', 'http://192.168.9.20:32400', [widget('now', { error: 'timed out' })], 'Plex'),
    peer('sonarr', 'sonarr', 'http://192.168.9.20:8989', undefined, 'Sonarr'),
    peer('ha', 'homeassistant', 'http://192.168.9.40:8123', undefined, 'Home Assistant'),
    peer('weather', 'weather', 'https://api.weather.example', undefined, 'Weather'),
    peer('docker', 'docker', 'http://192.168.9.20:2375', [widget('containers', { card: status([{ name: 'sonarr', ok: false, detail: 'exited (1)' }, { name: 'redis', ok: true }]) })], 'Docker'),
    { ...peer('boxes', 'machines', [], [widget('fleet', { card: { type: 'status', items: [{ name: 'Pi', ok: true }] } })], 'Machines'), addresses: [{ host: '192.168.9.40', port: 7576, field: 'hosts.pi.url', label: 'Pi' }] },
    peer('vpn', 'tailscale', 'http://100.100.1.2:80', undefined, 'Tailscale box'),
  ];
};

test('a profile that sees one service gets that service, its machine and network, and nothing that names the rest', () => {
  const all = mapFrom(lab(), opts({ names: { '192.168.9.20': 'Server' } }));
  const theirs = mapFor(all, id => id === 'sonarr');
  valid(theirs);
  const text = JSON.stringify(theirs);
  for (const gone of ['Plex', '32400', 'Home Assistant', '8123', 'Weather', 'redis', 'Pi', '192.168.9.40', 'Tailscale', 'docker', 'out there', 'timed out']) assert.ok(!text.includes(gone), `leaked ${gone}`);
  assert.deepEqual(theirs.nodes.map(n => n.label), ['Internet', 'Local network', 'Server', 'Sonarr']);
  // the container sonarr is Docker's, which they can't see: Sonarr's own dot, with no word of it
  assert.ok(!theirs.nodes.some(n => n.same));
  assert.equal(stateNow(node(theirs, 'Sonarr')!, theirs.nodes), 'up');
  // the machine is worked out again from what's left: up, because Sonarr answers, though Plex on it doesn't
  assert.equal(node(theirs, 'Server')?.state, 'up');
  assert.equal(node(theirs, 'Internet')?.state, undefined);
  assert.deepEqual([theirs.summary?.value, theirs.summary?.sub, theirs.summary?.tone], ['1 host', 'all answering', 'good']);
  // the owner's is the whole map: Plex down, Sonarr unwell for its container
  assert.equal(all.summary?.tone, 'bad');
  assert.equal(stateNow(node(all, 'Sonarr')!, all.nodes), 'degraded');
  // a machine they may see the source of stays even with nothing of theirs on it, with its own state
  const pi = mapFor(all, id => id === 'boxes');
  assert.deepEqual(pi.nodes.filter(n => n.kind === 'host').map(h => [h.label, h.state]), [['Pi', 'up']]);
  // an owner (and an install with no sign-in) sees it all
  assert.deepEqual(mapFor(all, () => true).nodes.map(n => n.id), all.nodes.map(n => n.id));
});

test('the view: an owner knows every integration, a profile only those with a widget on its tabs', async () => {
  const { viewOf } = await import('../src/server/people.ts');
  const config = parseConfig(`
integrations:
  sonarr: { type: api, url: "http://192.168.9.20:8989/q", title: Sonarr, stats: [{ label: Queue, value: total }] }
  plex: { type: api, url: "http://192.168.9.20:32400/q", title: Plex, stats: [{ label: Streams, value: total }] }
  net: { type: network }
assistant: { model: m, access: { default: read } }
profiles:
  kid: { tabs: [Kid], assistant: { access: { default: read, net: read } } }
users: { sam: kid }
layout:
  - title: Kid
    widgets: [sonarr.data, net.map]
  - title: Grown-ups
    widgets: [plex.data, net.map]
`);
  const { instances, placed, lab: parts } = check(config, registry);
  const site = { config, instances, placed };
  parts.hub = { snapshot: () => [{ key: 'sonarr.data', card: { type: 'text', text: 'x' }, at: 1 }, { key: 'plex.data', error: 'timed out', at: 1 }], widget: (k: string) => ['sonarr.data', 'plex.data', 'net.map'].includes(k) || undefined };
  const owner = viewOf(site), kid = viewOf(site, 'sam');
  assert.ok(owner.knows('plex') && kid.knows('sonarr') && kid.knows('net') && !kid.knows('plex'));
  // the widget, as the chat's `show` draws it for them, and the tool, words and card alike
  const shown = await kid.instances.get('net')!.widgets.map.fetch() as MapCard;
  assert.ok(node(shown, 'Sonarr') && !node(shown, 'Plex'));
  const out = await kid.instances.get('net')!.tools!.network_map.run({});
  assert.ok(!JSON.stringify(out).includes('Plex') && !JSON.stringify(out).includes('32400'), 'the tool told them of Plex');
  assert.ok(JSON.stringify(out.data).includes('Sonarr'));
  const full = await owner.instances.get('net')!.tools!.network_map.run({});
  assert.ok(JSON.stringify(full.data).includes('Plex'));
  assert.equal(node(full.card as MapCard, 'Plex')?.state, 'down');
});

// ── a config shaped like a real one: http checks beside the services' own integrations, a reverse proxy on a domain

test('one service on one machine is one node: a check of it, another integration of it and its container fold into it', () => {
  const config = parseConfig(`
integrations:
  quran: { type: api, url: "https://quran.example.dev", title: Quran, stats: [{ label: Ayat, value: n }] }
  drives: { type: scrutiny, url: "https://scrutiny.example.dev" }
  indexers:
    type: indexers
    prowlarr: { url: "http://192.168.2.55:9696", apiKey: k }
    bazarr: { url: "http://192.168.2.55:6767", apiKey: k }
  dns: { type: pihole, url: "http://192.168.2.51", password: p }
  services:
    type: http
    targets:
      - { name: Bazarr, url: "http://192.168.2.55:6767" }
      - { name: Quran, url: "https://quran.example.dev" }
      - { name: Scrutiny, url: "https://home.example.dev/_status/drives-ok" }
      - { name: Pi-hole, url: "http://192.168.2.51/admin/" }
      - { name: Beszel, url: "https://beszel.example.dev" }
  feeds: { type: rss, feeds: [{ url: "https://blog.example.org/rss", name: Example Blog }, { url: "https://news.example.org/rss", name: Example News }] }
  network: { type: network, containers: false, names: { 192.168.2.55: Desktop, 172.17.0.1: Desktop, 192.168.2.51: Raspberry Pi } }
layout:
  - widgets: [network.map]
`);
  const { problems, instances } = check(config, registry);
  assert.deepEqual(problems, []);
  return (instances.get('network')!.widgets.map.fetch() as Promise<MapCard>).then(card => {
    valid(card);
    const shown = drawn(card.nodes), under = (host: string) => shown.filter(n => n.parent === node(card, host)?.id).map(n => n.label).sort();
    // the check and the integration were two nodes each: Quran and Scrutiny out on the internet, Pi-hole on the Pi, and
    // indexers' bazarr beside the check's Bazarr on the Desktop
    for (const name of ['quran', 'scrutiny', 'pihole', 'bazarr']) assert.equal(shown.filter(n => n.label.toLowerCase().replace(/[^a-z]/g, '') === name).length, 1, name);
    assert.deepEqual(under('Raspberry Pi'), ['Pi-hole']);
    assert.ok(under('Desktop').includes('Bazarr') && !under('Desktop').includes('bazarr'), 'the written name is the one drawn');
    // feeds stay, once each
    assert.deepEqual(shown.filter(n => n.parent === 'internet' && /Example (Blog|News)/.test(n.label)).map(n => n.label).sort(), ['Example Blog', 'Example News']);
  });
});

test('names: a domain names its subdomains, so services behind a reverse proxy are on its machine', async () => {
  const config = parseConfig(`
integrations:
  quran: { type: api, url: "https://quran.example.dev", title: Quran, stats: [{ label: Ayat, value: n }] }
  drives: { type: scrutiny, url: "https://scrutiny.example.dev" }
  photos: { type: api, url: "http://192.168.2.55:2283", title: Immich, stats: [{ label: Photos, value: n }] }
  jobs: { type: api, url: "https://home.example.dev/jobs.json", title: Jobs, stats: [{ label: Jobs, value: n }] }
  cloud: { type: api, url: "https://api.weather.example/v1", title: Weather, stats: [{ label: Temp, value: n }] }
  network: { type: network, containers: false, names: { 192.168.2.55: Desktop, example.dev: Desktop } }
layout:
  - widgets: [network.map]
`);
  const card = await check(config, registry).instances.get('network')!.widgets.map.fetch() as MapCard;
  valid(card);
  for (const name of ['Quran', 'Scrutiny', 'Immich', 'Jobs']) assert.equal(parentOf(card, name)?.label, 'Desktop', name);
  assert.equal(parentOf(card, 'Weather')?.kind, 'internet');   // a domain nobody named is still out there
  // the machine shows its private address; the public names are how its services are reached, said on them
  assert.equal(node(card, 'Desktop')?.address, '192.168.2.55');
  assert.equal(node(card, 'Quran')?.address, 'quran.example.dev:443');
  // with no private address, the public name is all there is to show
  const only = await check(parseConfig(`
integrations:
  quran: { type: api, url: "https://quran.example.dev", title: Quran, stats: [{ label: Ayat, value: n }] }
  network: { type: network, names: { example.dev: Desktop } }
layout:
  - widgets: [network.map]
`), registry).instances.get('network')!.widgets.map.fetch() as MapCard;
  assert.equal(node(only, 'Desktop')?.address, 'quran.example.dev');
});

test('a container or unit that is a service folds into it, matched loosely, and its trouble shows on the service', () => {
  const status = (items: { name: string; ok: boolean; group?: string; detail?: string }[]): Card => ({ type: 'status', items });
  const card = mapFrom([
    peer('dns', 'pihole', 'http://192.168.2.51', undefined, 'Pi-hole'),
    peer('photos', 'immich', 'http://192.168.2.55:2283', undefined, 'Immich'),
    peer('bazarr', 'bazarr', 'http://192.168.2.55:6767', undefined, 'Bazarr'),
    peer('docker', 'docker', 'http://valet-dockerproxy:2375', [widget('containers', { card: status([{ name: 'bazarr', ok: true }, { name: 'immich_server', ok: false, detail: 'exited (1)' }, { name: 'immich_postgres', ok: true }, { name: 'homepage', ok: true }]) })], 'Docker'),
    { ...peer('boxes', 'machines', [], [widget('fleet', { card: status([{ name: 'Raspberry Pi', ok: true }]) }), widget('units', { card: status([{ name: 'pihole-FTL', ok: true, group: 'Raspberry Pi' }, { name: 'unbound', ok: true, group: 'Raspberry Pi' }]) })], 'Machines'),
      addresses: [{ host: '192.168.2.51', port: 7576, field: 'hosts.pi.url', label: 'Raspberry Pi' }] },
  ], opts({ names: { '192.168.2.55': 'Desktop', localhost: 'Desktop' } }));
  valid(card);
  const shown = drawn(card.nodes).map(n => n.label);
  for (const gone of ['bazarr', 'immich_server', 'immich_postgres', 'pihole-FTL']) assert.ok(!shown.includes(gone), gone);
  for (const kept of ['Bazarr', 'Immich', 'Pi-hole', 'unbound', 'homepage']) assert.ok(shown.includes(kept), kept);
  assert.equal(node(card, 'pihole-FTL')?.same, node(card, 'Pi-hole')?.id);
  // Immich answers but its server container has stopped: unwell, not up
  assert.equal(stateNow(node(card, 'Immich')!, card.nodes), 'degraded');
  // and folding is worked out again for someone who can't see Docker: Immich is just up
  const theirs = mapFor(card, id => id === 'photos');
  assert.equal(stateNow(node(theirs, 'Immich')!, theirs.nodes), 'up');
  assert.ok(!theirs.nodes.some(n => n.same));
});
