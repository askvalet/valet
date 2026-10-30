// A made-up homelab, for the public demo. Every number, name and title is invented and every picture is drawn here, so
// nothing depends on a real service or anyone's artwork. It moves on its own (streams play, downloads fill, graphs
// wander) from the clock alone, and whatever a visitor changes puts itself back after ten minutes.
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const rng = seed => { let s = (hash(seed) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const wave = (i, a, b) => a + (b - a) * (.5 + .32 * Math.sin(i / 3.1) + .18 * Math.sin(i / 1.3));
const now = () => Date.now();
const past = (n, a, b, step = 60_000) => Array.from({ length: n }, (_, i) => Math.round(wave(Math.floor(now() / step) - n + i, a, b) * 10) / 10);
const PALETTES = [['#0b1033', '#5b3a8c', '#f2708a', '#ffc27a'], ['#04202b', '#0e5a6b', '#3fb6a8', '#f5e6a8'], ['#1a0b2e', '#7a2a6b', '#ff6f59', '#ffd166'],
  ['#0a1a12', '#1f5a44', '#7cc36a', '#f4f1bb'], ['#101827', '#2f4b8f', '#6ea8ff', '#e8f1ff'], ['#2a0f12', '#8a2b2b', '#ef8354', '#ffe0a3']];
const uri = svg => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/** A landscape: a sky, a sun or moon, and ridges fading into the distance. No two seeds alike. */
function scene(w, h, seed) {
  const r = rng(seed), p = PALETTES[Math.floor(r() * PALETTES.length)], id = hash(seed) % 9999, sx = w * (.2 + r() * .6), sy = h * (.3 + r() * .25);
  const ridges = [0, 1, 2, 3].map(k => {
    const base = h * (.6 + k * .1), amp = h * (.13 - k * .017), a = r() * 9, b = r() * 9;
    let d = `M0,${h}`;
    for (let x = 0; x <= w; x += w / 48) d += ` L${x.toFixed(0)},${(base - amp * (.6 * Math.sin(x / (w * .19) + a) + .4 * Math.sin(x / (w * .07) + b))).toFixed(0)}`;
    return `<path d="${d} L${w},${h}Z" fill="${p[0]}" opacity="${.45 + k * .18}"/>`;
  }).join('');
  const stars = Array.from({ length: 24 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h * .45).toFixed(0)}" r="${(r() * 1.4 + .3).toFixed(1)}" fill="#fff" opacity="${(r() * .6).toFixed(2)}"/>`).join('');
  return `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset=".45" stop-color="${p[1]}"/><stop offset=".8" stop-color="${p[2]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g${id})"/>${stars}<circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="${(h * .1).toFixed(0)}" fill="${p[3]}" opacity=".9"/>${ridges}`;
}
const photo = (seed, w = 1500, h = 1000) => uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${scene(w, h, seed)}</svg>`);
const poster = title => uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">${scene(300, 450, title)}<rect y="300" width="300" height="150" fill="#000" opacity=".28"/>
<text x="150" y="${title.length > 14 ? 372 : 384}" text-anchor="middle" font-family="Georgia, serif" font-size="${title.length > 14 ? 25 : 32}" font-weight="700" fill="#fff" letter-spacing="1">${esc(title)}</text></svg>`);

const FILMS = ['The Long Way Home', 'Paper Lanterns', 'Salt & Cedar', 'Northern Line', 'The Quiet Hours', 'Harbor Lights', 'Field Notes', 'A Year of Rain', 'Ember Valley', 'Second Summer'];
const SERVICES = [['Plex', 'Media', 'plex'], ['Tautulli', 'Media', 'tautulli'], ['Sonarr', 'Media', 'sonarr'], ['Radarr', 'Media', 'radarr'], ['Prowlarr', 'Media', 'prowlarr'], ['Bazarr', 'Media', 'bazarr'], ['qBittorrent', 'Media', 'qbittorrent'],
  ['Home Assistant', 'Home', 'home-assistant'], ['Immich', 'Home', 'immich'], ['Paperless', 'Home', 'paperless'], ['Karakeep', 'Home', 'karakeep'], ['Mealie', 'Home', 'mealie'],
  ['Pi-hole', 'Network', 'pi-hole'], ['Caddy', 'Network', 'caddy'], ['Uptime Kuma', 'Network', 'uptime-kuma']];

export default ({ z, defineIntegration }) => {
  // what visitors change, and when each change lapses. Shared by everyone looking, so nobody can leave it broken.
  const changes = new Map();
  const put = (k, v) => changes.set(k, { v, until: now() + 600_000 });
  const got = (k, fallback) => { const c = changes.get(k); return c && c.until > now() ? c.v : fallback; };

  const mealieUp = () => got('mealie', false);
  const paused = () => got('paused', false);
  const services = () => SERVICES.map(([name, group, icon]) => {
    const ok = name !== 'Mealie' || mealieUp();
    return { name, group, icon: `/api/icon/${icon}`, ok, ms: ok ? 4 + hash(name + Math.floor(now() / 30_000)) % 30 : undefined, detail: ok ? undefined : 'timed out' };
  });

  const CYCLE = 42 * 60_000;
  const downloads = () => {
    if (paused()) return [];
    return [['Harbor Lights', 'S02E05', 1.4], ['Ember Valley', '2024', 6.8]].map(([title, sub, gb], i) => {
      const pct = (.08 + ((now() + i * 1.3e7) % CYCLE) / CYCLE * .9), left = gb * (1 - pct);
      return { title, sub, pct, left, speed: 18 + 9 * Math.sin(now() / 40_000 + i) };
    });
  };
  const STREAM = 118 * 60_000;
  const stream = () => { const at = now() % STREAM; return { title: FILMS[0], year: 2023, pct: at / STREAM, left: Math.round((STREAM - at) / 60_000) }; };

  const rooms = [[1, 'Living Room', 'wood', -280, -200, 290, 220], [2, 'Kitchen', 'tile', 10, -200, 150, 130], [3, 'Dining Room', 'wood', 160, -200, 120, 130], [4, 'Hallway', 'wood', 10, -70, 270, 90],
    [5, 'Office', 'wood', -280, 20, 170, 170], [6, 'Bedroom', 'wood', -110, 20, 210, 170], [7, 'Bathroom', 'tile', 100, 20, 100, 100], [8, 'Laundry', 'tile', 200, 20, 80, 100], [9, 'Guest Room', 'wood', 100, 120, 180, 70]];
  // [room, name, kind, x, z]: each light where it really is, so it lands on what it's meant to
  const LIGHTS = [['Living Room', 'Ceiling', 'pendant', -135, -85], ['Living Room', 'Floor lamp', 'lamp', -262, -38], ['Living Room', 'TV backlight', 'strip', -140, -180],
    ['Kitchen', 'Pendant left', 'pendant', 62, -122], ['Kitchen', 'Pendant right', 'pendant', 108, -122], ['Dining Room', 'Over the table', 'pendant', 220, -140],
    ['Hallway', 'Hall light', 'ceiling', 100, -28], ['Office', 'Desk lamp', 'lamp', -268, 42], ['Office', 'Ceiling', 'ceiling', -195, 110],
    ['Bedroom', 'Bedside left', 'lamp', -92, 36], ['Bedroom', 'Bedside right', 'lamp', 72, 36], ['Bathroom', 'Mirror', 'ceiling', 150, 60], ['Guest Room', 'Ceiling', 'ceiling', 190, 150]];
  const OFF = new Set(['Hallway', 'Bathroom', 'Guest Room', 'Bedroom']);
  const COLOUR = { 'TV backlight': '#7f7bff', 'Desk lamp': '#ffe8d1' };
  const lightId = (room, name) => `light.${room}_${name}`.toLowerCase().replace(/ /g, '_');
  const light = ([room, name, kind, x, z]) => { const id = lightId(room, name), s = got(id, { on: !OFF.has(room), level: 75, color: COLOUR[name] ?? '#ffc58f' });
    return { id, name, kind, at: { x, z }, available: true, canColor: true, canTemp: true, dims: true, ...s }; };
  const FURNITURE = [
    ['Rug', 1, -220, -130, 170, 110], ['Sofa', 1, -215, -68, 160, 48, 180], ['Coffee table', 1, -172, -112, 76, 34], ['TV stand', 1, -215, -196, 150, 16], ['Armchair', 1, -272, -128, 36, 36, 90], ['Plant', 1, -268, -192, 26, 26], ['Bookshelf', 1, -20, -192, 26, 80, 90],
    ['Counter', 2, 16, -196, 100, 22], ['Fridge', 2, 122, -196, 32, 26], ['Kitchen island', 2, 44, -138, 84, 26], ['Stool', 2, 54, -106, 15, 15], ['Stool', 2, 78, -106, 15, 15], ['Stool', 2, 102, -106, 15, 15],
    ['Dining table', 3, 188, -166, 66, 50], ['Chair', 3, 196, -184, 18, 16], ['Chair', 3, 228, -184, 18, 16], ['Chair', 3, 196, -114, 18, 16, 180], ['Chair', 3, 228, -114, 18, 16, 180],
    ['Shelf', 4, 24, -66, 90, 12], ['Rug', 4, 110, -56, 120, 28], ['Plant', 4, 16, -30, 22, 22],
    ['Desk', 5, -272, 28, 110, 40], ['Chair', 5, -232, 72, 30, 28, 180], ['Shelf', 5, -272, 176, 90, 12, 180], ['Plant', 5, -140, 160, 24, 24], ['Rug', 5, -240, 108, 90, 60],
    ['Bed', 6, -60, 28, 110, 118], ['Bedside table', 6, -92, 28, 26, 26], ['Bedside table', 6, 56, 28, 26, 26], ['Rug', 6, -78, 120, 146, 50], ['Wardrobe', 6, -102, 164, 150, 24, 180],
    ['Toilet', 7, 106, 26, 24, 34], ['Sink', 7, 146, 24, 44, 20], ['Bathtub', 7, 106, 78, 88, 36],
    ['Washer', 8, 206, 26, 32, 30], ['Dryer', 8, 242, 26, 32, 30], ['Shelf', 8, 206, 106, 68, 10, 180],
    ['Bed', 9, 208, 124, 64, 60], ['Bedside table', 9, 180, 124, 22, 22], ['Plant', 9, 106, 164, 20, 20],
  ];
  const homeCard = () => ({ type: 'showcase', title: 'Home', icon: 'home', wide: true, items: [],
    visual: { kind: 'home', data: { view: { turn: -30, tilt: -46 },
      rooms: rooms.map(([id, name, floor, x, z, w, d]) => ({ id, name, floor, x, z, w, d, lights: LIGHTS.filter(l => l[0] === name).map(light) })),
      furniture: FURNITURE.map(([type, room, x, z, w, d, angle = 0]) => ({ type, room, angle, x, z, w, d })),
      dock: { x: 262, z: -55, a: 180 },
      robot: { x: 240, z: -40, a: 180, id: 'vacuum.robot', state: 'docked', status: 'Docked', battery: 100, fanSpeed: 'Standard', fanSpeeds: ['Quiet', 'Standard', 'Turbo'], wear: [['Main brush', 82], ['Filter', 64]] } } } });

  const PRESETS = [['white', 'All white', ['#ffffff']], ['ocean', 'Ocean', ['#00c2ff', '#0a5cff']], ['sunset', 'Sunset', ['#ff6b35', '#ff2d78']], ['forest', 'Forest', ['#2fd27a', '#0f7b4f']], ['off', 'All off', ['#000000']]];
  const PRESET_RGB = { white: [255, 255, 255], ocean: [0, 150, 255], sunset: [255, 90, 60], forest: [47, 210, 122], off: [0, 0, 0] };
  const pcCard = () => {
    const preset = got('preset', 'ocean'), part = id => got(`part.${id}`, null);
    const zone = (id, n = 1) => Array.from({ length: n }, () => part(id) ?? { mode: preset === 'off' ? 'Off' : 'Static', color: PRESET_RGB[preset], brightness: 100 });
    const mk = (id, title, n) => ({ id, title, modes: ['Static', 'Breathing', 'Rainbow', 'Off'], zones: zone(id, n) });
    const temp = 42 + 5 * Math.sin(now() / 90_000), gpu = 38 + 6 * Math.sin(now() / 70_000);
    return { type: 'showcase', title: 'Desktop', icon: 'cpu', wide: true, items: [],
      visual: { kind: 'pc-case', data: { parts: [mk('fans0', 'Top fans', 3), mk('fans1', 'Floor fans', 3), mk('pump', 'Cooler', 1), mk('ram', 'Memory', 4), mk('gpu', 'GPU', 1)],
        layout: { fans0: 'top', fans1: 'hidden' }, fans: { fans0: 900, fans1: 760 }, view: { turn: -27, tilt: -18, draggable: true }, controls: true,
        presets: PRESETS.map(([id, name, swatch]) => ({ id, name, swatch })),
        metrics: { pump: [{ label: 'CPU', value: Math.round(temp), unit: '°C', pct: (temp - 25) / 70 }], gpu: [{ label: 'Temp', value: Math.round(gpu), unit: '°C', pct: (gpu - 25) / 65 }, { label: 'Power', value: 42, unit: 'W', pct: .1 }], ram: [{ label: 'In use', value: 21, unit: 'GB', pct: .33 }] },
        build: { ramLabel: 'VALET', board: { label: 'MAPLE', plate: 'STREET', accent: '#7d9cff' }, gpu: { label: 'DEMO', badge: 'VALET' } } } } };
  };

  const day = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const inDays = n => new Date(now() + n * 864e5).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const drives = [['Backup 12 TB', 38, '3.1 years on'], ['Media 8 TB', 41, '1.8 years on'], ['System NVMe', 46, '244 days on']];
  const QUOTES = [['Waste no more time arguing what a good man should be. Be one.', 'Marcus Aurelius', 'Meditations'], ['It is not that we have a short time to live, but that we waste a lot of it.', 'Seneca', 'On the Shortness of Life'], ['Not all those who wander are lost, but the ones with a label maker usually know where they are.', 'The homelab', 'Traditional']];
  const statusCard = (title, icon, items) => ({ type: 'status', title, icon, items });
  const containers = () => ['bazarr', 'caddy', 'home-assistant', 'immich', 'karakeep', 'mealie', 'paperless', 'pi-hole', 'plex', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr', 'tautulli', 'uptime-kuma']
    .map(n => ({ name: n, icon: `/api/icon/${n}`, ok: n !== 'mealie' || mealieUp(), detail: n === 'mealie' && !mealieUp() ? 'exited (137)' : undefined }));
  const LOGS = ['03:11:58 INFO  importing recipe batch (412 items)', '03:12:04 WARN  worker memory at 251 MiB of 256 MiB', '03:12:06 ERROR Out of memory: killed process 41 (gunicorn)', '03:12:06 INFO  container exited with code 137'];

  return defineIntegration({
    type: 'demo-homelab',
    name: 'Made-up homelab',
    config: z.object({}),
    create() {
      const w = (title, interval, fetch) => ({ title, interval, fetch: async () => fetch() });
      const widgets = {
        services: w('Services', 15_000, () => { const s = services(), bad = s.filter(x => !x.ok); return { ...statusCard('Services', 'pulse', s),
          summary: { label: 'Services', icon: 'pulse', value: `${s.length - bad.length}/${s.length}`, tone: bad.length ? 'bad' : 'good', sub: bad.length ? `${bad.map(b => b.name).join(', ')} down` : 'All up' } }; }),
        uptime: w('Uptime', 60_000, () => ({ ...statusCard('Uptime', 'pulse', services().map(({ group, ...s }) => s)), note: '99.8% over 30 days' })),
        containers: w('Containers', 30_000, () => statusCard('Containers', 'disk', containers())),
        drives: w('Drives', 300_000, () => ({ type: 'list', title: 'Drives', icon: 'disk', items: drives.map(([title, t, age]) => ({ title, subtitle: `${t}°C · ${age}`, dot: 'good' })),
          summary: { label: 'Drives', icon: 'disk', value: '46°C', sub: 'All 3 healthy', tone: 'good', marks: drives.map(([title, t]) => ({ pct: (t - 20) / 40, label: `${title} · ${t}°C` })) } })),
        dns: w('Pi-hole', 60_000, () => { const blocked = 9000 + Math.floor((now() % 864e5) / 864e5 * 14000); return { type: 'stats', title: 'Pi-hole', icon: 'shield', pieCenter: '14%',
          pie: [{ label: 'Blocked', value: blocked }, { label: 'Forwarded', value: blocked * 2 }, { label: 'Cached', value: blocked * 4 }], items: [{ label: 'Blocked', value: '14%', tone: 'good' }],
          summary: { label: 'Ads blocked', icon: 'shield', value: blocked.toLocaleString('en'), ring: '14%', tone: 'good', sub: '14% of queries', trend: past(60, 20, 90, 300_000), pct: .14 } }; }),
        updates: w('Updates', 3_600_000, () => ({ type: 'list', title: 'Updates', icon: 'tag', note: '3 in all', items: [{ title: 'immich', subtitle: 'v2.5.0 → v2.6.1' }, { title: 'paperless', subtitle: '3.1.0 → 3.2.0' }, { title: 'karakeep', subtitle: '0.33.2 → 0.34.0' }] })),
        jobs: w('Scheduled jobs', 60_000, () => ({ type: 'list', title: 'Scheduled jobs', icon: 'clock', items: [{ title: 'Nightly backup', subtitle: 'ran 6h ago', meta: 'next 18h' }, { title: 'Photo sync', subtitle: 'ran 12m ago', meta: 'next 3m' }, { title: 'Disk check', subtitle: 'ran 9h ago', meta: 'next 15h' }] })),
        system: w('System', 5_000, () => { const cpu = Math.round(12 + 8 * Math.sin(now() / 30_000)), gpu = Math.round(6 + 5 * Math.sin(now() / 50_000)), gauge = (label, icon, v, detail) => ({ label, icon, value: `${v}%`, ring: `${v}%`, pct: v / 100, tone: 'good', detail });
          return { type: 'stats', title: 'System', icon: 'cpu', items: [{ label: 'CPU', value: cpu, unit: '%' }], summaries: [gauge('CPU', 'cpu', cpu, '44°C'), gauge('Memory', 'memory', 33, '21 of 64 GB'), gauge('GPU', 'gpu', gpu, '38°C'), gauge('Storage', 'disk', 58, '11 of 20 TB')] }; }),
        weather: w('Weather', 900_000, () => ({ type: 'forecast', title: 'Weather', icon: 'cloud-sun', now: { temp: 14, feels: 12, words: 'Partly cloudy', icon: 'cloud-sun', hi: 17, lo: 8 },
          hours: Array.from({ length: 10 }, (_, i) => { const h = new Date(now() + (i + 1) * 36e5); return { time: h.toLocaleTimeString('en', { hour: 'numeric' }).replace(' ', '').toLowerCase(), temp: 14 + Math.round(3 * Math.sin(i / 3)), icon: i > 6 ? 'rain' : 'cloud-sun', pop: i > 6 ? 40 : 0 }; }),
          summary: { label: 'Partly cloudy', icon: 'cloud-sun', value: '14°', pct: .6, tone: 'good', detail: 'H 17° · L 8°' } })),
        pc: w('Desktop', 30_000, pcCard),
        home: w('Home', 15_000, homeCard),
        streams: w('Now playing', 10_000, () => { const s = stream(); return { type: 'media', title: 'Now playing', icon: 'play', note: '1 stream · 12 Mbps',
          items: [{ title: s.title, subtitle: String(s.year), image: poster(s.title), backdrop: photo(`${s.title}b`, 1280, 720), pct: s.pct, state: 'playing', user: 'Sam', device: 'Living room TV', tags: ['4K', 'Direct Play', '12 Mbps'], remaining: `${s.left} min left` }],
          activity: { title: s.title, subtitle: 'Sam · Living room TV', image: poster(s.title), icon: 'play', pct: s.pct, trailing: `${s.left}m left` } }; }),
        downloads: w('Downloads', 5_000, () => { const d = downloads(), speed = d.reduce((a, t) => a + t.speed, 0), first = d[0];
          return { type: 'media', title: 'Downloading', icon: 'download', note: d.length ? `${d.length} downloads · ↓ ${speed.toFixed(0)} MB/s` : undefined, empty: 'Paused for ten minutes',
            items: d.map(t => ({ title: t.title, subtitle: t.sub, image: poster(t.title), backdrop: photo(`${t.title}b`, 1280, 720), pct: t.pct, state: 'playing', icon: 'download', tags: ['1080p', `${t.speed.toFixed(0)} MB/s`, `${t.left.toFixed(1)} GB left`], remaining: `${Math.floor(t.pct * 100)}%` })),
            summary: { label: 'Downloads', icon: 'download', value: `${speed.toFixed(0)} MB/s`, sub: d.length ? `${d.length} active` : 'Paused' },
            activity: first && { title: `${first.title}${d.length > 1 ? ` +${d.length - 1}` : ''}`, subtitle: `↓ ${speed.toFixed(0)} MB/s`, image: poster(first.title), icon: 'download', pct: first.pct, count: d.length } }; }),
        sky: w('Daylight', 300_000, () => ({ type: 'schedule', title: 'Daylight', icon: 'sun', muted: ['Dawn', 'Dusk'], items: [['Dawn', 6, 41], ['Sunrise', 7, 12], ['Noon', 12, 48], ['Sunset', 18, 2], ['Dusk', 18, 33]].map(([name, h, m]) => ({ name, at: day(h, m) })) })),
        photos: w('Photos', 3_600_000, () => ({ type: 'photos', style: 'flashback', title: 'On this day', icon: 'image', items: [['2 years ago', 'Lake Louise'], ['3 years ago', 'Isle of Skye'], ['5 years ago', 'Patagonia'], ['6 years ago', 'Banff']].map(([badge, title], i) => ({ image: photo(`photo${i}`), badge, title })) })),
        quote: w('Quote', 3_600_000, () => { const [q, who, from] = QUOTES[Math.floor(now() / 864e5) % QUOTES.length]; return { type: 'verse', title: 'A thought for today', icon: 'book', english: q, reference: who, meaning: from }; }),
        upcoming: w('Coming up', 900_000, () => ({ type: 'list', title: 'Coming up', icon: 'film', items: [{ title: FILMS[7], subtitle: inDays(3) }],
          summary: { label: 'Coming up', icon: 'film', value: FILMS[7], sub: inDays(3), image: photo(`${FILMS[7]}b`, 1280, 720) } })),
        ai: w('AI', 60_000, () => ({ type: 'stats', title: 'AI', icon: 'chart', items: [{ label: 'Requests', value: 312 }],
          summaries: [{ label: 'Requests', icon: 'pulse', value: '312', sub: 'today', trend: past(40, 2, 30, 120_000) }, { label: 'Tokens', icon: 'text', value: '84k', sub: 'generated today', trend: past(40, 10, 60, 120_000) }, { label: 'Power', icon: 'gpu', value: '38 W', sub: 'idle', trend: past(40, 30, 90, 120_000) }, { label: 'Cost today', icon: 'coins', value: '0¢', sub: 'it runs at home' }] })),
        library: w('Library', 3_600_000, () => ({ type: 'stats', title: 'Library', icon: 'film', items: [{ label: 'Movies', value: 412 }], summaries: [{ label: 'Movies', icon: 'film', value: '412' }, { label: 'Shows', icon: 'play', value: '38', sub: '164 seasons' }, { label: 'Episodes', icon: 'pulse', value: '2,986' }, { label: 'Plays', icon: 'chart', value: '57', sub: 'last 30 days', trend: past(30, 0, 6, 864e5) }] })),
        recent: w('Recently added', 3_600_000, () => ({ type: 'shelf', title: 'Recently added', icon: 'film', aspect: 'poster', layout: 'spotlight', source: { name: 'Plex', icon: '/api/icon/plex' },
          items: FILMS.slice(1, 9).map((title, i) => ({ title, subtitle: `${2024 - i}`, image: poster(title), backdrop: photo(`${title}b`, 1280, 720), badge: i < 2 ? 'Today' : 'This week' })) })),
        mostwatched: w('Most watched', 3_600_000, () => ({ type: 'ranked', title: 'Most watched', icon: 'film', source: { name: 'Plex', icon: '/api/icon/plex' }, note: 'last 30 days',
          items: [[FILMS[5], '9 plays', '14h', 1], [FILMS[2], '4 plays', '7h', .5], [FILMS[3], '3 plays', '5h', .36], [FILMS[1], '2 plays', '3h', .22]].map(([title, subtitle, value, pct], i) => ({ title, subtitle, value, pct, image: i ? undefined : poster(title), backdrop: i ? undefined : photo(`${title}b`, 800, 400) })) })),
        plays: w('Plays', 3_600_000, () => ({ type: 'chart', title: 'Plays', icon: 'chart', headline: '57', unit: 'plays', span: 'last 30 days', from: now() - 30 * 864e5, to: now(), series: [{ name: 'TV', points: past(30, 0, 5, 864e5) }, { name: 'Movies', points: past(30, 0, 3, 7e7) }] })),
        people: w("Who's watching", 3_600_000, () => ({ type: 'list', title: "Who's watching", icon: 'play', note: 'last 30 days', items: [['Sam', '31 plays', '22h', 1], ['Alex', '17 plays', '11h', .5], ['Priya', '9 plays', '6h', .27]].map(([title, subtitle, meta, pct]) => ({ title, subtitle, meta, pct })) })),
        week: w('Coming up', 3_600_000, () => ({ type: 'shelf', title: 'Coming up', icon: 'film', aspect: 'poster', layout: 'week', items: [['Tonight', FILMS[5]], ['Tomorrow', FILMS[4]], [inDays(3), FILMS[7]]].map(([badge, title]) => ({ badge, title, subtitle: 'New episode', image: poster(title) })) })),
        requests: w('Requested', 3_600_000, () => ({ type: 'shelf', title: 'Requested', icon: 'film', aspect: 'poster', layout: 'tickets', items: [[FILMS[8], 'Downloading', 'accent'], [FILMS[9], 'Available', 'good'], [FILMS[6], 'Available', 'good'], [FILMS[3], 'Available', 'good']].map(([title, badge, tone]) => ({ title, subtitle: 'Movie', badge, tone, image: poster(title) })) })),
        docs: w('Recent documents', 3_600_000, () => ({ type: 'list', title: 'Recent documents', icon: 'file', items: [['Home insurance renewal', 'Northwind Mutual', 'Oct 2'], ['Electricity bill', 'City Power', 'Sep 28'], ['Furnace service receipt', 'Warm & Co', 'Sep 12'], ['Passport renewal', 'Government', 'Aug 30']].map(([title, subtitle, meta]) => ({ title, subtitle, meta })) })),
        saved: w('Recently saved', 3_600_000, () => ({ type: 'list', title: 'Recently saved', icon: 'bookmark', items: [['How to back up a homelab properly', 'blog.example.com', 'Three copies, two kinds of storage, one somewhere else. The part most people skip is testing the restore.', 'Yesterday'], ['A field guide to Zigbee', 'example.org', 'Why your sensors drop off the network, and what mesh routing actually needs.', 'Oct 24']].map(([title, subtitle, detail, meta]) => ({ title, subtitle, detail, meta })) })),
        news: w('Hacker News', 1_800_000, () => ({ type: 'list', title: 'Hacker News', icon: 'news', items: [['Show HN: I replaced my NAS with three old laptops', '412 points · 188 comments', '3h'], ['The surprising durability of cheap SSDs', '287 points · 96 comments', '6h'], ['Why self-hosted email is hard, in one diagram', '241 points · 140 comments', '9h'], ['A tiny DNS server in 500 lines', '198 points · 42 comments', '12h']].map(([title, subtitle, meta]) => ({ title, subtitle, meta })) })),
        feeds: w('Feeds', 1_800_000, () => ({ type: 'list', title: 'Feeds', icon: 'rss', items: [['This week in open-source home automation', 'The Example Times', '1h'], ['Quiet fans, ranked', 'Hardware Weekly', '4h'], ['Ten small scripts that run my house', 'Personal blog', '8h'], ['Solar panels and home servers: the numbers', 'Example Energy', '1d']].map(([title, subtitle, meta]) => ({ title, subtitle, meta })) })),
        releases: w('Releases', 3_600_000, () => ({ type: 'list', title: 'Releases', icon: 'tag', items: [['paperless', '3.2.0', 'Yesterday'], ['immich', 'v2.6.1', 'Oct 21'], ['home-assistant', '2026.10.4', 'Oct 18'], ['karakeep', '0.34.0', 'Oct 15']].map(([title, subtitle, meta]) => ({ title, subtitle, meta })) })),
      };
      const textCard = text => ({ type: 'text', tone: 'good', text });
      return {
        widgets,
        actions: {
          preset: { description: 'Apply a lighting preset', input: z.object({ id: z.string() }), run: async ({ id }) => { if (PRESET_RGB[id]) { put('preset', id); for (const p of ['fans0', 'fans1', 'pump', 'ram', 'gpu']) changes.delete(`part.${p}`); } } },
          light: { description: 'Set a PC part or some home lights', input: z.object({ part: z.string().optional(), state: z.object({}).loose().optional(), entity_id: z.array(z.string()).optional() }).loose(),
            run: async ({ part, state, entity_id, on, brightness, rgb }) => {
              const color = rgb && `#${rgb.map(v => Number(v).toString(16).padStart(2, '0')).join('')}`;
              if (part && /^(fans[01]|pump|ram|gpu)$/.test(part)) put(`part.${part}`, { mode: 'Static', brightness: 100, color: [255, 255, 255], ...state });
              for (const id of (entity_id ?? []).slice(0, 13)) { const was = LIGHTS.find(l => lightId(l[0], l[1]) === id); if (was) { const now_ = light(was); put(id, { on: on ?? now_.on, level: brightness ?? now_.level, color: color ?? now_.color }); } }
            } },
          vacuum: { description: 'Pretend to send the vacuum', input: z.object({}).loose(), run: async () => {} },
        },
        tools: {
          service_status: { label: 'Checked services', live: true, access: 'read', input: z.object({}), description: 'Whether each service is up.',
            run: async () => ({ data: { services: services().map(({ name, ok, detail }) => ({ name, ok, detail })) }, card: await widgets.services.fetch() }) },
          container_logs: { label: 'Read the logs', access: 'read', input: z.object({ name: z.string().default('mealie') }), description: 'Recent logs of a container.',
            run: async () => ({ data: { lines: LOGS }, card: { type: 'code', title: 'mealie logs', lines: LOGS } }) },
          restart_service: { label: 'Restarted a service', access: 'control', input: z.object({ name: z.string().default('Mealie') }), description: 'Restart a service.', undo: undefined,
            run: async () => { put('mealie', true); return { data: { done: true }, card: textCard('Mealie is back up.') }; } },
          downloads_status: { label: 'Checked downloads', live: true, access: 'read', input: z.object({}), description: 'Unfinished downloads.',
            run: async () => { const d = downloads(); return { data: { speed: `${d.reduce((a, t) => a + t.speed, 0).toFixed(0)} MB/s`, torrents: d.map(t => ({ name: t.title, progress: `${Math.floor(t.pct * 100)}%`, left: `${Math.max(1, Math.round(t.left / (t.speed / 1000) / 60))} min` })) }, card: await widgets.downloads.fetch() }; } },
          pause_downloads: { label: 'Paused downloads', access: 'control', input: z.object({}), description: 'Pause every download.', run: async () => { put('paused', true); return { data: { done: true }, card: textCard('Downloads paused.') }; } },
          plex_streams: { label: "Checked what's playing", live: true, access: 'read', input: z.object({}), description: 'Who is watching what.',
            run: async () => { const s = stream(); return { data: { streams: [{ user: 'Sam', title: s.title, device: 'living room TV', left: `${s.left} minutes` }] }, card: await widgets.streams.fetch() }; } },
          plex_stats: { label: "Checked what's popular", access: 'read', input: z.object({}), description: 'Most watched lately and what is new.', run: async () => ({ data: { top: FILMS[5], unwatched: FILMS[1] }, card: await widgets.mostwatched.fetch() }) },
          drive_health: { label: 'Checked the drives', access: 'read', input: z.object({}), description: 'Disk health.', run: async () => ({ data: { drives, hottest: 'the system NVMe at 46°C' }, card: await widgets.drives.fetch() }) },
          system_status: { label: 'Checked the server', access: 'read', input: z.object({}), description: 'CPU, memory and GPU.', run: async () => ({ data: { cpu: '12%', memory: '33%', gpu: '6%' }, card: { type: 'chart', title: 'CPU', unit: '%', span: 'last hour', from: now() - 36e5, to: now(), series: [{ name: 'CPU', points: past(60, 6, 30) }] } }) },
          set_lights: { label: 'Changed the lights', access: 'control', input: z.object({ room: z.string().default('Living Room'), on: z.boolean().default(false) }), description: 'Turn a room on or off.',
            run: async ({ room, on }) => { for (const l of LIGHTS.filter(x => x[0] === room)) put(lightId(l[0], l[1]), { on, level: on ? 75 : 0, color: light(l).color }); return { data: { done: true }, card: textCard(`${room} lights ${on ? 'on' : 'off'}.`) }; } },
          what_happened: { label: 'Looked back', access: 'read', input: z.object({}), description: 'What happened recently.', run: async () => ({ data: { summary: 'Mealie ran out of memory at 3:12 AM, the backup finished at 4:00, and two episodes arrived.' }, card: { type: 'list', title: 'Overnight', icon: 'clock', items: [{ title: 'Mealie stopped', subtitle: 'Out of memory', meta: '3:12 AM', tone: 'bad' }, { title: 'Backup finished', subtitle: '41 GB, verified', meta: '4:00 AM' }, { title: 'Two new episodes', subtitle: 'Harbor Lights', meta: '5:30 AM' }] } }) },
        },
      };
    },
  });
};
