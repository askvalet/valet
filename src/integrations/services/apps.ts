// The apps a homelab collects: feeds, code, notes, money, home, sync. See media.ts for the shape of an entry.
import { z } from 'zod';
import { fmt, service, tally } from '../../server/service.ts';

const rows = (v: unknown): any[] => Array.isArray(v) ? v : [];
const sum = (o: unknown) => Object.values((o ?? {}) as Record<string, number>).reduce((a, b) => a + (b ?? 0), 0);
const signed = (pct?: number | null) => pct == null ? undefined : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
const updown = (pct?: number | null) => pct == null ? undefined : pct < 0 ? 'bad' as const : 'good' as const;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Prometheus text: the first sample of a metric, labelled or not
const metric = (text: unknown, name: string) => { const m = String(text ?? '').match(new RegExp(`^${name}(?:\\{[^}]*\\})? (\\S+)`, 'm')); return m ? Number(m[1]) : undefined; };

// Forgejo forked Gitea and kept its API. Totals come back in a header, so limit=1 is enough.
const totalOf = (path: string) => ({ path, as: 'headers' as const });
const total = (h: any) => Number(h?.['x-total-count'] ?? 0);
const forge = (type: string, name: string) => service({
  type, name, icon: 'file', auth: 'bearer',
  get: { repos: totalOf('/api/v1/repos/search?limit=1'), issues: totalOf('/api/v1/repos/issues/search?type=issues&limit=1'), pulls: totalOf('/api/v1/repos/issues/search?type=pulls&limit=1'), notifications: totalOf('/api/v1/notifications?limit=1') },
  recap: d => tally(total(d.repos), { id: 'code', theme: 'code', icon: 'file', kicker: 'Your own forge holds', unit: 'repositories', stat: 'Repositories', scope: 'All time', line: `In ${name}, on hardware you run.` }),
  stats: d => [
    { label: 'Repositories', value: total(d.repos) }, { label: 'Open issues', value: total(d.issues) },
    { label: 'Open PRs', value: total(d.pulls) }, { label: 'Notifications', value: total(d.notifications) }],
  sample: { repos: { 'x-total-count': '1204' }, issues: { 'x-total-count': '37' }, pulls: { 'x-total-count': '4' }, notifications: { 'x-total-count': '2' } },
  expect: { Repositories: '1,204', 'Open issues': 37, 'Open PRs': 4, Notifications: 2 },
});

export default [
  // Reading and saving
  service({
    type: 'miniflux', name: 'Miniflux', icon: 'rss', auth: { header: 'X-Auth-Token' },
    get: { counters: '/v1/feeds/counters' },
    stats: d => [{ label: 'Unread', value: sum(d.counters?.unreads) }, { label: 'Read', value: sum(d.counters?.reads) }],
    recap: d => tally(sum(d.counters?.reads), { id: 'feeds.read', theme: 'reading', icon: 'rss', kicker: 'You read', unit: 'articles', stat: 'Articles read', scope: 'All time', line: 'Chosen by you, in the order they came. No algorithm involved.' }),
    sample: { counters: { reads: { 1: 1200, 4: 34 }, unreads: { 1: 12, 4: 3 } } },
    expect: { Unread: 15, Read: '1,234' },
  }),
  service({
    type: 'linkwarden', name: 'Linkwarden', icon: 'bookmark', auth: 'bearer',
    get: { collections: '/api/v1/collections', tags: '/api/v1/tags' },
    stats: d => {
      const collections = rows(d.collections?.response ?? d.collections), tags = rows(d.tags?.response ?? d.tags?.data?.tags ?? d.tags);
      return [
        { label: 'Links', value: collections.reduce((n, c) => n + (c._count?.links ?? 0), 0) },
        { label: 'Collections', value: collections.length }, { label: 'Tags', value: tags.length }];
    },
    sample: { collections: { response: [{ id: 1, name: 'Unorganized', _count: { links: 1100, members: 0 } }, { id: 2, name: 'Recipes', _count: { links: 42 } }] }, tags: { response: [{ id: 1, name: 'linux' }, { id: 2, name: 'food' }, { id: 3, name: 'work' }] } },
    expect: { Links: '1,142', Collections: 2, Tags: 3 },
  }),
  service({
    type: 'mastodon', name: 'Mastodon', icon: 'news',
    get: { instance: '/api/v1/instance' },
    stats: d => [
      { label: 'Users', value: d.instance?.stats?.user_count ?? 0 }, { label: 'Posts', value: d.instance?.stats?.status_count ?? 0 },
      { label: 'Known servers', value: d.instance?.stats?.domain_count ?? 0 }],
    sample: { instance: { uri: 'social.example.com', title: 'Example', version: '4.3.1', stats: { user_count: 12, status_count: 48210, domain_count: 9120 } } },
    expect: { Users: 12, Posts: '48,210', 'Known servers': '9,120' },
  }),

  // Code
  forge('gitea', 'Gitea'),
  forge('forgejo', 'Forgejo'),
  service<{ user: string | number }>({
    type: 'gitlab', name: 'GitLab', icon: 'file', auth: { header: 'PRIVATE-TOKEN' },
    options: { user: z.union([z.string(), z.number()]) },                // the numeric user id
    about: 'How many projects, groups, issues and merge requests one GitLab user has, not the whole instance.',
    get: o => ({ counts: `/api/v4/users/${o.user}/associations_count` }),
    stats: d => [
      { label: 'Projects', value: d.counts?.projects_count ?? 0 }, { label: 'Groups', value: d.counts?.groups_count ?? 0 },
      { label: 'Issues', value: d.counts?.issues_count ?? 0 }, { label: 'Merge requests', value: d.counts?.merge_requests_count ?? 0 }],
    sample: { counts: { groups_count: 3, projects_count: 1042, issues_count: 87, merge_requests_count: 214 } },
    sampleOptions: { user: 42 },
    expect: { Projects: '1,042', Issues: 87, 'Merge requests': 214 },
  }),

  // Notes and documents
  service({
    type: 'trilium', name: 'Trilium', icon: 'text', auth: { header: 'Authorization' },
    get: { metrics: '/etapi/metrics?format=json' },
    stats: d => [
      { label: 'Notes', value: d.metrics?.database?.activeNotes ?? 0 },
      { label: 'Database', value: fmt.bytes(d.metrics?.statistics?.databaseSizeBytes ?? 0) },
      { label: 'Version', value: d.metrics?.version?.app }],
    sample: { metrics: { version: { app: '0.99.3', db: 233 }, database: { totalNotes: 5400, activeNotes: 5213 }, statistics: { databaseSizeBytes: 157286400 } } },
    expect: { Notes: '5,213', Database: '150.0 MB', Version: '0.99.3' },
  }),
  service({
    type: 'bookstack', name: 'BookStack', icon: 'book', auth: 'token',            // key: "<token id>:<token secret>"
    get: { shelves: '/api/shelves?count=1', books: '/api/books?count=1', chapters: '/api/chapters?count=1', pages: '/api/pages?count=1' },
    stats: d => [
      { label: 'Pages', value: d.pages?.total ?? 0 }, { label: 'Chapters', value: d.chapters?.total ?? 0 },
      { label: 'Books', value: d.books?.total ?? 0 }, { label: 'Shelves', value: d.shelves?.total ?? 0 }],
    sample: { shelves: { data: [{ id: 1, name: 'Home' }], total: 4 }, books: { data: [{ id: 1, name: 'Network' }], total: 21 }, chapters: { data: [{ id: 1, name: 'VLANs' }], total: 66 }, pages: { data: [{ id: 1, name: 'Setup' }], total: 1310 } },
    expect: { Pages: '1,310', Books: 21, Shelves: 4 },
  }),
  service({
    type: 'outline', name: 'Outline', icon: 'text', auth: 'bearer',
    get: { documents: { path: '/api/documents.list', method: 'POST', body: { limit: 1 } }, collections: { path: '/api/collections.list', method: 'POST', body: { limit: 1 } } },
    stats: d => [{ label: 'Documents', value: d.documents?.pagination?.total }, { label: 'Collections', value: d.collections?.pagination?.total }],
    sample: { documents: { data: [{ id: 'a1', title: 'Runbook' }], pagination: { limit: 1, offset: 0, total: 318 } }, collections: { data: [{ id: 'c1', name: 'Team' }], pagination: { limit: 1, offset: 0, total: 6 } } },
    expect: { Documents: 318, Collections: 6 },
  }),
  service<{ key?: string }>({
    type: 'stirling-pdf', name: 'Stirling-PDF', icon: 'file',
    options: { key: z.string().optional() },                             // only when its login is turned on
    get: o => ({ info: { path: '/api/v1/info/status', headers: o.key ? { 'X-API-KEY': o.key } as Record<string, string> : {} } }),
    stats: d => [
      { label: 'Status', value: d.info?.status, tone: d.info?.status === 'UP' ? 'good' : 'bad' },
      { label: 'Version', value: d.info?.version }],
    sample: { info: { status: 'UP', version: '1.5.0' } },
    expect: { Status: 'UP', Version: '1.5.0' },
  }),

  // Money
  service({
    type: 'firefly', name: 'Firefly III', logo: 'firefly-iii', icon: 'coins', auth: 'bearer',
    get: () => {
      const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1), last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { summary: `/api/v1/summary/basic?start=${ymd(first)}&end=${ymd(last)}` };
    },
    stats: d => {
      // keyed by currency: "net-worth-in-EUR"
      const of = (kind: string) => Object.entries<any>(d.summary ?? {}).find(([k]) => k.startsWith(`${kind}-in-`))?.[1]?.value_parsed;
      return [
        { label: 'Net worth', value: of('net-worth') }, { label: 'Spent this month', value: of('spent') },
        { label: 'Earned this month', value: of('earned') }, { label: 'Left to spend', value: of('left-to-spend') }];
    },
    sample: { summary: {
      'net-worth-in-EUR': { key: 'net-worth-in-EUR', title: 'Net worth in EUR', monetary_value: 12345.67, currency_code: 'EUR', currency_symbol: '€', value_parsed: '€12,345.67' },
      'spent-in-EUR': { key: 'spent-in-EUR', title: 'Spent in EUR', monetary_value: -1204.5, currency_code: 'EUR', currency_symbol: '€', value_parsed: '-€1,204.50' },
      'earned-in-EUR': { key: 'earned-in-EUR', title: 'Earned in EUR', monetary_value: 3100, currency_code: 'EUR', currency_symbol: '€', value_parsed: '€3,100.00' },
      'left-to-spend-in-EUR': { key: 'left-to-spend-in-EUR', title: 'Left to spend in EUR', monetary_value: 412.1, currency_code: 'EUR', currency_symbol: '€', value_parsed: '€412.10' } } },
    expect: { 'Net worth': '€12,345.67', 'Spent this month': '-€1,204.50', 'Left to spend': '€412.10' },
  }),
  service({
    type: 'ghostfolio', name: 'Ghostfolio', icon: 'chart', auth: 'bearer',        // key: the JWT from /api/v1/auth/anonymous
    get: { day: '/api/v2/portfolio/performance?range=1d', year: '/api/v2/portfolio/performance?range=1y', max: '/api/v2/portfolio/performance?range=max', user: { path: '/api/v1/user', optional: true } },
    stats: d => {
      // the field has been renamed twice
      const pct = (r: any) => { const p = r?.performance, x = p?.netPerformancePercentageWithCurrencyEffect ?? p?.grossPerformancePercentage ?? p?.currentGrossPerformancePercent; return x == null ? undefined : x * 100; };
      const worth = d.day?.performance?.currentNetWorth ?? d.day?.performance?.currentValueInBaseCurrency;
      return [
        { label: 'Today', value: signed(pct(d.day)), tone: updown(pct(d.day)) }, { label: 'This year', value: signed(pct(d.year)), tone: updown(pct(d.year)) },
        { label: 'All time', value: signed(pct(d.max)), tone: updown(pct(d.max)) }, { label: 'Net worth', value: worth, unit: d.user?.settings?.baseCurrency }];
    },
    sample: { day: { performance: { currentNetWorth: 84210.5, netPerformancePercentageWithCurrencyEffect: 0.0042 } }, year: { performance: { netPerformancePercentageWithCurrencyEffect: 0.1187 } }, max: { performance: { netPerformancePercentageWithCurrencyEffect: -0.031 } }, user: { settings: { baseCurrency: 'USD' } } },
    expect: { Today: '+0.42%', 'This year': '+11.87%', 'All time': '-3.10%', 'Net worth': '84,210.5' },
  }),
  service({
    type: 'wallos', name: 'Wallos', icon: 'coins', auth: { query: 'api_key' },
    get: () => {
      const month = (ahead: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + ahead); return `month=${d.getMonth() + 1}&year=${d.getFullYear()}`; };
      return { subs: '/api/subscriptions/get_subscriptions.php?state=0&sort=next_payment', now: `/api/subscriptions/get_monthly_cost.php?${month(0)}`, next: `/api/subscriptions/get_monthly_cost.php?${month(1)}` };
    },
    stats: d => {
      // a bad key is still a 200
      if (d.subs?.success === false) throw new Error(`Wallos said: ${d.subs.title}`);
      const subs = rows(d.subs?.subscriptions);
      return [
        { label: 'This month', value: d.now?.localized_monthly_cost }, { label: 'Next month', value: d.next?.localized_monthly_cost },
        { label: 'Subscriptions', value: subs.length }, { label: 'Next renewal', value: subs[0]?.name ?? 'None', sub: subs[0]?.next_payment || undefined }];
    },
    sample: { subs: { success: true, title: 'subscriptions', subscriptions: [{ id: 3, name: 'Backblaze', price: 9, next_payment: '2026-11-03', currency_id: 1 }, { id: 7, name: 'Fastmail', price: 5, next_payment: '2026-11-19', currency_id: 1 }] },
      now: { success: true, title: 'monthly_cost', monthly_cost: '42.50', currency_code: 'USD', currency_symbol: '$', localized_monthly_cost: '$42.50' },
      next: { success: true, title: 'monthly_cost', monthly_cost: '38.00', currency_code: 'USD', currency_symbol: '$', localized_monthly_cost: '$38.00' } },
    expect: { 'This month': '$42.50', 'Next month': '$38.00', Subscriptions: 2, 'Next renewal': 'Backblaze' },
  }),
  service<{ symbols: string[]; currency: string }>({
    type: 'coinmarketcap', name: 'CoinMarketCap', icon: 'coins', auth: { header: 'X-CMC_PRO_API_KEY' },
    // a hosted API, and its free plan allows about 330 calls a day
    options: { url: z.string().url().default('https://pro-api.coinmarketcap.com'), every: z.number().default(600), symbols: z.array(z.string()).min(1), currency: z.string().default('USD') },
    get: o => ({ quotes: `/v1/cryptocurrency/quotes/latest?symbol=${o.symbols.join(',')}&convert=${o.currency}` }),
    stats: (d, o) => Object.values<any>(d.quotes?.data ?? {}).map(c => {
      const q = c.quote?.[o.currency], price = q?.price as number | undefined;
      return { label: c.name ?? c.symbol, value: price?.toLocaleString('en', price < 1 ? { maximumSignificantDigits: 4 } : { maximumFractionDigits: 2 }), unit: o.currency,
        sub: signed(q?.percent_change_24h), tone: updown(q?.percent_change_24h) };
    }),
    sample: { quotes: { status: { error_code: 0 }, data: {
      BTC: { id: 1, name: 'Bitcoin', symbol: 'BTC', quote: { USD: { price: 67123.4567, percent_change_24h: 1.234 } } },
      DOGE: { id: 74, name: 'Dogecoin', symbol: 'DOGE', quote: { USD: { price: 0.1234567, percent_change_24h: -2.5 } } } } } },
    sampleOptions: { symbols: ['BTC', 'DOGE'], currency: 'USD' },
    expect: { Bitcoin: '67,123.46', Dogecoin: '0.1235' },
  }),

  // Home and everyday
  service<{ version: number }>({
    type: 'mealie', name: 'Mealie', icon: 'book', auth: 'bearer',
    options: { version: z.union([z.literal(1), z.literal(2)]).default(2) },
    get: o => ({ stats: o.version === 1 ? '/api/groups/statistics' : '/api/households/statistics' }),
    stats: d => [
      { label: 'Recipes', value: d.stats?.totalRecipes ?? 0 }, { label: 'Categories', value: d.stats?.totalCategories ?? 0 },
      { label: 'Tags', value: d.stats?.totalTags ?? 0 }, { label: 'Users', value: d.stats?.totalUsers ?? 0 }],
    sample: { stats: { totalRecipes: 1312, totalUsers: 2, totalCategories: 14, totalTags: 38, totalTools: 6 } },
    expect: { Recipes: '1,312', Tags: 38, Users: 2 },
  }),
  service({
    type: 'tandoor', name: 'Tandoor', icon: 'book', auth: 'bearer',
    get: { space: '/api/space/', keywords: '/api/keyword/' },
    stats: d => {
      const space = rows(d.space?.results ?? d.space)[0];
      return [{ label: 'Recipes', value: space?.recipe_count ?? 0 }, { label: 'Keywords', value: d.keywords?.count ?? 0 }, { label: 'Users', value: space?.user_count ?? 0 }];
    },
    recap: d => tally(rows(d.space?.results ?? d.space)[0]?.recipe_count, { id: 'recipes', theme: 'food', icon: 'book', kicker: 'Your cookbook has', unit: 'recipes', stat: 'Recipes', scope: 'All time', line: 'All of them without a life story above the ingredients.' }),
    sample: { space: { count: 1, results: [{ id: 1, name: 'Home', user_count: 2, recipe_count: 1204 }] }, keywords: { count: 96, results: [{ id: 1, name: 'dinner' }] } },
    expect: { Recipes: '1,204', Keywords: 96, Users: 2 },
  }),
  service({
    type: 'vikunja', name: 'Vikunja', icon: 'calendar', auth: 'bearer',
    // /tasks/all became /tasks in 1.0
    get: { projects: '/api/v1/projects', tasks: { path: '/api/v1/tasks?filter=done%3Dfalse&sort_by=due_date', optional: true }, older: { path: '/api/v1/tasks/all?filter=done%3Dfalse&sort_by=due_date', optional: true } },
    stats: d => {
      // both paths are optional, so say so rather than show no tasks
      if (!d.tasks && !d.older) throw new Error('Vikunja answered neither tasks path: does the token allow reading tasks?');
      const tasks = rows(d.tasks ?? d.older), now = Date.now(), week = now + 7 * 864e5;
      const due = tasks.filter(t => t.due_date && !t.due_date.startsWith('0001-')).map(t => new Date(t.due_date).getTime());
      return [
        { label: 'Overdue', value: due.filter(t => t <= now).length }, { label: 'Due this week', value: due.filter(t => t > now && t <= week).length },
        { label: 'In progress', value: tasks.filter(t => t.percent_done > 0 && t.percent_done < 1).length },
        { label: 'Projects', value: rows(d.projects).filter(p => p.id > 0).length }];          // saved filters have ids below 0
    },
    sample: { projects: [{ id: 1, title: 'Inbox' }, { id: 2, title: 'House' }, { id: -2, title: 'A saved filter' }],
      tasks: [{ id: 1, title: 'Renew domain', due_date: '2020-01-01T09:00:00Z', percent_done: 0 }, { id: 2, title: 'Fix fence', due_date: new Date(Date.now() + 2 * 864e5).toISOString(), percent_done: 0.5 }, { id: 3, title: 'Read manual', due_date: '0001-01-01T00:00:00Z', percent_done: 0 }],
      older: [] },
    expect: { Overdue: 1, 'Due this week': 1, 'In progress': 1, Projects: 2 },
  }),
  service({
    type: 'homebox', name: 'Homebox', icon: 'home',
    // the token it hands back already starts with "Bearer"
    auth: { login: '/api/v1/users/login', body: c => new URLSearchParams({ username: c.username ?? '', password: c.password ?? '' }), token: r => r.token, use: t => ({ Authorization: t }) },
    get: { stats: '/api/v1/groups/statistics', group: { path: '/api/v1/groups', optional: true } },
    stats: d => [
      { label: 'Items', value: d.stats?.totalItems ?? 0 }, { label: 'Locations', value: d.stats?.totalLocations ?? 0 },
      { label: 'Under warranty', value: d.stats?.totalWithWarranty ?? 0 }, { label: 'Value', value: d.stats?.totalItemPrice ?? 0, unit: d.group?.currency }],
    sample: { stats: { totalUsers: 2, totalItems: 1432, totalLocations: 18, totalLabels: 12, totalItemPrice: 18250.5, totalWithWarranty: 26 }, group: { id: 'b1', name: 'Home', currency: 'USD' } },
    expect: { Items: '1,432', Locations: 18, Value: '18,250.5' },
  }),
  service({
    type: 'lubelogger', name: 'LubeLogger', icon: 'home', auth: 'basic',
    get: { vehicles: '/api/vehicle/info' },
    stats: d => {
      const cars = rows(d.vehicles), add = (f: (v: any) => number | undefined) => cars.reduce((n, v) => n + (f(v) ?? 0), 0);
      return [
        { label: 'Vehicles', value: cars.length }, { label: 'Service records', value: add(v => v.serviceRecordCount) },
        { label: 'Reminders', value: add(v => (v.veryUrgentReminderCount ?? 0) + (v.urgentReminderCount ?? 0) + (v.notUrgentReminderCount ?? 0)) },
        { label: 'Urgent', value: add(v => (v.veryUrgentReminderCount ?? 0) + (v.urgentReminderCount ?? 0)) }];
    },
    sample: { vehicles: [
      { vehicleData: { id: 1, year: 2016, make: 'Mazda', model: 'CX-5' }, veryUrgentReminderCount: 1, urgentReminderCount: 0, notUrgentReminderCount: 2, serviceRecordCount: 41 },
      { vehicleData: { id: 2, year: 2009, make: 'Honda', model: 'Fit' }, veryUrgentReminderCount: 0, urgentReminderCount: 1, notUrgentReminderCount: 0, serviceRecordCount: 17 }] },
    expect: { Vehicles: 2, 'Service records': 58, Reminders: 4, Urgent: 2 },
  }),
  service({
    type: 'plant-it', name: 'Plant-it', icon: 'home', auth: { header: 'Key' },
    get: { stats: '/api/stats' },
    stats: d => [
      { label: 'Plants', value: d.stats?.plantCount ?? 0 }, { label: 'Species', value: d.stats?.botanicalInfoCount ?? 0 },
      { label: 'Diary entries', value: d.stats?.diaryEntryCount ?? 0 }, { label: 'Photos', value: d.stats?.imageCount ?? 0 }],
    sample: { stats: { diaryEntryCount: 1280, plantCount: 34, imageCount: 212, botanicalInfoCount: 27 } },
    expect: { Plants: 34, 'Diary entries': '1,280', Photos: 212 },
  }),
  service({
    type: 'sparkyfitness', name: 'SparkyFitness', icon: 'pulse', auth: { header: 'X-API-Key' },
    get: { stats: '/api/dashboard/stats' },
    stats: d => [
      { label: 'Eaten', value: d.stats?.eaten ?? 0 }, { label: 'Burned', value: d.stats?.burned ?? 0 },
      { label: 'Remaining', value: d.stats?.remaining ?? 0 }, { label: 'Steps', value: d.stats?.steps ?? 0 }],
    sample: { stats: { eaten: 1640, burned: 420, remaining: 780, steps: 8412 } },
    expect: { Eaten: '1,640', Remaining: 780, Steps: '8,412' },
  }),

  // Sync, storage, automation
  service({
    type: 'syncthing', name: 'Syncthing', icon: 'disk', auth: { header: 'X-API-Key' },
    get: { connections: '/rest/system/connections', folders: { path: '/rest/config/folders', optional: true } },
    stats: d => {
      const peers = Object.values<any>(d.connections?.connections ?? {});
      return [
        { label: 'Devices online', value: peers.filter(p => p.connected).length, sub: `of ${peers.length}` }, { label: 'Folders', value: rows(d.folders).length },
        { label: 'Received', value: fmt.bytes(d.connections?.total?.inBytesTotal ?? 0) }, { label: 'Sent', value: fmt.bytes(d.connections?.total?.outBytesTotal ?? 0) }];
    },
    recap: d => { const moved = (d.connections?.total?.inBytesTotal ?? 0) + (d.connections?.total?.outBytesTotal ?? 0); return tally(moved, { id: 'sync.moved', theme: 'files', icon: 'disk', kicker: 'Your devices passed around', value: fmt.bytes(moved), scope: 'Since Syncthing last restarted', line: 'From one to the next, with no cloud account holding the copy.' }); },
    sample: { connections: { total: { at: '2026-10-31T10:00:00Z', inBytesTotal: 1073741824, outBytesTotal: 536870912 }, connections: { 'AAAAAAA-BBBBBBB': { connected: true, paused: false, inBytesTotal: 1073741824, outBytesTotal: 536870912 }, 'CCCCCCC-DDDDDDD': { connected: false, paused: false, inBytesTotal: 0, outBytesTotal: 0 } } },
      folders: [{ id: 'default', label: 'Default', paused: false }, { id: 'photos', label: 'Photos', paused: false }] },
    expect: { 'Devices online': 1, Folders: 2, Received: '1.0 GB', Sent: '512.0 MB' },
  }),
  service({
    type: 'syncthing-relay', name: 'Syncthing Relay', logo: 'syncthing', icon: 'wifi',
    get: { status: '/status' },
    stats: d => [
      { label: 'Sessions', value: d.status?.numActiveSessions ?? 0 }, { label: 'Connections', value: d.status?.numConnections ?? 0 },
      { label: 'Relayed', value: fmt.bytes(d.status?.bytesProxied ?? 0) },
      { label: 'Rate', value: fmt.rate((d.status?.kbps10s1m5m15m30m60m?.[2] ?? 0) * 125), sub: 'last 5 min' }],     // kbit/s to bytes
    sample: { status: { numActiveSessions: 12, numConnections: 340, bytesProxied: 5368709120, kbps10s1m5m15m30m60m: [900, 820, 800, 760, 700, 640] } },
    expect: { Sessions: 12, Connections: 340, Relayed: '5.0 GB', Rate: '97.7 KB/s' },
  }),
  service<{ key?: string }>({
    type: 'minio', name: 'MinIO', icon: 'disk',
    options: { key: z.string().optional() },                             // from `mc admin prometheus generate`; none if metrics are public
    get: o => ({ metrics: { path: '/minio/v2/metrics/cluster', as: 'text', headers: { Accept: 'text/plain', ...(o.key ? { Authorization: `Bearer ${o.key}` } : {}) } } }),
    stats: d => {
      const size = metric(d.metrics, 'minio_cluster_capacity_usable_total_bytes'), free = metric(d.metrics, 'minio_cluster_capacity_usable_free_bytes');
      const used = size != null && free != null ? size - free : undefined;
      return [
        { label: 'Used', value: used == null ? undefined : fmt.bytes(used), sub: size ? `of ${fmt.bytes(size)}` : undefined, pct: used != null && size ? used / size : undefined },
        { label: 'Objects', value: metric(d.metrics, 'minio_cluster_usage_object_total') }, { label: 'Buckets', value: metric(d.metrics, 'minio_cluster_bucket_total') },
        { label: 'Nodes online', value: metric(d.metrics, 'minio_cluster_nodes_online_total') }];
    },
    sample: { metrics: `# HELP minio_cluster_capacity_usable_total_bytes Total usable capacity online in the cluster
# TYPE minio_cluster_capacity_usable_total_bytes gauge
minio_cluster_capacity_usable_total_bytes{server="10.0.0.5:9000"} 4.398046511104e+12
minio_cluster_capacity_usable_free_bytes{server="10.0.0.5:9000"} 3.298534883328e+12
minio_cluster_usage_object_total{server="10.0.0.5:9000"} 182044
minio_cluster_bucket_total{server="10.0.0.5:9000"} 7
minio_cluster_nodes_online_total{server="10.0.0.5:9000"} 3
` },
    expect: { Used: '1.0 TB', Objects: '182,044', Buckets: 7, 'Nodes online': 3 },
  }),
  service({
    type: 'vaultwarden', name: 'Vaultwarden', icon: 'shield',
    get: { alive: '/alive', version: { path: '/api/version', optional: true } },
    stats: d => [{ label: 'Status', value: 'Alive', tone: 'good' }, { label: 'Version', value: d.version }],
    sample: { alive: '2026-10-31T10:00:00.000000Z', version: '1.34.3' },
    expect: { Status: 'Alive', Version: '1.34.3' },
  }),
  service({
    type: 'n8n', name: 'n8n', icon: 'pulse', auth: { header: 'X-N8N-API-KEY' },
    get: { active: '/api/v1/workflows?active=true&limit=250', failed: '/api/v1/executions?status=error&limit=250' },
    stats: d => {
      // one page at most: a next page means there are more than this
      const count = (r: any) => `${rows(r?.data).length}${r?.nextCursor ? '+' : ''}`;
      return [{ label: 'Active workflows', value: count(d.active) }, { label: 'Failed runs', value: count(d.failed) }];
    },
    sample: { active: { data: [{ id: 'a1', name: 'Backups', active: true }, { id: 'a2', name: 'Digest', active: true }], nextCursor: null }, failed: { data: [{ id: '9001', status: 'error', workflowId: 'a1' }], nextCursor: 'MTIz' } },
    expect: { 'Active workflows': 2, 'Failed runs': '1+' },
  }),
  service({
    type: 'open-webui', name: 'Open WebUI', icon: 'text', auth: 'bearer',
    get: { models: '/api/models', version: { path: '/api/version', optional: true } },
    stats: d => [{ label: 'Models', value: rows(d.models?.data ?? d.models).length }, { label: 'Version', value: d.version?.version }],
    sample: { models: { data: [{ id: 'llama3:8b', name: 'llama3:8b', object: 'model' }, { id: 'qwen2:7b', name: 'qwen2:7b', object: 'model' }] }, version: { version: '0.6.5' } },
    expect: { Models: 2, Version: '0.6.5' },
  }),
  service({
    type: 'develancache-ui', name: 'DeveLanCacheUI', logo: 'lancache', icon: 'download',
    get: { stats: '/DownloadStats/GetTotalDownloadStats' },
    stats: d => {
      const hit = d.stats?.totalCacheHitBytes ?? 0, miss = d.stats?.totalCacheMissBytes ?? 0;
      return [{ label: 'Hit rate', value: hit + miss ? fmt.pct(hit / (hit + miss)) : undefined }, { label: 'From cache', value: fmt.bytes(hit) }, { label: 'From the internet', value: fmt.bytes(miss) }];
    },
    sample: { stats: { totalCacheHitBytes: 322122547200, totalCacheMissBytes: 107374182400 } },
    expect: { 'Hit rate': '75%', 'From cache': '300.0 GB', 'From the internet': '100.0 GB' },
  }),
  service({
    type: 'freshrss', name: 'FreshRSS', icon: 'rss',
    auth: { login: '/api/greader.php/accounts/ClientLogin', text: true, body: c => new URLSearchParams({ Email: c.username ?? '', Passwd: c.password ?? '' }), token: t => /Auth=(.+)/.exec(t)?.[1] ?? '', use: t => ({ Authorization: `GoogleLogin auth=${t}` }) },
    get: { subs: '/api/greader.php/reader/api/0/subscription/list?output=json', unread: '/api/greader.php/reader/api/0/unread-count?output=json' },
    stats: d => [{ label: 'Unread', value: d.unread?.max ?? 0 }, { label: 'Feeds', value: d.subs?.subscriptions?.length ?? 0 }],
    sample: { subs: { subscriptions: [{}, {}, {}] }, unread: { max: 1204 } },
    loginSample: 'SID=x\nLSID=null\nAuth=abc\n',
    expect: { Unread: '1,204', Feeds: 3 },
  }),
];
