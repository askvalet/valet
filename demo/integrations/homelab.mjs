import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
// A made-up homelab, for the public demo. Every number and person is invented; the films, albums and books are real ones
// so the page reads like a real home, their art linked from art/art.json. It moves on its own (streams play, downloads fill, graphs
// wander) from the clock alone, and whatever a visitor changes puts itself back after ten minutes.
// The camera footage is real, free and credited too: art/cameras/CREDITS.md.
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
const drawn = title => uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">${scene(300, 450, title)}<rect y="300" width="300" height="150" fill="#000" opacity=".28"/>
<text x="150" y="${title.length > 14 ? 372 : 384}" text-anchor="middle" font-family="Georgia, serif" font-size="${title.length > 14 ? 25 : 32}" font-weight="700" fill="#fff" letter-spacing="1">${esc(title)}</text></svg>`);

const poster = title => ART.films[title]?.poster ?? drawn(title);
const backdrop = title => ART.films[title]?.backdrop ?? photo(`${title}b`, 1280, 720);
const dir = existsSync('/demo/art') ? '/demo/art' : resolve('demo/art');
const ART = JSON.parse(readFileSync(`${dir}/art.json`, 'utf8'));
/** A scanned page: letterhead, the details, a table if it has one. Real enough at thumbnail size. */
const paper = ({ org, title, date, color, lines = [], rows = [], total }) => {
  const line = (y, w, o = .16) => `<rect x="44" y="${y}" width="${w}" height="6" rx="3" fill="#1f2430" opacity="${o}"/>`;
  const table = rows.map(([a, b], i) => `<text x="44" y="${322 + i * 30}" font-size="15" fill="#39404f">${esc(a)}</text><text x="456" y="${322 + i * 30}" font-size="15" fill="#39404f" text-anchor="end">${esc(b)}</text><rect x="44" y="${332 + i * 30}" width="412" height="1" fill="#1f2430" opacity=".1"/>`).join('');
  const after = 322 + rows.length * 30;
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 647" font-family="Helvetica, Arial, sans-serif"><rect width="500" height="647" fill="#fbfaf6"/><rect width="500" height="10" fill="${color}"/>
<circle cx="62" cy="62" r="18" fill="${color}"/><text x="92" y="58" font-size="19" font-weight="700" fill="#1f2430">${esc(org)}</text>${line(68, 110)}
<text x="456" y="58" font-size="13" fill="#6a7180" text-anchor="end">${esc(date)}</text>
<text x="44" y="150" font-size="27" font-weight="700" fill="#1f2430">${esc(title)}</text>${line(172, 300)}${line(188, 340)}${line(204, 220)}
${lines.map((l, i) => `<text x="44" y="${246 + i * 21}" font-size="14" fill="#555c6b">${esc(l)}</text>`).join('')}${table}
${total ? `<text x="456" y="${after + 34}" font-size="23" font-weight="700" fill="#1f2430" text-anchor="end">${esc(total)}</text>` : ''}
${[0, 1, 2, 3].map(i => line(after + 72 + i * 16, 412 - i * 44, .1)).join('')}</svg>`);
};
const PAPERS = [
  { title: 'Home insurance renewal', org: 'Northwind Mutual', date: 'Oct 2', color: '#1f6f8b', lines: ['Policy HM-20418, 14 Maple Street'], rows: [['Dwelling', '$612.00'], ['Contents', '$214.00'], ['Liability', '$96.00']], total: '$922.00' },
  { title: 'Electricity bill', org: 'City Power', date: 'Sep 28', color: '#e0a100', lines: ['Billing period Aug 28 to Sep 27'], rows: [['Usage, 612 kWh', '$81.40'], ['Delivery', '$32.10']], total: '$113.50', badge: 'Paid' },
  { title: 'Furnace service', org: 'Warm & Co', date: 'Sep 12', color: '#c8553d', lines: ['Annual inspection and filter'], rows: [['Labour', '$120.00'], ['Filter, MERV 13', '$34.00']], total: '$154.00', badge: 'Paid' },
  { title: 'Passport renewal', org: 'Government', date: 'Aug 30', color: '#3b4a8c', lines: ['Application received', 'Reference 8841-2206-117'] },
  { title: 'Vet checkup', org: 'Maple Vet Clinic', date: 'Aug 14', color: '#3f8f6b', lines: ['Patient: Biscuit'], rows: [['Exam', '$75.00'], ['Vaccines', '$48.00']], total: '$123.00' },
  { title: 'Lease agreement', org: 'Oak Property', date: 'Jul 1', color: '#6b4fa0', lines: ['Term: 12 months', '14 Maple Street'] },
  { title: 'Bike warranty', org: 'Trail Cycles', date: 'Jun 18', color: '#2e7d4f', lines: ['Frame: lifetime', 'Parts: two years'] },
  { title: 'Internet plan', org: 'Fibre North', date: 'Jun 2', color: '#0077c8', rows: [['Gigabit, monthly', '$69.00']], total: '$69.00' },
];
const FILMS = ['Spider-Man: Brand New Day', 'The Bear', 'Arrival', 'Interstellar', 'Blade Runner 2049', 'Severance', 'Spirited Away', 'Andor', 'Shōgun', 'The Grand Budapest Hotel'];
const STACK = ['plex', 'tautulli', 'sonarr', 'radarr', 'prowlarr', 'bazarr', 'qbittorrent', 'navidrome', 'lidarr', 'komga', 'audiobookshelf', 'miniflux', 'immich', 'paperless', 'karakeep', 'mealie', 'tandoor-recipes', 'home-assistant', 'frigate', 'nextcloud', 'syncthing', 'vaultwarden', 'authentik', 'crowdsec', 'pi-hole', 'tailscale', 'caddy', 'nginx-proxy-manager', 'uptime-kuma', 'grafana', 'changedetection', 'forgejo', 'proxmox', 'portainer'];
const SETBACKS = { home: 20, sleep: 18, night: 17 };
const pad = n => String(n).padStart(2, '0');
const dateOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A season's worth of plausible weather: every day is the same for everyone, and today is always today. */
const skyOn = (offset = 0) => {
  const d = new Date(now() + offset * 864e5), r = rng(`sky${dateOf(d)}`), year = (d - new Date(d.getFullYear(), 0, 20)) / 864e5 / 365;
  const hi = Math.round(10 - 15 * Math.cos(year * 2 * Math.PI) + r() * 6 - 3), lo = hi - 5 - Math.round(r() * 5), pick = r();
  const [words, icon, pop] = pick < .3 ? ['Cloudy', 'cloud', 15] : pick < .55 ? ['Partly cloudy', 'cloud-sun', 5] : pick < .75 ? ['Sunny', 'sun', 0] : pick < .9 ? (hi < 2 ? ['Snow', 'snow', 70] : ['Rain', 'rain', 70]) : pick < .96 ? ['Fog', 'fog', 20] : ['Thunderstorms', 'storm', 80];
  return { words, icon, pop, hi, lo };
};
const FAMILY = ['Family', '#5ac8fa'], WORK = ['Work', '#ff9f6b'], HOME = ['Home', '#bf8bff'];
const WEEK = { 1: [['Daycare drop-off', 8, 30, 20, FAMILY], ['Team standup', 9, 30, 15, WORK]], 2: [['Daycare drop-off', 8, 30, 20, FAMILY], ['Bins out', 19, 0, 10, HOME]],
  3: [['Daycare drop-off', 8, 30, 20, FAMILY], ['Design review', 14, 0, 60, WORK], ['Daycare pick-up', 16, 45, 30, FAMILY]], 4: [['Daycare drop-off', 8, 30, 20, FAMILY], ['Planning', 11, 0, 45, WORK], ['Piano practice', 17, 30, 30, FAMILY]],
  5: [['Daycare drop-off', 8, 30, 20, FAMILY], ['Daycare pick-up', 16, 0, 30, FAMILY], ['Pizza night', 18, 0, 90, HOME]], 6: [['Swimming lessons', 10, 0, 45, FAMILY], ['Farmers market', 12, 0, 60, HOME]], 0: [['Groceries', 9, 30, 60, HOME], ['Meal prep', 16, 0, 90, HOME]] };
const NOW_AND_THEN = [['Dentist', 15, 0, 45, FAMILY], ['Vet check-up', 10, 30, 30, HOME], ['Parent-teacher meeting', 17, 0, 30, FAMILY], ['Furnace service', 13, 0, 120, HOME], ['Dinner with the neighbours', 18, 30, 150, FAMILY], ['Haircut', 12, 30, 30, FAMILY], ['Quarterly review', 15, 30, 60, WORK], ['Book club', 19, 30, 90, HOME]];
const SERVICES = [['Plex', 'Media', 'plex'], ['Tautulli', 'Media', 'tautulli'], ['Sonarr', 'Media', 'sonarr'], ['Radarr', 'Media', 'radarr'], ['Prowlarr', 'Media', 'prowlarr'], ['Bazarr', 'Media', 'bazarr'], ['qBittorrent', 'Media', 'qbittorrent'],
  ['Home Assistant', 'Home', 'home-assistant'], ['Immich', 'Home', 'immich'], ['Paperless', 'Home', 'paperless'], ['Karakeep', 'Home', 'karakeep'], ['Mealie', 'Home', 'mealie'],
  ['Pi-hole', 'Network', 'pi-hole'], ['Caddy', 'Network', 'caddy'], ['Uptime Kuma', 'Network', 'uptime-kuma']];

// [id, name, seconds, [[label, score, event thumbnail, logged every n loops, [t, x, y, w, h] traced over the clip]]]. Each clip
// loops in step with the clock, so everyone sees the same moment and the boxes land on what's really there.
const CAMERAS = [
  ['street', 'Street', 12, [
    ['Car', .94, 'ev-car', 5, [[1.2,.078,.604,.063,.083],[1.75,.115,.615,.078,.094],[2.25,.151,.62,.083,.104],[3,.208,.625,.099,.115],[3.75,.292,.635,.156,.135],[4.5,.396,.625,.208,.188],[4.75,.49,.635,.198,.208],[5.25,.677,.656,.292,.25],[5.5,.813,.667,.187,.26],[5.7,.938,.667,.062,.26]]],
    ['Person', .81, 'ev-person', 7, [[6,0,.573,.052,.156],[7.5,.016,.568,.073,.156],[8.25,.083,.594,.073,.141],[9,.099,.604,.068,.13],[10,.151,.604,.073,.13],[10.75,.161,.604,.078,.13],[11.1,.177,.604,.078,.13]]],
    ['Car', .91, null, 0, [[11,.375,.635,.146,.167],[11.25,.406,.646,.198,.198],[11.75,.542,.625,.312,.25],[12,.677,.656,.323,.26],[12.25,.844,.667,.156,.25],[12.5,.948,.667,.052,.25]]]]],
  ['driveway', 'Driveway', 12, [
    ['Car', .96, 'ev-driveway', 6, [[6.5,.69,.39,.06,.11],[7.5,.69,.39,.06,.11],[8.25,.66,.4,.08,.12],[8.5,.64,.4,.09,.14],[9,.6,.39,.13,.15],[9.25,.56,.36,.14,.21],[9.75,.46,.31,.2,.29],[10,.39,.35,.22,.25],[10.5,0,.31,.5,.47],[10.75,0,.22,.41,.66],[10.95,0,.2,.22,.7]]]]],
  ['gate', 'Side gate', 12, [
    ['Fox', .88, 'ev-fox', 9, [[0,.23,.48,.29,.46],[1.5,.24,.54,.32,.4],[2.5,.2,.63,.41,.32],[4,.22,.68,.41,.29],[5.25,.25,.61,.37,.33],[6.75,.25,.58,.37,.38],[7.5,.29,.5,.33,.47],[8.25,.46,.51,.2,.35],[9,.55,.48,.12,.34],[10,.53,.47,.12,.27],[10.75,.49,.47,.11,.22],[10.95,.49,.47,.11,.22]]],
    ['Fox', .88, null, 0, [[11.45,.25,.46,.27,.46],[12,.23,.48,.29,.46]]]]],
  ['backyard', 'Backyard', 12, [
    ['Raccoon', .9, 'ev-raccoon', 13, [[11.45,.429,.412,.424,.588],[12,.418,.4,.4,.588],[13.5,.465,.412,.365,.576],[15,.406,.412,.447,.553],[16.75,.429,.412,.424,.553],[17.25,.429,.318,.412,.588],[18,.406,.4,.447,.576],[19,.418,.376,.459,.576],[19.75,.418,.329,.459,.576],[20.5,.382,.153,.529,.553],[21,.382,.176,.529,.588],[21.75,.441,.141,.482,.565],[22,.476,.212,.424,.576],[22.5,.641,.329,.341,.565],[22.75,.724,.341,.271,.553],[23.1,.794,.318,.206,.553]]]]],
  ['feeder', 'Feeder', 11.5, [
    ['Bird', .97, null, 0, [[10.95,.24,.083,.521,.833],[11.5,.271,.083,.49,.833],[12,.24,.146,.521,.542],[13.1,.24,.146,.521,.542]]],
    ['Bird', .9, null, 0, [[13.9,.604,.083,.167,.344],[15.4,.625,.104,.146,.312]]],
    ['Bird', .95, 'ev-bird', 8, [[4.6,.5,.167,.271,.479],[5.7,.438,.146,.333,.479],[6.2,.292,.167,.49,.542],[7,.24,.104,.521,.625],[7.7,.26,.042,.49,.854],[8.3,.24,.167,.521,.583],[9.2,.229,.208,.521,.479],[9.8,.271,.125,.49,.833],[10.2,.292,.188,.469,.625]]]]],
];
const CLIPS = new Set(CAMERAS.flatMap(([id, , , seen]) => [`${id}.mp4`, `${id}.jpg`, ...seen.flatMap(s => s[2] ? [`${s[2]}.jpg`] : [])]));
/** What the cameras noticed: a row for each of the last few passes the clock says have happened. */
const sightings = () => CAMERAS.flatMap(([camera, name, loop, seen]) => seen.flatMap(([label, score, image, every, keys]) => {
  if (!image) return [];
  const start = keys[0][0], period = every * loop, last = Math.floor((now() / 1000 - start) / period) * period + start;
  return [0, 1].map(n => ({ camera, name, label, score, image, at: (last - n * period) * 1000 }));
})).sort((a, b) => b.at - a.at).slice(0, 10);

export default ({ z, defineIntegration }) => {
  // what visitors change, and when each change lapses. Shared by everyone looking, so nobody can leave it broken.
  const changes = new Map();
  const put = (k, v) => changes.set(k, { v, until: now() + 600_000 });
  const got = (k, fallback) => { const c = changes.get(k); return c && c.until > now() ? c.v : fallback; };

  const weather = () => {
    const d = new Date(now()), today = skyOn(), h = d.getHours() + d.getMinutes() / 60, night = h < 6.5 || h > 19;
    const tempAt = hour => Math.round(today.lo + (today.hi - today.lo) * (.5 + .5 * Math.sin((hour - 9) / 24 * 2 * Math.PI)));
    const dark = (icon, hour) => hour % 24 < 6.5 || hour % 24 > 19 ? { sun: 'moon', 'cloud-sun': 'cloud-moon' }[icon] ?? icon : icon, temp = tempAt(h), icon = dark(today.icon, h);
    const words = night && today.words === 'Sunny' ? 'Clear' : today.words;
    return { type: 'forecast', title: 'Weather', icon, now: { temp, feels: temp - 2, words, icon, hi: today.hi, lo: today.lo },
      hours: Array.from({ length: 12 }, (_, i) => { const at = new Date(now() + (i + 1) * 36e5), hour = at.getHours(); return { time: at.toLocaleTimeString('en', { hour: 'numeric' }).replace(' ', '').toLowerCase(), temp: tempAt(hour), icon: dark(today.icon, hour), pop: today.pop }; }),
      days: [1, 2, 3, 4, 5].map(n => { const s = skyOn(n); return { name: new Date(now() + n * 864e5).toLocaleDateString('en', { weekday: 'short' }), icon: s.icon, hi: s.hi, lo: s.lo, pop: s.pop }; }),
      summary: { label: words, icon, value: `${temp}°`, pct: today.hi > today.lo ? (temp - today.lo) / (today.hi - today.lo) : .5, tone: 'good', detail: `H ${today.hi}° · L ${today.lo}°` } };
  };
  const calendar = () => {
    const d = new Date(now()), first = new Date(d.getFullYear(), d.getMonth() - 1, 1), last = new Date(d.getFullYear(), d.getMonth() + 7, 0), events = [];
    const timed = (day, [title, h, m, mins, [calendar, color]]) => { const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m); events.push({ title, start: start.toISOString(), end: new Date(+start + mins * 6e4).toISOString(), calendar, color }); };
    for (let day = new Date(first), n = 0; day <= last; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1), n++) {
      for (const e of WEEK[day.getDay()]) timed(day, e);
      const r = rng(`cal${dateOf(day)}`);
      if (r() < .1) timed(day, NOW_AND_THEN[Math.floor(r() * NOW_AND_THEN.length)]);
      if (day.getDay() === 5 && r() < .13) { const back = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 3); events.push({ title: r() < .5 ? 'Grandparents visiting' : 'Cottage weekend', start: dateOf(day), end: dateOf(back), calendar: FAMILY[0], color: FAMILY[1] }); }
    }
    events.sort((a, b) => a.start < b.start ? -1 : 1);
    const today = events.filter(e => e.start.length > 10 && new Date(e.start).toDateString() === d.toDateString()), next = events.find(e => e.start.length > 10 && new Date(e.end) > d);
    const clock = iso => new Date(iso).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
    return { type: 'calendar', title: 'Calendar', icon: 'calendar', events, from: dateOf(first), to: dateOf(last),
      summary: { label: 'Calendar', icon: 'calendar', value: next?.title ?? 'Free', sub: next ? `${new Date(next.start).toDateString() === d.toDateString() ? 'Today' : new Date(next.start).toLocaleDateString('en', { weekday: 'long' })} · ${clock(next.start)}` : undefined, detail: today.length ? `${today.length} today` : undefined } };
  };
  // the house at rest, or as a visitor left it; a changed target pulls the room towards it over a few minutes
  const roomAt = target => target + Math.round(2 * Math.sin(now() / 54e5)) / 10;
  const climate = () => {
    const was = got('thermostat', null), preset = was?.preset ?? (new Date(now()).getHours() < 7 || new Date(now()).getHours() >= 22 ? 'sleep' : 'home'), power = was?.power ?? true, target = was?.target ?? SETBACKS[preset];
    const room = was ? Math.round((target + (was.from - target) * Math.exp(-(now() - was.at) / 2e5)) * 10) / 10 : roomAt(target);
    return { preset, power, target, room };
  };
  const thermostat = () => {
    const { preset, power, target, room } = climate(), state = !power ? 'Off' : room < target - .1 ? 'Heating' : 'Idle';
    return { type: 'thermostat', title: 'Hallway', icon: 'home', unit: 'C', state, mode: power ? 'heat' : 'off', current: room, target: power ? target : undefined, min: 10, max: 30, step: .5, set: power ? { action: 'thermostat' } : undefined,
      modes: [{ id: 'off', label: power ? 'Turn off' : 'Turn on', on: !power, action: 'thermostat', args: { power: !power } }, ...[['home', 'Home'], ['sleep', 'Sleep'], ['night', 'Night']].map(([id, label]) => ({ id, label, on: power && preset === id, action: 'thermostat', args: { preset: id } }))],
      summary: { label: 'Hallway', icon: 'thermometer', value: `${(power ? target : room).toFixed(1)}°`, sub: state, detail: power ? `${room.toFixed(1)}° now` : undefined, pct: (target - 10) / 20 } };
  };
  const mealieUp = () => got('mealie', false);
  const paused = () => got('paused', false);
  const services = () => SERVICES.map(([name, group, icon]) => {
    const ok = name !== 'Mealie' || mealieUp();
    return { name, group, icon: `/api/icon/${icon}`, ok, ms: ok ? 4 + hash(name + Math.floor(now() / 30_000)) % 30 : undefined, detail: ok ? undefined : 'timed out' };
  });

  const CYCLE = 42 * 60_000;
  const downloads = () => {
    if (paused()) return [];
    return [['Andor', 'S02E05', 1.4], ['Oppenheimer', '2023', 6.8]].map(([title, sub, gb], i) => {
      const pct = (.08 + ((now() + i * 1.3e7) % CYCLE) / CYCLE * .9), left = gb * (1 - pct);
      return { title, sub, pct, left, speed: 18 + 9 * Math.sin(now() / 40_000 + i) };
    });
  };
  const STREAM = 118 * 60_000;
  const stream = () => { const at = now() % STREAM; return { title: FILMS[0], year: ART.films[FILMS[0]].year, pct: at / STREAM, left: Math.round((STREAM - at) / 60_000) }; };

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
  const ymd = n => { const d = new Date(now() + n * 864e5); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(x => String(x).padStart(2, '0')).join('-'); };
  const inDays = n => new Date(now() + n * 864e5).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const drives = [['Backup 12 TB', 38, '3.1 years on'], ['Media 8 TB', 41, '1.8 years on'], ['System NVMe', 46, '244 days on']];
  const statusCard = (title, icon, items) => ({ type: 'status', title, icon, items });
  const containers = () => ['bazarr', 'caddy', 'home-assistant', 'immich', 'karakeep', 'mealie', 'paperless', 'pi-hole', 'plex', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr', 'tautulli', 'uptime-kuma']
    .map(n => ({ name: n, icon: `/api/icon/${n}`, ok: n !== 'mealie' || mealieUp(), detail: n === 'mealie' && !mealieUp() ? 'exited (137)' : undefined }));
  const LOGS = ['03:11:58 INFO  importing recipe batch (412 items)', '03:12:04 WARN  worker memory at 251 MiB of 256 MiB', '03:12:06 ERROR Out of memory: killed process 41 (gunicorn)', '03:12:06 INFO  container exited with code 137'];

  return defineIntegration({
    type: 'demo-homelab',
    name: 'Made-up homelab',
    config: z.object({ art: z.string().default('/demo/art/cameras') }),
    create(cfg, ctx) {
      const w = (title, interval, fetch) => ({ title, interval, fetch: async () => fetch() });
      const art = name => ctx.image?.(name) ?? name;
      const widgets = {
        cameras: w('Cameras', 4_000, () => { const seen = sightings(); return { type: 'cameras', title: 'Cameras', icon: 'camera', source: { name: 'Frigate', icon: '/api/icon/frigate' },
          cameras: CAMERAS.map(([id, name, loop, d]) => ({ id, name, loop, video: art(`${id}.mp4`), poster: art(`${id}.jpg`), detections: d.map(([label, score, , , path]) => ({ label, score, path })) })),
          events: seen.map(({ name, image, ...e }) => ({ ...e, image: art(`${image}.jpg`) })),
          summary: { label: 'Cameras', icon: 'camera', value: CAMERAS.length, sub: `${seen[0].label} · ${seen[0].name}` } }; }),
        services: w('Services', 15_000, () => { const s = services(), bad = s.filter(x => !x.ok); return { ...statusCard('Services', 'pulse', s),
          summary: { label: 'Services', icon: 'pulse', value: `${s.length - bad.length}/${s.length}`, tone: bad.length ? 'bad' : 'good', sub: bad.length ? `${bad.map(b => b.name).join(', ')} down` : 'All up' } }; }),
        uptime: w('Uptime', 60_000, () => ({ ...statusCard('Uptime', 'pulse', services().map(({ group, ...s }) => s)), note: '99.8% over 30 days' })),
        containers: w('Containers', 30_000, () => ({ ...statusCard('Containers', 'disk', containers()), layout: 'wall' })),
        drives: w('Drives', 300_000, () => ({ type: 'list', layout: 'temps', title: 'Drives', icon: 'disk', items: drives.map(([title, t, age]) => ({ title, subtitle: age, meta: `${t}°C`, pct: (t - 20) / 40 })),
          summary: { label: 'Drives', icon: 'disk', value: '46°C', sub: 'All 3 healthy', tone: 'good', marks: drives.map(([title, t]) => ({ pct: (t - 20) / 40, label: `${title} · ${t}°C` })) } })),
        dns: w('Pi-hole', 60_000, () => { const blocked = 9000 + Math.floor((now() % 864e5) / 864e5 * 14000), q = past(48, 400, 2600, 1_800_000), b = q.map((v, i) => Math.round(v * (.09 + .1 * Math.abs(Math.sin(i / 5)))));
          return { type: 'chart', style: 'bars', title: 'Pi-hole', icon: 'shield', headline: '14%', span: `of ${(blocked * 7).toLocaleString('en')} queries today · 23 devices`, from: now() - 864e5, to: now(),
            series: [{ name: 'Blocked', tone: 'bad', points: b }, { name: 'Allowed', points: q.map((v, i) => v - b[i]) }],
            facts: [['ads.example.net', 41200], ['telemetry.example.com', 30110], ['tracker.example.org', 18840], ['metrics.example.io', 9020]].map(([label, value]) => ({ label, value: value.toLocaleString('en') })),
            summary: { label: 'Ads blocked', icon: 'shield', value: blocked.toLocaleString('en'), ring: '14%', tone: 'good', sub: '14% of queries', trend: past(60, 20, 90, 300_000), pct: .14 } }; }),
        updates: w('Updates', 3_600_000, () => ({ type: 'list', layout: 'chips', title: 'Updates', icon: 'tag', items: [{ title: 'immich', subtitle: 'v2.5.0 → v2.6.1' }, { title: 'paperless', subtitle: '3.1.0 → 3.2.0' }, { title: 'karakeep', subtitle: '0.33.2 → 0.34.0' }] })),
        jobs: w('Scheduled jobs', 60_000, () => ({ type: 'list', layout: 'chips', title: 'Scheduled jobs', icon: 'clock', items: [{ title: 'Nightly backup', subtitle: 'ran 6h ago', meta: 'next 18h' }, { title: 'Photo sync', subtitle: 'ran 12m ago', meta: 'next 3m' }, { title: 'Disk check', subtitle: 'ran 9h ago', meta: 'next 15h' }] })),
        system: w('System', 5_000, () => { const cpu = Math.round(12 + 8 * Math.sin(now() / 30_000)), gpu = Math.round(6 + 5 * Math.sin(now() / 50_000)), gauge = (label, icon, v, detail, lo, hi) => ({ label, icon, value: `${v}%`, ring: `${v}%`, pct: v / 100, tone: 'good', detail, trend: past(48, lo, hi, 300_000) });
          return { type: 'stats', title: 'System', icon: 'cpu', items: [{ label: 'CPU', value: cpu, unit: '%' }], summaries: [gauge('CPU', 'cpu', cpu, '44°C', 6, 24), gauge('Memory', 'memory', 33, '21 of 64 GB', 29, 37), gauge('GPU', 'gpu', gpu, '38°C', 2, 40), gauge('Storage', 'disk', 58, '11 of 20 TB', 56, 59)] }; }),
        weather: w('Weather', 900_000, weather),
        calendar: w('Calendar', 900_000, calendar),
        thermostat: w('Thermostat', 30_000, thermostat),
        pc: w('Desktop', 30_000, pcCard),
        home: w('Home', 15_000, homeCard),
        streams: w('Now playing', 10_000, () => { const s = stream(); return { type: 'media', title: 'Now playing', icon: 'play', source: { name: 'Plex', icon: '/api/icon/plex' }, note: '1 stream · 12 Mbps',
          items: [{ title: s.title, subtitle: String(s.year), image: poster(s.title), backdrop: backdrop(s.title), pct: s.pct, state: 'playing', user: 'Theo', device: 'Living room TV', tags: ['4K', 'Direct Play', '12 Mbps'], remaining: `${s.left} min left` }],
          activity: { title: s.title, subtitle: 'Theo · Living room TV', image: poster(s.title), icon: 'play', pct: s.pct, trailing: `${s.left}m left` } }; }),
        downloads: w('Downloads', 5_000, () => { const d = downloads(), speed = d.reduce((a, t) => a + t.speed, 0), first = d[0];
          return { type: 'media', title: 'Downloading', icon: 'download', source: { name: 'qBittorrent', icon: '/api/icon/qbittorrent' }, note: d.length ? `${d.length} downloads · ↓ ${speed.toFixed(0)} MB/s` : undefined, empty: 'Paused for ten minutes',
            items: d.map(t => ({ title: t.title, subtitle: t.sub, image: poster(t.title), backdrop: backdrop(t.title), pct: t.pct, state: 'playing', icon: 'download', tags: ['1080p', `${t.speed.toFixed(0)} MB/s`, `${t.left.toFixed(1)} GB left`], remaining: `${Math.floor(t.pct * 100)}%` })),
            summary: { label: 'Downloads', icon: 'download', value: `${speed.toFixed(0)} MB/s`, sub: d.length ? `${d.length} active` : 'Paused' },
            activity: first && { title: `${first.title}${d.length > 1 ? ` +${d.length - 1}` : ''}`, subtitle: `↓ ${speed.toFixed(0)} MB/s`, image: poster(first.title), icon: 'download', pct: first.pct, count: d.length } }; }),
        sky: w('Daylight', 300_000, () => ({ type: 'schedule', title: 'Daylight', icon: 'sun', muted: ['Dawn', 'Noon', 'Dusk'], items: [['Dawn', 6, 41], ['Sunrise', 7, 12], ['Noon', 12, 48], ['Sunset', 18, 2], ['Dusk', 18, 33]].map(([name, h, m]) => ({ name, at: day(h, m) })) })),
        photos: w('Photos', 3_600_000, () => ({ type: 'photos', style: 'flashback', title: 'On this day', icon: 'image', source: { name: 'Immich', icon: '/api/icon/immich' }, items: ['2 years ago', '3 years ago', '5 years ago', '6 years ago'].map((badge, i) => ({ image: ctx.image(`photo${i}`), badge, title: ART.photos[i].title })) })),
        reading: w('From your reading', 3_600_000, () => { const more = pile().map(p => ({ id: p.title, headline: p.title, blurb: p.note, site: p.subtitle, image: ctx.image(p.image ?? `page${ART.saved.indexOf(p)}`), link: p.href })); return { type: 'article', title: 'From your reading', icon: 'bookmark', source: { name: 'Karakeep', icon: '/api/icon/karakeep' }, ...(more[0] ?? { headline: '' }), more }; }),
        upcoming: w('Coming up', 900_000, () => ({ type: 'list', title: 'Coming up', icon: 'film', items: [{ title: FILMS[7], subtitle: inDays(3) }],
          summary: { label: 'Coming up', icon: 'film', value: FILMS[7], sub: inDays(3), image: backdrop(FILMS[7]) } })),
        ai: w('AI', 60_000, () => ({ type: 'stats', title: 'AI', icon: 'chart', items: [{ label: 'Requests', value: 312 }],
          summaries: [{ label: 'Requests', icon: 'pulse', value: '312', sub: 'today', trend: past(40, 2, 30, 120_000) }, { label: 'Tokens', icon: 'text', value: '84k', sub: 'generated today', trend: past(40, 10, 60, 120_000) }, { label: 'Power', icon: 'gpu', value: '38 W', sub: 'idle', trend: past(40, 30, 90, 120_000) }, { label: 'Cost today', icon: 'coins', value: '0¢', sub: 'it runs at home' }] })),
        library: w('Library', 3_600_000, () => ({ type: 'stats', title: 'Library', icon: 'film', items: [{ label: 'Movies', value: 412 }], summaries: [{ label: 'Movies', icon: 'film', value: '412' }, { label: 'Shows', icon: 'play', value: '38', sub: '164 seasons' }, { label: 'Episodes', icon: 'pulse', value: '2,986' }] })),
        recent: w('Recently added', 3_600_000, () => ({ type: 'shelf', title: 'Recently added', icon: 'film', aspect: 'poster', layout: 'spotlight', source: { name: 'Plex', icon: '/api/icon/plex' },
          items: FILMS.slice(1, 9).map((title, i) => ({ title, subtitle: String(ART.films[title]?.year ?? ''), image: poster(title), backdrop: backdrop(title), badge: i < 2 ? 'Today' : 'This week' })) })),
        mostwatched: w('Most watched', 3_600_000, () => ({ type: 'ranked', title: 'Most watched', icon: 'film',
          items: [[FILMS[5], '9 plays', '14h', 1], [FILMS[2], '4 plays', '7h', .5], [FILMS[3], '3 plays', '5h', .36], [FILMS[1], '2 plays', '3h', .22]].map(([title, subtitle, value, pct], i) => ({ title, subtitle, value, pct, image: poster(title), backdrop: i ? undefined : photo(`${title}b`, 800, 400) })) })),
        plays: w('Plays', 3_600_000, () => ({ type: 'chart', style: 'bars', title: 'Plays', icon: 'chart', headline: '57 plays', span: 'last 30 days', from: now() - 30 * 864e5, to: now(), series: [{ name: 'TV', tone: 'accent', points: past(30, 0, 4, 864e5).map(Math.round) }, { name: 'Movies', points: past(30, 0, 2, 7e7).map(Math.round) }] })),
        people: w("Who's watching", 3_600_000, () => ({ type: 'list', title: "Who's watching", icon: 'play', items: [['Theo', '22h', 1], ['Alex', '11h', .5], ['Priya', '6h', .27]].map(([title, meta, pct]) => ({ title, meta, pct })) })),
        week: w('Coming up', 3_600_000, () => ({ type: 'shelf', title: 'Coming up', icon: 'film', aspect: 'poster', layout: 'week',
          items: [[0, FILMS[5], 'Ready'], [1, FILMS[1]], [3, FILMS[7]], [3, FILMS[8]], [6, FILMS[5]], [8, FILMS[1]], [10, FILMS[7]], [10, FILMS[5]], [13, FILMS[2]]].map(([n, title, badge]) => ({ at: ymd(n), badge: badge ?? inDays(n), title, subtitle: 'New episode', image: poster(title) })) })),
        requests: w('Requested', 3_600_000, () => ({ type: 'shelf', title: 'Requested', icon: 'film', aspect: 'poster', layout: 'tickets', items: [[FILMS[8], 'Downloading', 'accent'], [FILMS[9], 'Available', 'good'], [FILMS[6], 'Available', 'good'], [FILMS[3], 'Available', 'good']].map(([title, badge, tone]) => ({ title, subtitle: String(ART.films[title]?.year ?? ''), badge, tone, image: poster(title) })) })),
        docs: w('Recent documents', 3_600_000, () => ({ type: 'shelf', layout: 'desk', title: 'Recent documents', icon: 'file', aspect: 'poster', items: PAPERS.map(p => ({ title: p.title, subtitle: `${p.org} · ${p.date}`, image: paper(p), badge: p.badge })) })),
        saved: w('Recently saved', 3_600_000, () => ({ type: 'shelf', layout: 'windows', title: 'Recently saved', icon: 'bookmark', aspect: 'wide', items: pile().map(p => ({ ...p, id: p.title, image: ctx.image(p.image ?? `page${ART.saved.indexOf(p)}`) })) })),
        news: w('Hacker News', 1_800_000, () => ({ type: 'list', layout: 'headlines', title: 'Hacker News', icon: 'news', items: [['Show HN: I replaced my NAS with three old laptops', '412 points · 188 comments', '3h'], ['The surprising durability of cheap SSDs', '287 points · 96 comments', '6h'], ['Why self-hosted email is hard, in one diagram', '241 points · 140 comments', '9h'], ['A tiny DNS server in 500 lines', '198 points · 42 comments', '12h']].map(([title, subtitle, meta]) => ({ title, subtitle, meta })) })),
        feeds: w('Feeds', 1_800_000, () => ({ type: 'list', layout: 'headlines', title: 'Feeds', icon: 'rss', items: [['This week in open-source home automation', 'The Example Times', '1h'], ['Quiet fans, ranked', 'Hardware Weekly', '4h'], ['Ten small scripts that run my house', 'Personal blog', '8h'], ['Solar panels and home servers: the numbers', 'Example Energy', '1d']].map(([title, subtitle, meta]) => ({ title, subtitle, meta })) })),
        releases: w('Releases', 3_600_000, () => ({ type: 'list', layout: 'chips', title: 'Releases', icon: 'tag', items: [['paperless', '3.2.0', 'Yesterday'], ['immich', 'v2.6.1', 'Oct 21'], ['home-assistant', '2026.10.4', 'Oct 18'], ['karakeep', '0.34.0', 'Oct 15']].map(([title, subtitle, meta]) => ({ title, subtitle, meta })) })),
      };
      const pile = () => { const ids = got('archived', []); return [...ART.saved].reverse().filter(p => !ids.includes(p.title)); };
      const textCard = text => ({ type: 'text', tone: 'good', text });
      return {
        widgets,
        // the clips, with the byte ranges phones ask for. Nothing but the files named above can be reached
        image(ref, range) {
          const still = ref === 'article' ? 'article.jpg' : /^photo[0-3]$/.test(ref) ? `photos/${ref[5]}.jpg` : /^page[0-4]$/.test(ref) ? `pages/${ref[4]}.jpg` : null;
          if (still) return readFile(`${dir}/${still}`).then(b => new Response(b, { headers: { 'Content-Type': 'image/jpeg' } }));
          if (!CLIPS.has(ref)) throw new Error('bad image ref');
          const file = join(cfg.art, ref), size = statSync(file).size, [, a, b] = /^bytes=(\d+)-(\d*)/.exec(range ?? '') ?? [];
          const start = Number(a ?? 0), end = Math.min(b ? Number(b) : size - 1, size - 1), headers = { 'Content-Type': ref.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
          return new Response(Readable.toWeb(createReadStream(file, { start, end })), { status: a ? 206 : 200, headers: a ? { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } : headers });
        },
        recap: async () => [
          { id: 'music.songs', theme: 'music', icon: 'play', show: { images: ART.albums, shape: 'square' }, kicker: 'Your music, on your own disks', value: '18,422', unit: 'songs', stat: 'Songs', score: 82, scope: 'All time', line: 'No subscription can take a single one of them away.' },
          { id: 'komga.books', theme: 'reading', icon: 'book', show: { images: ART.books }, kicker: 'On your shelves', value: '2,316', unit: 'books', stat: 'Books', score: 73, scope: 'All time', line: 'Across 214 series, and none of them can be pulled from a store.' },
          { id: 'feeds.read', logo: '/api/icon/miniflux', theme: 'reading', icon: 'rss', kicker: 'You read', value: '9,871', unit: 'articles', stat: 'Articles read', score: 52, scope: 'All time', line: 'Chosen by you, in the order they came. No algorithm involved.' },
          { id: 'recipes', logo: '/api/icon/tandoor-recipes', theme: 'food', icon: 'book', kicker: 'Your cookbook has', value: '428', unit: 'recipes', stat: 'Recipes', score: 64, scope: 'All time', line: 'All of them without a life story above the ingredients.' },
          { id: 'cloud.files', logo: '/api/icon/nextcloud', theme: 'files', icon: 'file', kicker: 'Your own cloud holds', value: '147,902', unit: 'files', stat: 'Files', score: 62, scope: 'All time', line: 'Same convenience, and the only person with the keys is you.' },
          { id: 'sync.moved', logo: '/api/icon/syncthing', theme: 'files', icon: 'disk', kicker: 'Your devices passed around', value: '1.8 TB', scope: 'Since Syncthing last restarted', score: 54, line: 'Straight from one to the next, with no server in the middle.' },
          { id: 'tailnet', logo: '/api/icon/tailscale', theme: 'reach', icon: 'wifi', kicker: 'Your private network spans', value: '11', unit: 'devices', stat: 'Tailnet devices', score: 69, scope: 'Right now', line: 'Your homelab goes wherever they do, with no ports left open.' },
          { id: 'proxy.hosts', logo: '/api/icon/nginx-proxy-manager', theme: 'reach', icon: 'wifi', kicker: 'Your front door serves', value: '26', unit: 'hosts', stat: 'Proxy hosts', score: 53, scope: 'Right now', line: 'Each one with its own address, on a domain you run.' },
          { id: 'bans', logo: '/api/icon/crowdsec', theme: 'security', icon: 'shield', kicker: 'CrowdSec is keeping out', value: '1,392', unit: 'attackers', stat: 'Attackers banned', score: 71, scope: 'Right now', line: 'Every one of them tried something and got caught.' },
          { id: 'proxmox.guests', logo: '/api/icon/proxmox', theme: 'hardware', icon: 'cpu', kicker: 'Proxmox is running', value: '9', unit: 'machines', stat: 'Virtual machines', score: 56, scope: 'Right now', line: 'Whole computers inside your computer.' },
          { id: 'stack', theme: 'hardware', icon: 'pulse', icons: STACK.map(i => `/api/icon/${i}`), kicker: 'Valet talks to', value: String(STACK.length), unit: 'services', stat: 'Services', score: 77, scope: 'Right now', line: 'Every one of them on hardware you own.' },
          { id: 'grafana', logo: '/api/icon/grafana', theme: 'ops', icon: 'chart', kicker: 'You built', value: '37', unit: 'dashboards', stat: 'Dashboards', score: 57, scope: 'All time', line: 'Fed by 6 data sources. Some of them you even look at.' },
          { id: 'watching', logo: '/api/icon/changedetection', theme: 'ops', icon: 'pulse', kicker: 'You are keeping an eye on', value: '58', unit: 'pages', stat: 'Pages watched', score: 51, scope: 'Right now', line: 'If any of them change, you hear about it first.' },
          { id: 'code', logo: '/api/icon/forgejo', theme: 'code', icon: 'file', kicker: 'Your own forge holds', value: '83', unit: 'repositories', stat: 'Repositories', score: 59, scope: 'All time', line: "In Forgejo, on your hardware, and not training anyone's model." },
          { id: 'watch.hours', theme: 'media', icon: 'play', wall: true, art: FILMS.map(poster), kicker: 'You watched', value: '612', unit: 'hours', stat: 'Hours watched', score: 95, scope: 'year', facts: { watchedHours: 612 }, line: '1,048 plays, all from your own server.' },
          { id: 'watch.top', theme: 'media', icon: 'film', backdrop: backdrop(FILMS[5]), kicker: 'Your most watched', value: FILMS[5], line: '41 plays and 38 h, more time than anything else this year.', score: 90, scope: 'year', items: [[FILMS[5], '38 h'], [FILMS[2], '21 h'], [FILMS[3], '17 h'], [FILMS[1], '12 h'], [FILMS[4], '9 h']].map(([name, value]) => ({ name, value, image: poster(name) })) },
          { id: 'library.added', theme: 'media', icon: 'film', wall: true, kicker: 'Your library grew by', value: '186', unit: 'titles', stat: 'Titles added', score: 80, scope: 'year', facts: { libraryHours: 9400 }, line: '171 films and 15 shows joined. The whole collection now takes up 9.2 TB.' },
          { id: 'seed.ratio', theme: 'network', icon: 'download', kicker: 'Your share ratio', value: '3.18', stat: 'Share ratio', score: 75, scope: 'All time', facts: { uploadedBytes: 14.3e12, downloadedBytes: 4.5e12 }, line: 'For every byte you took, 3.18 went back.', bars: [{ label: 'Taken', value: 4.1, show: '4.1 TB' }, { label: 'Given back', value: 13, show: '13 TB' }], trait: { name: 'The Generous Seeder', line: 'You give back far more than you take, and somewhere a stranger finished their download because of you.', strength: .8 } },
          { id: 'dns.blocked', theme: 'network', icon: 'shield', kicker: 'Pi-hole stopped', value: '6,204,118', unit: 'requests', stat: 'Ads blocked', score: 72, scope: 'year', line: "That's 14% of everything your devices tried to look up, across 23 devices. The worst offenders lately:", bars: [['ads.example.net', 41200], ['telemetry.example.com', 30110], ['tracker.example.org', 18840]].map(([label, value]) => ({ label, value, show: value.toLocaleString('en') })) },
          { id: 'watch.people', theme: 'media', icon: 'play', kicker: 'Who kept Plex busiest', value: 'Theo', line: '298 h of the 612 h everyone watched.', score: 70, scope: 'year', private: true, bars: [{ label: 'Theo', value: 298, show: '298 h' }, { label: 'Alex', value: 201, show: '201 h' }, { label: 'Priya', value: 113, show: '113 h' }] },
          { id: 'uptime', theme: 'network', icon: 'pulse', kicker: 'Your homelab stayed up', value: '99.8%', stat: 'Uptime', score: 66, scope: 'Last 30 days', line: 'Across the 15 things Uptime Kuma watches. The ones that kept you busiest:', bars: [['Mealie', 96.1], ['Paperless', 99.7], ['Radarr', 99.9]].map(([label, value]) => ({ label, value, show: `${value}%` })) },
          { id: 'docs', theme: 'files', icon: 'file', kicker: 'You keep', value: '1,204', unit: 'documents', stat: 'Documents kept', score: 78, scope: 'All time', line: '4 million characters of text, every word searchable. Most of it from:', bars: [['City Power', 212], ['Northwind Mutual', 164], ['Example Bank', 93]].map(([label, value]) => ({ label, value, show: String(value) })) },
          { id: 'home.vacuum', theme: 'home', icon: 'home', kicker: 'Your robot has vacuumed', value: '3,410', unit: 'm²', stat: 'Floor vacuumed', score: 88, scope: 'Since Mar 2025', visual: { kind: 'home', data: homeCard().visual.data }, line: '142 runs and 96 hours of work.' },
          { id: 'rig', theme: 'hardware', icon: 'cpu', kicker: 'All of it runs on', value: '64', unit: 'GB of memory', score: 67, scope: 'Right now', visual: { kind: 'pc-case', data: { ...pcCard().visual.data, controls: false, presets: undefined } }, line: 'Right now the CPU is at 44°C and the GPU at 38°C.' },
          { id: 'ai.tokens', theme: 'ai', icon: 'gpu', kicker: 'Your own AI wrote', value: '2.1', unit: 'million tokens', stat: 'AI tokens', score: 58, scope: 'year', bars: [8, 12, 6, 15, 22, 9, 14].map((value, i) => ({ label: String(20 + i), value })), line: 'On your own graphics card, for 41¢ of electricity. Nobody else read a word of it.' },
          { id: 'watch.day', theme: 'media', icon: 'calendar', kicker: 'Your night in', value: 'Fridays', line: '312 of your 1,048 plays started on a Friday.', score: 60, scope: 'year', bars: [['Mon', 88], ['Tue', 96], ['Wed', 104], ['Thu', 121], ['Fri', 312], ['Sat', 214], ['Sun', 113]].map(([label, value]) => ({ label, value })) },
        ],
        actions: {
          preset: { description: 'Apply a lighting preset', input: z.object({ id: z.string() }), run: async ({ id }) => { if (PRESET_RGB[id]) { put('preset', id); for (const p of ['fans0', 'fans1', 'pump', 'ram', 'gpu']) changes.delete(`part.${p}`); } } },
          light: { description: 'Set a PC part or some home lights', input: z.object({ part: z.string().optional(), state: z.object({}).loose().optional(), entity_id: z.array(z.string()).optional() }).loose(),
            run: async ({ part, state, entity_id, on, brightness, rgb }) => {
              const color = rgb && `#${rgb.map(v => Number(v).toString(16).padStart(2, '0')).join('')}`;
              if (part && /^(fans[01]|pump|ram|gpu)$/.test(part)) put(`part.${part}`, { mode: 'Static', brightness: 100, color: [255, 255, 255], ...state });
              for (const id of (entity_id ?? []).slice(0, 13)) { const was = LIGHTS.find(l => lightId(l[0], l[1]) === id); if (was) { const now_ = light(was); put(id, { on: on ?? now_.on, level: brightness ?? now_.level, color: color ?? now_.color }); } }
            } },
          thermostat: { description: 'Set the pretend thermostat', input: z.object({ temperature: z.number().min(10).max(30).optional(), preset: z.enum(Object.keys(SETBACKS)).optional(), power: z.boolean().optional() }),
            run: async ({ temperature, preset, power }) => { const c = climate(); put('thermostat', { preset: preset ?? c.preset, power: preset ? true : power ?? c.power, target: temperature ?? (preset ? SETBACKS[preset] : c.target), from: c.room, at: now() }); } },
          archive: { description: 'Archive a saved link', input: z.object({ id: z.string() }), run: async ({ id }) => put('archived', [...got('archived', []), id]) },
          vacuum: { description: 'Pretend to send the vacuum', input: z.object({}).loose(), run: async () => {} },
        },
        tools: {
          service_status: { label: 'Checked services', live: true, access: 'read', input: z.object({}), description: 'Whether each service is up.',
            run: async () => ({ data: { services: services().map(({ name, ok, detail }) => ({ name, ok, detail })) }, card: await widgets.services.fetch() }) },
          container_logs: { label: 'Read the logs', access: 'read', input: z.object({ name: z.string().default('mealie') }), description: 'Recent logs of a container.',
            run: async () => ({ data: { lines: LOGS }, card: { type: 'code', title: 'mealie logs', lines: LOGS } }) },
          restart_service: { label: 'Restarted a service', confirm: ({ name = 'Mealie' }) => ({ title: `Restart ${name}?`, detail: 'It stopped at 3:12 AM', logo: '/api/icon/mealie', verb: 'Restart' }), access: 'control', input: z.object({ name: z.string().default('Mealie') }), description: 'Restart a service.', undo: undefined,
            run: async () => { put('mealie', true); return { data: { done: true }, card: textCard('Mealie is back up.') }; } },
          downloads_status: { label: 'Checked downloads', live: true, access: 'read', input: z.object({}), description: 'Unfinished downloads.',
            run: async () => { const d = downloads(); return { data: { speed: `${d.reduce((a, t) => a + t.speed, 0).toFixed(0)} MB/s`, torrents: d.map(t => ({ name: t.title, progress: `${Math.floor(t.pct * 100)}%`, left: `${Math.max(1, Math.round(t.left / (t.speed / 1000) / 60))} min` })) }, card: await widgets.downloads.fetch() }; } },
          pause_downloads: { label: 'Paused downloads', confirm: () => ({ title: 'Pause all downloads?', logo: '/api/icon/qbittorrent', verb: 'Pause' }), access: 'control', input: z.object({}), description: 'Pause every download.', run: async () => { put('paused', true); return { data: { done: true }, card: textCard('Downloads paused.') }; } },
          plex_streams: { label: "Checked what's playing", live: true, access: 'read', input: z.object({}), description: 'Who is watching what.',
            run: async () => { const s = stream(); return { data: { streams: [{ user: 'Theo', title: s.title, device: 'living room TV', left: `${s.left} minutes` }] }, card: await widgets.streams.fetch() }; } },
          plex_stats: { label: "Checked what's popular", access: 'read', input: z.object({}), description: 'Most watched lately and what is new.', run: async () => ({ data: { top: FILMS[5], unwatched: FILMS[1] }, card: await widgets.mostwatched.fetch() }) },
          drive_health: { label: 'Checked the drives', access: 'read', input: z.object({}), description: 'Disk health.', run: async () => ({ data: { drives, hottest: 'the system NVMe at 46°C' }, card: await widgets.drives.fetch() }) },
          system_status: { label: 'Checked the server', access: 'read', input: z.object({}), description: 'CPU, memory and GPU.', run: async () => ({ data: { cpu: '12%', memory: '33%', gpu: '6%' }, card: { type: 'chart', title: 'CPU', unit: '%', span: 'last hour', from: now() - 36e5, to: now(), series: [{ name: 'CPU', points: past(60, 6, 30) }] } }) },
          set_lights: { label: 'Changed the lights', confirm: ({ room = 'Living Room', on = false }) => ({ title: `Turn ${on ? 'on' : 'off'} the ${room.toLowerCase()} lights?`, logo: '/api/icon/home-assistant', verb: `Turn ${on ? 'on' : 'off'}` }), access: 'control', input: z.object({ room: z.string().default('Living Room'), on: z.boolean().default(false) }), description: 'Turn a room on or off.',
            run: async ({ room, on }) => { for (const l of LIGHTS.filter(x => x[0] === room)) put(lightId(l[0], l[1]), { on, level: on ? 75 : 0, color: light(l).color }); return { data: { done: true }, card: textCard(`${room} lights ${on ? 'on' : 'off'}.`) }; } },
          what_happened: { label: 'Looked back', access: 'read', input: z.object({}), description: 'What happened recently.', run: async () => ({ data: { summary: 'Mealie ran out of memory at 3:12 AM, the backup finished at 4:00, and two episodes arrived.' }, card: { type: 'list', title: 'Overnight', icon: 'clock', items: [{ title: 'Mealie stopped', subtitle: 'Out of memory', meta: '3:12 AM', tone: 'bad' }, { title: 'Backup finished', subtitle: '41 GB, verified', meta: '4:00 AM' }, { title: 'Two new episodes', subtitle: 'Harbor Lights', meta: '5:30 AM' }] } }) },
        },
      };
    },
  });
};
