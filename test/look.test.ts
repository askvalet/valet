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
import { clock, day, firstDay, label, num, setFormat } from '../src/web/format.ts';

const refused = (raw: unknown) => assert.equal(Config.safeParse(raw).success, false, JSON.stringify(raw));
const look = (raw: object) => lookOf(Config.parse(raw));

test('defaults: an old config keeps the old look, to the letter', () => {
  assert.deepEqual(look({}), { vars: {}, classes: [] });
  assert.deepEqual(look({ appearance: { wallpaper: 'w.jpg' } }), { vars: {}, classes: [] });
  const c = Config.parse({ menubar: ['a.b'], nav: { side: 'top' }, island: { activities: ['a.b'] } });
  assert.deepEqual(c.menubar, { widgets: ['a.b'], position: 'right', labels: true, clock: true, date: true, theme: true, size: 1 });
  assert.deepEqual(c.nav, { side: 'top', style: 'icons', hide: [], size: 1 });
  assert.equal(c.island?.position, 'top');
  assert.deepEqual(c.hero, { greeting: true, status: true, search: true, review: true, align: 'center' });
  assert.deepEqual(c.chat, { open: 'center', overview: true, suggestions: 'ai', steps: true, thinking: 'collapsed', send: 'enter' });
  assert.deepEqual(c.format, { clock: 'auto', date: 'short', weekStart: 'auto', temperature: 'auto', distance: 'auto', locale: 'auto' });
  assert.equal(c.appearance.theme, 'auto');
  assert.equal(c.appearance.dim, .35);
  const plain = Config.parse({ layout: [{ widgets: ['a.b', { widget: 'c.d', size: 'tall' }], columns: 2 }] }).layout[0];
  assert.equal(plain.columns, 2);
  assert.deepEqual(plain.widgets, [{ widget: 'a.b', size: 'medium' }, { widget: 'c.d', size: 'tall' }]);
});

test('every appearance option reaches the page as a variable or a class', () => {
  const { vars: v, classes } = look({
    appearance: {
      colors: { accent: '#ffd400', good: 'green', warn: 'rgb(1 2 3)', bad: 'hsl(0 80% 50%)', card: 'tomato' }, dim: .1, blur: 12, density: 'compact', gap: 20, sectionGap: 50, maxWidth: '90vw', rowHeight: 200, motion: 'none',
      font: { family: 'Inter', mono: 'Fira Code', scale: 1.2, headingWeight: 800 }, shape: { radius: 0, border: 2, borderColor: '#000', shadow: 'none' }, glass: { opacity: .4, blur: 72 },
    },
    chat: { width: 500, height: '80vh', bubble: '#111111' }, nav: { size: 1.5 }, menubar: { size: 1.2 }, island: { size: .8 },
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
  assert.equal(v['--nav-size'], '66px'); assert.equal(v['--bar-zoom'], '1.2'); assert.equal(v['--island-zoom'], '0.8');
  assert.deepEqual(look({ appearance: { glass: { blur: 0 } } }).classes, ['no-blur']);
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
    { theme: 'sepia' }, { density: 'cosy' }, { motion: 'slow' }, { dim: 2 }, { glass: { opacity: 2 } }, { glass: { blur: -1 } }, { shape: { shadow: 'huge' } }, { shape: { radius: 400 } },
    { font: { family: 'A</style>' } }, { font: { family: 'A; color: red' } }, { font: { url: 'https://x.test/f.woff2' } }, { font: { family: 'A', url: 'notes.txt' } }, { font: { scale: 9 } },
    { maxWidth: '100px; color: red' }, { cssFile: '/etc/passwd' }, { sizes: { huge: { cols: 1 } } }, { sizes: { tall: { cols: 9 } } }, { rotate: 'soon' },
  ]) refused({ appearance });
  for (const widget of [{ tint: 'red;' }, { background: 'javascript:alert(1)' }, { background: 'https://x/a.jpg") ; x' }, { opacity: 3 }, { size: 'huge' }, { nope: 1 }]) refused({ layout: [{ widgets: [{ widget: 'a.b', ...widget }] }] });
  refused({ layout: [{ widgets: [], columns: { phone: 9 } }] }); refused({ layout: [{ widgets: [], columns: { watch: 1 } }] });
  for (const c of [{ hero: { align: 'up' } }, { chat: { open: 'top' } }, { chat: { suggestions: 'maybe' } }, { chat: { width: 'wide' } }, { nav: { style: 'emoji' } }, { menubar: { position: 'up' } }, { island: { position: 'side' } }, { format: { clock: '13h' } }, { format: { locale: 'not a locale!' } }, { labels: { nonsense: 'x' } }]) refused(c);
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
  assert.match(clock(t), /^3:07\sPM$/); assert.equal(day(t), 'Saturday, October 31'); assert.equal(firstDay(), 0);
  setFormat({ clock: 'auto', date: 'short', weekStart: 'auto', locale: 'auto' }, LABELS);
});
