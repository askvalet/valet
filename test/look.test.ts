// The look: a config that says nothing changes nothing, every option reaches the page, and what ends up in CSS can't
// be anything but the value it claims to be.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { Config, parseConfig } from '../src/server/config.ts';
import { cleanCss, allowFonts, fontOrigins, headers } from '../src/server/security.ts';
import { check } from '../src/server/site.ts';
import { inUnits } from '../src/server/units.ts';
import { registry } from '../src/integrations/index.ts';
import { cardLook, lookOf } from '../src/shared/look.ts';
import { LABELS } from '../src/shared/labels.ts';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Activity } from '../src/server/activity.ts';
import { savePins } from '../src/server/pins.ts';
import { sandbox } from '../src/server/sandbox.ts';
import { Timeline } from '../src/server/timeline.ts';
import { clock, day, favorites, firstDay, label, num, oneLine, sayHow, setFormat, stillTrue, tabHash } from '../src/web/format.ts';
import { scopeOf, suggestPrompt } from '../src/server/insight.ts';
import { rank } from '../src/web/palette.tsx';

const refused = (raw: unknown) => assert.equal(Config.safeParse(raw).success, false, JSON.stringify(raw));
const look = (raw: object) => lookOf(Config.parse(raw));

test('defaults: an old config keeps the old look, to the letter', () => {
  assert.deepEqual(look({}), { vars: {}, classes: [] });
  assert.deepEqual(look({ appearance: { wallpaper: 'w.jpg' } }), { vars: {}, classes: [] });
  const c = Config.parse({ menubar: ['a.b'], nav: { side: 'top' }, live: { activities: ['a.b'] } });
  assert.deepEqual(c.menubar, { widgets: ['a.b'], position: 'right', labels: true, clock: true, date: true, theme: true, size: 1 });
  assert.deepEqual(c.nav, { side: 'top', style: 'icons', hide: [], order: [], size: 1 });
  assert.deepEqual(c.live?.activities, ['a.b']);
  assert.deepEqual(c.hero, { greeting: true, status: true, search: true, review: true, align: 'center' });
  assert.deepEqual(c.chat, { open: 'center', overview: true, suggestions: 'ai', steps: true, thinking: 'collapsed', send: 'enter', beam: 'off', beamColor: 'mono', beamStrength: .45, commands: {} });
  assert.deepEqual(c.format, { clock: 'auto', date: 'short', weekStart: 'auto', temperature: 'auto', distance: 'auto', locale: 'auto' });
  assert.equal(c.notice, undefined);
  assert.equal(c.appearance.theme, 'auto');
  assert.equal(c.appearance.dim, .35);
  const plain = Config.parse({ layout: [{ widgets: ['a.b', { widget: 'c.d', size: 'tall' }], columns: 2 }] }).layout[0];
  assert.equal(plain.columns, 2);
  assert.deepEqual(plain.widgets, [{ widget: 'a.b', size: 'medium' }, { widget: 'c.d', size: 'tall' }]);
  assert.equal(plain.favorites, undefined);
});

test('appearance.theme system, and a wallpaper, dim and blur for each theme', () => {
  assert.equal(Config.parse({ appearance: { theme: 'system' } }).appearance.theme, 'system');
  const both = Config.parse({ appearance: { wallpaper: { light: 'https://example.com/day.jpg', dark: ['a.jpg', '#000'] }, wallpapers: { Media: { light: '#fff', dark: '#000' }, Home: 'h.jpg' } } }).appearance;
  assert.deepEqual(both.wallpaper, { light: 'https://example.com/day.jpg', dark: ['a.jpg', '#000'] });
  assert.equal(both.wallpapers.Home, 'h.jpg');
  // a plain one still means both, and one side alone isn't a wallpaper for each theme
  assert.equal(Config.parse({ appearance: { wallpaper: 'w.jpg' } }).appearance.wallpaper, 'w.jpg');
  refused({ appearance: { wallpaper: { light: 'w.jpg' } } }); refused({ appearance: { wallpaper: { light: 'w.jpg', dark: 'v.jpg', dusk: 'x.jpg' } } });
  refused({ appearance: { wallpaper: { light: 'rgb(1 2 3); background: url(x)', dark: '#000' } } });
  assert.deepEqual(look({ appearance: { dim: { light: .1, dark: .5 }, blur: { light: 0, dark: 8 } } }),
    { vars: { '--wall-dim-light': '0.1', '--wall-dim-dark': '0.5', '--wall-filter-light': 'blur(0px)', '--wall-filter-dark': 'blur(8px)' }, classes: [] });
  refused({ appearance: { dim: { light: .1 } } }); refused({ appearance: { dim: { light: .1, dark: 2 } } }); refused({ appearance: { blur: { light: -1, dark: 1 } } });
});

test('appearance.rim: strength from 0 to 1, nothing on the page unless asked for', () => {
  assert.equal(Config.parse({}).appearance.rim, undefined);
  assert.deepEqual(look({ appearance: { rim: 0 } }), { vars: {}, classes: [] });
  assert.deepEqual(look({ appearance: { rim: .6 } }), { vars: { '--rim': '0.6' }, classes: ['has-rim'] });
  refused({ appearance: { rim: 1.5 } }); refused({ appearance: { rim: -.1 } }); refused({ appearance: { rim: 'bright' } });
});

test('every appearance option reaches the page as a variable or a class', () => {
  const { vars: v, classes } = look({
    appearance: {
      colors: { accent: '#ffd400', good: 'green', warn: 'rgb(1 2 3)', bad: 'hsl(0 80% 50%)', card: 'tomato' }, dim: .1, blur: 12, density: 'compact', gap: 20, sectionGap: 50, maxWidth: '90vw', rowHeight: 200, motion: 'none',
      font: { family: 'Inter', mono: 'Fira Code', scale: 1.2, headingWeight: 800 }, shape: { radius: 0, border: 2, borderColor: '#000', shadow: 'none' }, glass: { opacity: .4, blur: 72 },
    },
    chat: { width: 500, height: '80vh', bubble: '#111111' }, nav: { size: 1.5 }, menubar: { size: 1.2 },
  });
  assert.deepEqual(classes, ['no-shadow', 'motion-none']);
  assert.equal(v['--primary'], '#ffd400'); assert.equal(v['--primary-foreground'], '#000000');
  assert.equal(v['--good'], 'green'); assert.equal(v['--warn'], 'rgb(1 2 3)'); assert.equal(v['--destructive'], 'hsl(0 80% 50%)');
  assert.match(v['--card'], /tomato calc\(0\.4 \* 100%\)/);
  assert.match(v['--font-ui'], /^Inter, /); assert.match(v['--font-code'], /^Fira Code, /);
  assert.equal(v['--font-scale'], '1.2'); assert.equal(v['--heading-weight'], '800');
  assert.equal(v['--radius'], '0px'); assert.equal(v['--card-border'], '2px'); assert.equal(v['--glass-edge'], '#000'); assert.equal(v['--shadow-card'], 'none');
  assert.equal(v['--frost'], '2'); assert.equal(v['--wall-dim'], '0.1'); assert.equal(v['--wall-filter'], 'blur(12px)');
  assert.equal(v['--spacing'], '.2rem'); assert.equal(v['--card-gap'], '20px'); assert.equal(v['--section-gap'], '50px'); assert.equal(v['--page-max'], '90vw'); assert.equal(v['--row-h'], '200px');
  assert.equal(v['--chat-w'], '500px'); assert.equal(v['--chat-h'], '80vh'); assert.equal(v['--chat-bubble'], '#111111'); assert.equal(v['--chat-ink'], '#ffffff');
  assert.equal(v['--nav-size'], '66px'); assert.equal(v['--bar-zoom'], '1.2');
  assert.deepEqual(look({ appearance: { glass: { blur: 0 } } }).classes, ['no-blur']);
  assert.deepEqual(look({ appearance: { glass: { material: 'liquid' } } }).classes, ['glass-liquid']);
  assert.deepEqual(look({ appearance: { glass: { material: 'frosted' } } }), look({ appearance: {} }));
  assert.deepEqual(look({ appearance: { motion: 'reduced' } }).classes, ['motion-reduced']);
});

test('a card can have its own surface, and leaves everything else alone', () => {
  assert.equal(cardLook({}), undefined);
  assert.deepEqual(cardLook({ blur: 0 }), { '--glass-blur': 'none' });
  const pic = cardLook({ background: 'https://x.test/a.jpg', tint: '#123' })!;
  assert.equal(pic['--card-image'], 'url("https://x.test/a.jpg")');
  assert.match(pic['--card'], /#123 calc\(0\.45 \* 100%\)/);
  const w = Config.parse({ layout: [{ gap: 8, columns: { phone: 1, desktop: 5 }, widgets: [{ widget: 'a.b', title: 'T', icon: 'bulb', header: false, tint: '#123', opacity: .5, blur: 4, background: '/api/icon/x' }] }] }).layout[0];
  assert.deepEqual(w.columns, { phone: 1, desktop: 5 });
  assert.equal(w.gap, 8);
});

test('wallpapers: a file, a URL, paint, a list, one per tab', () => {
  for (const wallpaper of ['/data/w.jpg', 'https://x.test/w.jpg', '#102030', 'black', 'rgb(1 2 3)', 'linear-gradient(90deg, #000, #fff)', ['a.jpg', '#000']]) assert.ok(Config.safeParse({ appearance: { wallpaper } }).success, String(wallpaper));
  const c = Config.parse({ appearance: { wallpaper: ['a.jpg', 'b.jpg'], wallpapers: { Ghost: '#000' } }, layout: [{ title: 'Home', widgets: [] }] });
  assert.deepEqual(check(c, registry).problems, ['appearance.wallpapers: no tab "Ghost" (the tabs are: Home)', 'appearance.rotate: a list of wallpapers needs a time to take turns, like 10m (only the first shows)']);
  assert.equal(Config.parse({ appearance: { rotate: '10m' } }).appearance.rotate, 600_000);
});

test('bad values are refused', () => {
  for (const color of ['#12', 'red; background: url(//x)', 'rgb(1 2 3) } body { display: none', 'rgb(url(//x))', 'color-mix(in srgb, red, url(x))', '<b>', '12px'])
    refused({ appearance: { colors: { accent: color } } });
  for (const wallpaper of ['linear-gradient(url(//x))', 'rgb(1;2)', 'color(</style>)']) refused({ appearance: { wallpaper } });
  for (const appearance of [
    { theme: 'sepia' }, { density: 'cosy' }, { motion: 'slow' }, { dim: 2 }, { glass: { opacity: 2 } }, { glass: { blur: -1 } }, { glass: { material: 'clear' } }, { shape: { shadow: 'huge' } }, { shape: { radius: 400 } },
    { font: { family: 'A</style>' } }, { font: { family: 'A; color: red' } }, { font: { url: 'https://x.test/f.woff2' } }, { font: { family: 'A', url: 'notes.txt' } }, { font: { scale: 9 } },
    { maxWidth: '100px; color: red' }, { cssFile: '/etc/passwd' }, { sizes: { huge: { cols: 1 } } }, { sizes: { tall: { cols: 9 } } }, { rotate: 'soon' },
  ]) refused({ appearance });
  for (const widget of [{ tint: 'red;' }, { background: 'javascript:alert(1)' }, { background: 'https://x/a.jpg") ; x' }, { opacity: 3 }, { size: 'huge' }, { nope: 1 }]) refused({ layout: [{ widgets: [{ widget: 'a.b', ...widget }] }] });
  refused({ layout: [{ widgets: [], columns: { phone: 9 } }] }); refused({ layout: [{ widgets: [], columns: { watch: 1 } }] });
  for (const c of [{ hero: { align: 'up' } }, { chat: { open: 'top' } }, { chat: { suggestions: 'maybe' } }, { chat: { width: 'wide' } }, { nav: { style: 'emoji' } }, { menubar: { position: 'up' } }, { live: { activities: 'x' } }, { format: { clock: '13h' } }, { format: { locale: 'not a locale!' } }, { labels: { nonsense: 'x' } }, { hero: { scope: 'lights' } }, { hero: { scope: [] } }, { notice: 'x'.repeat(121) }, { layout: [{ widgets: [], favorites: [] }] }]) refused(c);
});

test('unknown keys say what was probably meant, wherever they are', () => {
  const says = (yaml: string, what: RegExp) => assert.throws(() => parseConfig(yaml), what);
  says('appearance: { colours: { accent: red } }', /appearance: unknown option "colours" \(did you mean "colors"\?\)/);
  says('appearance: { font: { familly: Inter } }', /appearance\.font: unknown option "familly" \(did you mean "family"\?\)/);
  says('chat: { placement: right }', /chat: unknown option "placement" \(did you mean "placeholder"\?\)|chat: unknown option "placement" \(it takes: open/);
  says('layout: [{ widgets: [{ widget: a.b, titel: x }] }]', /layout\.0\.widgets\.0: unknown option "titel" \(did you mean "title"\?\)/);
  says('menubar: { position: left, sizes: 1 }', /menubar/);
  says('zzzqqq: 1', /unknown option "zzzqqq" \(it takes: auth/);
});

test('custom CSS can\'t leave its style tag', () => {
  const out = cleanCss('a { b: c } </style><script>x</script><!-- \0');
  assert.doesNotMatch(out, /<\/|<script|<!|\0/);
  assert.match(out, /\\3C \/style>/);
  assert.equal(cleanCss('@media (width < 600px) { a { b: c } }'), '@media (width < 600px) { a { b: c } }');
});

test('CSP: a remote font adds its own origin and nothing else', async () => {
  const app = new Hono(); app.use('*', headers); app.get('/', c => c.text('ok'));
  const csp = async () => (await app.request('/')).headers.get('Content-Security-Policy')!;
  allowFonts([]);
  assert.match(await csp(), /style-src 'self' 'unsafe-inline'; img-src/);
  assert.match(await csp(), /font-src 'self' data:; connect-src/);
  assert.deepEqual(fontOrigins('https://fonts.googleapis.com/css2?family=Inter'), ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  assert.deepEqual(fontOrigins('https://rsms.me/inter/font.woff2'), ['https://rsms.me']);
  assert.deepEqual(fontOrigins('data/fonts/x.woff2'), []);
  allowFonts(fontOrigins('https://rsms.me/inter/inter.css'));
  assert.match(await csp(), /style-src 'self' 'unsafe-inline' https:\/\/rsms\.me;/);
  assert.match(await csp(), /font-src 'self' data: https:\/\/rsms\.me;/);
  assert.match(await csp(), /script-src 'self';/);
  allowFonts([]);
});

test('units: services report in theirs, cards arrive in yours, and auto touches nothing', async () => {
  const card = { type: 'stats', summary: { value: '46°C', sub: 'cpu -5.5 °C · 10 km left' }, items: [{ label: 'T', value: 100, unit: '°C' }, { label: 'Far', value: 5, unit: 'km' }, { label: 'Speed', value: '9 km/h' }] };
  const inst = (c: any) => ({ widgets: { a: { title: 'A', interval: 1, fetch: async () => c } }, tools: { t: { description: '', access: 'read', input: {}, run: async () => ({ data: {}, card: c }) } } }) as any;
  const same = inst(card), fetch = same.widgets.a.fetch;
  assert.equal(inUnits(same, { temperature: 'auto', distance: 'auto' }).widgets.a.fetch, fetch);
  const f: any = await inUnits(inst(card), { temperature: 'f', distance: 'mi' }).widgets.a.fetch();
  assert.equal(f.summary.value, '115°F');
  assert.equal(f.summary.sub, 'cpu 22.1°F · 6 mi left');
  assert.deepEqual(f.items[0], { label: 'T', value: 212, unit: '°F' });
  assert.equal(f.items[2].value, '9 km/h');
  const c: any = await inUnits(inst({ type: 'x', summary: { value: '212°F' } }), { temperature: 'c', distance: 'auto' }).tools!.t.run({});
  assert.equal(c.card.summary.value, '100°C');
});

test('the page writes times, numbers and its own words as it\'s told', () => {
  const t = new Date(2026, 9, 31, 15, 7);
  setFormat({ clock: '24h', date: 'iso', weekStart: 'monday', locale: 'de-DE' }, { ...LABELS, overview: 'Accueil' });
  assert.equal(clock(t), '15:07'); assert.equal(day(t), '2026-10-31'); assert.equal(firstDay(), 1);
  assert.equal(num(1234.5), '1.234,5'); assert.equal(label('overview'), 'Accueil'); assert.equal(label('review', { year: 2026 }), 'Your 2026 in review');
  setFormat({ clock: '12h', date: 'long', weekStart: 'sunday', locale: 'en-US' }, LABELS);
  assert.match(clock(t), /^3:07\sPM$/); assert.match(day(t), /^Saturday, October 31(, 2026)?$/); assert.equal(firstDay(), 0);   // the year shows once it isn't this one
  setFormat({ clock: 'auto', date: 'short', weekStart: 'auto', locale: 'auto' }, LABELS);
});

const status = (key: string, items: object[]) => ({ key, at: 0, card: { type: 'status', title: 'Services', items } }) as any;
const dl = (note: string, buttons?: object[]) => ({ key: 'dl.active', at: 0, card: { type: 'media', title: 'Downloading', note, buttons, items: [{ title: 'A', icon: 'download', state: 'playing' }, { title: 'B', icon: 'download', state: 'playing' }] } }) as any;

test('the new options say what they mean', () => {
  const c = Config.parse({ notice: 'Demo', hero: { scope: ['downloads', 'lights'] }, layout: [{ widgets: ['a.b'], favorites: ['Plex'] }] });
  assert.equal(c.notice, 'Demo'); assert.deepEqual(c.hero.scope, ['downloads', 'lights']); assert.deepEqual(c.layout[0].favorites, ['Plex']);
  assert.deepEqual(scopeOf(['qbittorrent', 'homeassistant', 'tautulli', 'docker']), ['downloads', 'lights', 'what to watch']);
  assert.equal(scopeOf(['http']), undefined);
  assert.equal(label('askAbout', { scope: 'downloads, lights' }), 'Ask about downloads, lights');
});

test('⌘K: an exact name beats asking, asking beats a loose match, and Enter takes what\'s first', () => {
  assert.equal(rank('go Media', 'Media', ['Media']), 1);
  assert.ok(rank('open Plex Media', 'plex', ['Plex']) === 1);
  assert.ok(rank('do Pi-hole Pause 5 min', 'pause', ['Pause 5 min']) > rank('ask', 'pause'));
  assert.ok(rank('do Media Refresh', 'Media', ['Refresh', 'Media Refresh']) < 1);       // a card's name isn't the command's
  assert.ok(rank('ask', 'is anything down') > rank('open Bazarr ', 'bzr', ['Bazarr']));
  assert.ok(rank('ask', 'x') > rank('search web', 'x'));
  assert.equal(rank('go Media', '  '), 1);
});

test('tabs have addresses, and the page\'s own stay its own', () => {
  assert.equal(tabHash('Media'), 'media'); assert.equal(tabHash('PC & desk'), 'pc-desk'); assert.equal(tabHash('Médias'), 'médias');
  assert.equal(tabHash('Recap'), 'tab-recap'); assert.equal(tabHash('Overview'), 'tab-overview');
});

test('the status is one sentence, and says each thing once', () => {
  const line = (...a: Parameters<typeof sayHow>) => { const h = sayHow(...a); return oneLine(h.problems, h.parts); };
  const ok = [{ name: 'Plex', ok: true }, { name: 'Sonarr', ok: true }, { name: 'Off', ok: false, quiet: true }];
  assert.equal(line([status('s.a', ok)]), 'All 2 services are running.');
  assert.equal(line([status('s.a', ok.slice(0, 2))]), 'All 2 services are running.');
  const sick = sayHow([status('s.a', [...ok.slice(0, 2), { name: 'bazarr', ok: false, state: 'degraded' }]), status('s.b', [{ name: 'Bazarr', ok: true }])]);
  assert.equal(oneLine(sick.problems, sick.parts), 'Everything\'s running except Bazarr.');
  assert.equal(line([status('s.b', [...ok, { name: 'mealie', ok: false }, { name: 'x', ok: true }]), status('s.a', [{ name: 'Mealie', ok: false }])]), 'Everything\'s running except Mealie.');
  assert.equal(line([status('s.a', 'abcd'.split('').map(name => ({ name, ok: false })))]), '4 of 4 services need a look.');
  assert.equal(line([status('s.a', [{ name: 'Mealie', ok: false }, { name: 'Bazarr', ok: false, state: 'degraded' }]), dl('↓ 9 MB/s'), dl('↓ 9 MB/s')]), 'Everything\'s running except Mealie and Bazarr and 4 downloads are on the way.');
  assert.equal(line([dl('2 downloads · ↓ 0 B/s', [{ label: 'Pause all', action: 'pause' }])]), '2 downloads are stalled.');
  assert.deepEqual(sayHow([dl('↓ 0 B/s', [{ label: 'Resume all', action: 'resume' }])]).problems, []);   // paused on purpose
  assert.equal(line([dl('↓ 9 MB/s')]), '2 downloads are on the way.');
  assert.equal(line([status('s.a', ok.slice(0, 2)), dl('↓ 9 MB/s')]), 'All 2 services are running and 2 downloads are on the way.');
  assert.equal(line([{ key: 'a.b', at: 0, error: 'x' }]), '1 widget can\'t reach its service.');
  // a meal plan gone stale because Mealie is down is the one problem, not two; a widget whose service seems fine still counts
  const stale = (name: string) => ({ key: 'm.week', at: 0, error: 'timed out', card: { type: 'shelf' as const, title: 'Meal plan', source: { name }, items: [] } });
  assert.equal(line([status('s.a', [{ name: 'Mealie', ok: false }, { name: 'Plex', ok: true }]), stale('mealie')]), 'Everything\'s running except Mealie.');
  assert.equal(line([status('s.a', [{ name: 'Mealie', ok: true }]), stale('Mealie')]), '1 widget can\'t reach its service and all 1 services are running.');
});

test('a chip goes when what it\'s about has come back, and only then', () => {
  const up = [status('s.a', [{ name: 'Mealie', ok: true }, { name: 'Plex', ok: true }])], chips = ['Why is Mealie down?', 'What\'s new on Plex?', 'Turn off the lights'];
  assert.deepEqual(stillTrue(chips, [], up), chips.slice(1));
  assert.deepEqual(stillTrue(['Is Mealie slow today?', 'What\'s new on Plex?'], ['Mealie'], up), ['What\'s new on Plex?']);
  assert.deepEqual(stillTrue(chips, ['Mealie'], [status('s.a', [{ name: 'Mealie', ok: false }])]), chips);
  assert.deepEqual(stillTrue(['Why is Mealie down?'], [], [status('s.a', [{ name: 'Mealie', ok: true }]), status('s.b', [{ name: 'mealie', ok: false }])]), ['Why is Mealie down?']);
});

test('favourites narrow a status card and never hide trouble', () => {
  const card = status('s.a', [{ name: 'Plex', ok: true }, { name: 'Sonarr', ok: true }, { name: 'Mealie', ok: false }]).card, names = ['sonarr', 'plex'];
  const out = favorites(card, names) as any;
  assert.deepEqual(out.items.map((i: any) => i.name), ['Mealie', 'Sonarr', 'Plex']);
  assert.equal(favorites(card, names), out);                                              // the same object, so renderers stay still
  assert.equal(favorites(card), card); assert.equal(favorites(card, ['Nobody']), card);
  const media = { type: 'media', items: [] } as any;
  assert.equal(favorites(media, names), media);
});

test('suggestions lead with what matters most, and needn\'t fill the slots', () => {
  const { system } = suggestPrompt([], [], []);
  assert.match(system, /most consequential/); assert.match(system, /Fewer good ones beat four/); assert.match(system, /at most 4/);
});

test('a sandbox saves nothing', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'valet-')), was = process.env.VALET_DATA;
  process.env.VALET_DATA = dir; sandbox.on = true;
  try {
    await new Timeline().save(); new Activity().add({ who: 'x', via: 'chat', what: 'y', ok: true } as any); await savePins([]);
    await new Promise(r => setTimeout(r, 30));
    assert.deepEqual(await readdir(dir), []);
  } finally { sandbox.on = false; process.env.VALET_DATA = was; if (was === undefined) delete process.env.VALET_DATA; }
});
