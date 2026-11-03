// The welcome card's look around: what's running, matched to integrations, and the lines each would take.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { parse } from 'yaml';

const { appOf, block, discover, match } = await import('../src/server/discover.ts');
const { registry } = await import('../src/integrations/index.ts');

test('discover: an image or a container name is enough to know the app', () => {
  assert.equal(appOf('lscr.io/linuxserver/sonarr:latest'), 'sonarr');
  assert.equal(appOf('ghcr.io/immich-app/immich-server:release'), 'immich');
  assert.equal(match(registry, 'plexinc/pms-docker', 'plex')?.i.type, 'plex');
  assert.equal(match(registry, 'lscr.io/linuxserver/radarr', 'movies')?.app, 'radarr');
  assert.equal(match(registry, 'postgres:16', 'db'), null);                        // not everything is an app
  assert.equal(match(registry, 'nginx', 'links'), null);                           // nor is a name that's only a word Valet uses
});

test('discover: a block names its secrets for .env and never holds one', () => {
  const arr = block(registry.arr, 'http://sonarr:8989', 'sonarr') as any;
  assert.deepEqual(arr, { type: 'arr', sonarr: { url: 'http://sonarr:8989', apiKey: '${SONARR_KEY}' } });
  const plex = block(registry.plex, 'http://plex:32400', 'plex') as any;
  assert.equal(plex.type, 'plex'); assert.equal(plex.url, 'http://plex:32400');
  for (const v of Object.values(plex)) if (typeof v === 'string' && v !== 'plex' && !v.startsWith('http')) assert.match(v, /^\$\{[A-Z0-9_]+\}$/);
});

test('discover: asks a socket proxy, skips what is already set up, and offers the web port', async () => {
  const containers = [
    { Names: ['/plex'], Image: 'plexinc/pms-docker', Ports: [{ PrivatePort: 1900, Type: 'udp' }, { PrivatePort: 3005, Type: 'tcp' }, { PrivatePort: 32400, Type: 'tcp' }] },
    { Names: ['/sonarr'], Image: 'lscr.io/linuxserver/sonarr', Ports: [{ PrivatePort: 8989, Type: 'tcp' }] },
    { Names: ['/pihole'], Image: 'pihole/pihole', Ports: [{ PrivatePort: 80, Type: 'tcp' }] },
    { Names: ['/redis'], Image: 'redis:7', Ports: [{ PrivatePort: 6379, Type: 'tcp' }] },
  ];
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(req.url === '/containers/json' ? JSON.stringify(containers) : '[]'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const { via, found } = await discover(registry, [{ type: 'docker', url }, { type: 'pihole' }]);
    assert.equal(via, url);
    const by = Object.fromEntries(found.map(f => [f.name, f]));
    assert.deepEqual(Object.keys(by).sort(), ['Plex', 'Sonarr']);                 // Pi-hole is already on the page
    assert.equal(by.Plex.url, 'http://plex:32400');
    assert.equal(parse(by.Sonarr.yaml).sonarr.sonarr.apiKey, '${SONARR_KEY}');
  } finally { server.close(); }
});
