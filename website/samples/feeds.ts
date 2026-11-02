// What comes in from outside: feeds, news, releases, prices. Every headline here is made up.
import { DAY, HOUR, ago, over, route, wave } from './helpers.ts';
import type { Fixture } from './types.ts';

// ── RSS and Atom
const HEADLINES = [['Why I moved my photos off the cloud', 'Field Notes', 1], ['A year of running my own mail', 'Field Notes', 5], ['The case for boring hardware', 'Small Server', 3], ['ZFS scrubs, explained', 'Small Server', 26], ['Notes from a very quiet rack', 'Rackside', 7], ['Replacing a dead fan at 2 a.m.', 'Rackside', 31], ['On keeping old laptops alive', 'Rackside', 50], ['A short history of the home server', 'Field Notes', 72]] as const;
const item = (title: string, h: number, thumb: boolean) => `<item><title>${title}</title><link>https://blog.example.net/${h}</link><pubDate>${new Date(Date.now() - h * HOUR).toUTCString()}</pubDate><description>A note about ${title.toLowerCase()}.</description>${thumb ? `<media:thumbnail url="https://art.example/feed-${h}.jpg"/>` : ''}</item>`;
const feed = (name: string, thumb = false) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${name}</title>${HEADLINES.filter(h => h[1] === name).map(([t, , h]) => item(t, h, thumb)).join('')}</channel></rss>`;
const rss = (thumb = false) => route([['fieldnotes', feed('Field Notes', thumb)], ['smallserver', feed('Small Server', thumb)], ['rackside', feed('Rackside', thumb)]]);
const FEEDS = { feeds: [{ url: 'https://fieldnotes.example.com/feed.xml', name: 'Field Notes' }, { url: 'https://smallserver.example.com/rss', name: 'Small Server' }, { url: 'https://rackside.example.org/atom.xml', name: 'Rackside' }] };

// ── Hacker News
const hit = ([title, url, points, num_comments, h]: readonly [string, string | undefined, number, number, number], i: number) => ({ objectID: String(4100 + i), title, url, points, num_comments, created_at: ago(h * HOUR) });
const STORIES = [['Show HN: I replaced my NAS with three old laptops', 'https://example.com/nas', 412, 188, 3], ['The surprising durability of cheap SSDs', 'https://drives.example.org/ssd', 288, 94, 5], ['Ask HN: What do you self-host that you can\'t live without?', undefined, 241, 312, 7], ['A plain text format for home inventories', 'https://blog.example.net/inventory', 176, 41, 9], ['How a one-line cron job cost us a weekend', 'https://notes.example.com/cron', 154, 77, 12], ['Reverse engineering a thermostat\'s cloud API', 'https://home.example.org/thermostat', 131, 52, 14], ['Why your backups are not backups yet', 'https://storage.example.org/backups', 98, 36, 18]] as const;

// ── Lobsters
const LOBSTERS = [['Designing a small config language', 41, 7, ['plt'], 2], ['What the kernel does with your idle CPU', 36, 12, ['linux'], 6], ['Self-hosting mail in the current year', 29, 31, ['networking', 'selfhosted'], 9], ['Time zones are a data problem', 24, 9, ['programming'], 13], ['A tour of SQLite\'s write-ahead log', 21, 5, ['databases'], 20], ['Building a homelab that stays quiet', 17, 14, ['hardware'], 25]]
  .map(([title, score, comment_count, tags, h], i) => ({ title, score, comment_count, tags, created_at: ago(+h! * HOUR), comments_url: `https://lobste.rs/s/${i}`, url: `https://blog.example.net/l${i}` }));

// ── Reddit
const post = (title: string, subreddit: string, score: number, num_comments: number, h: number, picture: boolean, i: number) => ({ data: { title, subreddit, score, num_comments, created_utc: Math.floor((Date.now() - h * HOUR) / 1000), permalink: `/r/${subreddit}/comments/x${i}/`, is_self: !picture, url: `https://art.example/post${i}`, thumbnail: picture ? `https://art.example/post${i}.jpg` : 'self', preview: picture ? { images: [{ resolutions: [{ url: `https://art.example/post${i}.jpg` }] }] } : undefined, selftext: picture ? '' : 'A few lines about it.', stickied: false } });
const reddit = (posts: unknown[][]) => route([['/r/selfhosted/', { data: { children: posts[0] } }], ['/r/homelab/', { data: { children: posts[1] } }]]);
const POSTS = [[post('What finally got my family to use the home server', 'selfhosted', 2410, 318, 4, false, 1), post('A one-page dashboard for everything', 'selfhosted', 1820, 142, 8, true, 2), post('Backups: how do you test yours?', 'selfhosted', 960, 204, 11, false, 3)],
  [post('Finally finished the rack', 'homelab', 3120, 188, 6, true, 4), post('Three mini PCs and a very small switch', 'homelab', 1490, 96, 10, true, 5), post('The noise fix nobody told me about', 'homelab', 740, 61, 15, false, 6)]];

// ── GitHub
const REPOS = ['immich-app/immich', 'paperless-ngx/paperless-ngx', 'home-assistant/core', 'louislam/uptime-kuma', 'jellyfin/jellyfin', 'pi-hole/pi-hole'];
const tagFor = (repo: string) => `v${repo.length % 3 + 1}.${repo.length}.${repo.charCodeAt(0) % 7}`;
const release = (repo: string, prerelease = false) => ({ tag_name: prerelease ? `${tagFor(repo)}-rc.1` : tagFor(repo), name: prerelease ? 'Release candidate' : tagFor(repo), published_at: ago(((repo.length * 7) % 40 + 1) * DAY), html_url: `https://github.com/${repo}/releases/tag/${tagFor(repo)}`, body: 'Fixes and small improvements.', prerelease, draft: false });
const repoOf = (url: string) => /repos\/([^/]+\/[^/?]+)/.exec(url)?.[1] ?? '';
const github = route([
  [/\/releases\/latest$/, (u: string) => release(repoOf(u))], [/\/releases\?per_page=3$/, (u: string) => [release(repoOf(u), repoOf(u).startsWith('home')), release(repoOf(u))]],
  ['/search/issues', (u: string) => ({ total_count: u.length % 40 + 3 })],
  [/\/repos\/[^/]+\/[^/?]+$/, (u: string) => { const r = repoOf(u); return { stargazers_count: r.length * 4_100, forks_count: r.length * 320, open_issues_count: r.length * 12, pushed_at: ago((r.length % 6 + 1) * DAY), html_url: `https://github.com/${r}` }; }],
]);

// ── Yahoo's chart endpoint
const quote = (name: string, price: number, prev: number, seed: number, currency = 'USD') => ({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev, shortName: name, currency }, indicators: { quote: [{ close: Array.from({ length: 26 }, (_, i) => prev + (price - prev) * (i / 25) + (wave(i + seed, -1, 1)) * Math.abs(price * .004)) }] } }] } });
const markets = route([['/chart/ACME', quote('Acme Industries', 184.62, 181.3, 1)], ['/chart/NRTH', quote('Northwind Foods', 42.18, 43.05, 5)], ['/chart/INDEX', quote('Example 500', 5_912.4, 5_894.2, 9)], ['/chart/BTC-USD', quote('Bitcoin', 68_412, 69_180, 13)], ['/chart/EURUSD', quote('EUR/USD', 1.0842, 1.0818, 17, 'USD')]]);

// ── Twitch
const stream = (user_name: string, game_name: string, title: string, viewer_count: number) => ({ user_name, user_login: user_name.toLowerCase(), game_name, title, viewer_count });
const LIVE = [stream('NorthernSignal', 'Chess', 'Rapid with viewers', 8421), stream('QuietKeep', 'Retro', 'First playthrough', 1204), stream('HarbourFM', 'Music', 'Late night records', 386)];
const twitch = (live: unknown[]) => route([['oauth2/token', { access_token: 'sample' }], ['helix/streams', { data: live }], ['helix/games/top', { data: ['Just Chatting', 'Chess', 'Retro', 'Music', 'Software and Game Development', 'Science & Technology'].map(name => ({ name })) }]]);

export const feeds: Record<string, Fixture> = {
  rss: {
    config: { ...FEEDS, title: 'Feeds', limit: 8 }, http: rss(),
    states: [
      { widget: 'latest', state: 'shelf', label: 'As thumbnails', config: { style: 'shelf' }, http: rss(true) },
      { widget: 'latest', state: 'empty', label: 'Nothing new', http: () => '<rss><channel><title>Quiet</title></channel></rss>' },
    ],
  },
  hackernews: {
    config: { sort: 'top', limit: 7 }, http: route([['algolia', { hits: STORIES.map(hit) }]]),
    states: [{ widget: 'stories', state: 'empty', label: 'Nothing on the front page', http: route([['algolia', { hits: [] }]]) }],
  },
  lobsters: {
    config: { limit: 6 }, http: route([['lobste.rs', LOBSTERS]]),
    states: [{ widget: 'stories', state: 'empty', label: 'Nothing today', http: route([['lobste.rs', []]]) }],
  },
  reddit: {
    config: { subreddits: ['selfhosted', 'homelab'], sort: 'hot', limit: 6 }, http: reddit(POSTS),
    states: [
      { widget: 'posts', state: 'shelf', label: 'As image tiles', config: { style: 'shelf' } },
      { widget: 'posts', state: 'empty', label: 'No posts', http: reddit([[], []]) },
    ],
  },
  releases: {
    config: { repos: REPOS, limit: 6 }, http: github,
    states: [
      { widget: 'latest', state: 'prereleases', label: 'With prereleases', config: { prereleases: true } },
      { widget: 'latest', state: 'empty', label: 'No releases yet', http: over([[/\/releases\/latest$/, new Response('', { status: 404 })], [/\/tags/, []]], github) },
    ],
  },
  repository: { config: { repos: REPOS.slice(0, 5), title: 'Repositories' }, http: github },
  markets: { config: { symbols: [{ symbol: 'INDEX', name: 'Example 500' }, { symbol: 'ACME' }, { symbol: 'NRTH' }, { symbol: 'BTC-USD' }, { symbol: 'EURUSD', name: 'EUR/USD' }], range: '1d', title: 'Markets' }, http: markets },
  twitch: {
    config: { clientId: 'sample', clientSecret: 'x', channels: ['northernsignal', 'quietkeep', 'harbourfm'], limit: 6 }, http: twitch(LIVE),
    states: [{ widget: 'channels', state: 'empty', label: 'Nobody is live', http: twitch([]) }],
  },
};
