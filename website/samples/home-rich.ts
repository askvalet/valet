// The kitchen and the reading chair: Mealie, Tandoor, Komga, Kavita and Miniflux. Recipes, feeds and people are
// invented; the books are real ones, with their covers from demo/art.
import { DAY, HOUR, ago, over, route, webPage, ymd } from './helpers.ts';
import type { Fixture } from './types.ts';

// ── Recipes, shared by both cookbooks
const DISHES = [
  ['Green curry with squash', 'Coconut, lime leaves and a whole butternut. Better the next day.', '45 min', 'Dinner'],
  ['Lentil and tomato soup', 'Red lentils cooked down with smoked paprika, finished with lemon.', '35 min', 'Dinner'],
  ['Overnight oats', 'Oats, yoghurt and grated apple, left in the fridge.', '5 min', 'Breakfast'],
  ['Mushroom risotto', 'Chestnut mushrooms, a splash of white wine and plenty of parmesan.', '40 min', 'Dinner'],
  ['Flatbreads', 'Yoghurt dough in a dry pan, no oven needed.', '25 min', 'Sides'],
  ['Plum cake', 'A loose sponge with halved plums pressed in on top.', '1 h 10 min', 'Baking'],
  ['Chickpea salad', 'Chickpeas, cucumber, herbs and a sharp lemon dressing.', '15 min', 'Lunch'],
  ['Roast chicken thighs', 'With potatoes and whole garlic, all in one tray.', '55 min', 'Dinner'],
] as const;
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '-');

// ── Mealie
const mealieRecipe = (i: number) => { const [name, description, totalTime, cat] = DISHES[i]; return { id: uuid(i), slug: slug(name), name, description, image: 'v1', totalTime, recipeYield: '4 servings', rating: 4, recipeCategory: [{ name: cat }], tags: [], dateAdded: ymd(-i * 3 * DAY) }; };
const plan = [[0, 'breakfast', 2], [0, 'dinner', 0], [1, 'dinner', 1], [2, 'lunch', 6], [2, 'dinner', 3], [4, 'dinner', 7], [5, 'side', 4]] as const;
const mealieHttp = route([
  ['/statistics', { totalRecipes: 428, totalCategories: 12, totalTags: 34, totalUsers: 2, totalTools: 6 }],
  ['/users/self', { groupSlug: 'home' }],
  ['/mealplans', { page: 1, per_page: 100, total: plan.length, total_pages: 1, items: plan.map(([d, entryType, r], id) => ({ id, date: ymd(d * DAY), entryType, title: '', text: '', recipeId: uuid(r), recipe: mealieRecipe(r) })) }],
  ['/shopping/lists', { items: [{ id: uuid(40), name: 'Groceries' }] }],
  [/\/recipes\/[a-z-]+$/, () => ({ ...mealieRecipe(0), recipeIngredient: [{ display: '1 butternut squash' }, { display: '400 ml coconut milk' }, { display: '2 tbsp green curry paste' }], recipeInstructions: [{ text: 'Roast the squash.' }, { text: 'Simmer it all together.' }] })],
  ['/recipes', { page: 1, per_page: 12, total: DISHES.length, items: DISHES.map((_, i) => mealieRecipe(i)) }],
]);

// ── Tandoor
const tandoorRecipe = (i: number) => { const [name, description, time, cat] = DISHES[i]; const m = /(\d+) h/.test(time) ? 70 : Number.parseInt(time); return { id: i + 1, name, description, image: `http://tandoor:8080/media/recipes/${i + 1}.jpg`, keywords: [{ id: 1, label: cat }], working_time: Math.round(m / 3), waiting_time: m - Math.round(m / 3), rating: 4, created_at: ago(i * 3 * DAY), last_cooked: null }; };
const tandoorHttp = route([
  ['/api/space/', [{ id: 1, name: 'Home', recipe_count: 428, user_count: 2 }]],
  ['/api/keyword/', { count: 61, results: [] }],
  ['/api/meal-plan/', plan.map(([d, meal, r], id) => ({ id, title: '', recipe: tandoorRecipe(r), servings: 2, note: '', from_date: `${ymd(d * DAY)}T00:00:00Z`, to_date: `${ymd(d * DAY)}T00:00:00Z`, meal_type: { name: meal[0].toUpperCase() + meal.slice(1), order: ['breakfast', 'lunch', 'dinner', 'side'].indexOf(meal) } }))],
  [/\/api\/recipe\/\?page_size=1$/, { count: DISHES.length, results: [] }],
  ['/api/recipe/', { count: DISHES.length, next: null, previous: null, results: DISHES.map((_, i) => tandoorRecipe(i)) }],
]);

// ── Books, for Komga and Kavita: real titles with their covers
const BOOKS = [['Project Hail Mary', 'Andy Weir', '1207dd42be19'], ['Dune', 'Frank Herbert', '63144adb2c84'], ['The Hobbit', 'J.R.R. Tolkien', 'b481211dcf6d'], ['Neuromancer', 'William Gibson', '49ce50cf3e4a'],
  ['Foundation', 'Isaac Asimov', 'a3640af5a085'], ['Circe', 'Madeline Miller', '2db3fbec5ac1'], ['Klara and the Sun', 'Kazuo Ishiguro', '14621fed2b88'], ['The Martian', 'Andy Weir', '7ef4659a41ba'], ['Educated', 'Tara Westover', '4f11d4fd373b']] as const;
const cover = (i: number) => `/art/covers/${BOOKS[i % BOOKS.length][2]}.jpg`;
const kid = (kind: 'B' | 'S', i: number) => `0${kind}${String(i).padStart(11, '0')}`;
const komgaBook = (i: number, page: number | null) => ({ id: kid('B', i), seriesId: kid('S', i), seriesTitle: BOOKS[i][0], name: BOOKS[i][0], number: 1, created: ago(i * DAY), lastModified: ago(i * DAY),
  metadata: { title: BOOKS[i][0], number: '1', authors: [{ name: BOOKS[i][1], role: 'writer' }] }, media: { pagesCount: 320, mediaProfile: 'EPUB' },
  readProgress: page == null ? null : { page, completed: false, readDate: ago(i * 18 * HOUR) } });
const komgaSeries = (i: number) => ({ id: kid('S', i), name: BOOKS[i][0], booksCount: 3, booksReadCount: i % 3, booksUnreadCount: 3 - (i % 3), booksInProgressCount: 0, created: ago(i * DAY), metadata: { title: BOOKS[i][0], status: 'ENDED' }, booksMetadata: { authors: [{ name: BOOKS[i][1], role: 'writer' }] } });
const page = (content: unknown[], totalElements = content.length) => ({ content, totalElements, totalPages: 1, number: 0, size: 20 });
const komgaHttp = route([
  ['/api/v1/libraries', [{ id: '0L00000000001', name: 'Books', unavailable: false }, { id: '0L00000000002', name: 'Comics', unavailable: false }]],
  ['/books/ondeck', page([komgaBook(4, null), komgaBook(5, null)])],
  ['/series/new', page([6, 7, 8, 2, 3].map(komgaSeries))],
  [/\/(books|series)\/list\?size=1$/, (url: string) => page([], url.includes('books') ? 2316 : 214)],
  ['/books/list', page([komgaBook(0, 214), komgaBook(1, 96), komgaBook(3, 31)])],
  ['/series/list', page([0, 1, 3].map(komgaSeries))],
]);
const komgaImage = (ref: string) => { const n = Number(ref.slice(-11)); return Number.isFinite(n) ? cover(n) : `/img/${ref}`; };

// ── Kavita
const kavitaSeries = (i: number, pagesRead: number) => ({ id: i + 1, name: BOOKS[i][0], localizedName: '', libraryId: 1, libraryName: 'Books', pages: 300, pagesRead, latestReadDate: ago(i * 20 * HOUR), created: ago(i * 2 * DAY), format: 3 });
const kavitaHttp = route([
  ['/api/Account/login', { id: 1, username: 'reader', token: 't', apiKey: 'k' }],
  ['/api/Stats/server/stats', { seriesCount: 214, totalFiles: 5620, chapterCount: 5800, volumeCount: 900 }],
  ['/api/Series/on-deck', [kavitaSeries(0, 220), kavitaSeries(2, 64), kavitaSeries(6, 150)]],
  ['/api/Series/recently-added-v2', [5, 4, 8, 7, 1].map(i => kavitaSeries(i, 0))],
  ['/api/Search/search', { series: [{ seriesId: 2, name: 'Dune', libraryId: 1, libraryName: 'Books' }] }],
]);

// ── Miniflux
const FEEDS = [[1, 'The Example Times', 'News', 14], [2, 'Small Server Notes', 'Homelab', 6], [3, 'Kitchen Table', 'Food', 3], [4, 'Hardware Weekly', 'Hardware', 2], [5, 'A Quiet Blog', 'Blogs', 0]] as const;
const STORIES = [
  [1, 'This week in open-source home automation', 'Three projects shipped big releases, and one of them finally talks to old thermostats.', 1],
  [2, 'Ten years of one home server', 'What lasted, what broke, and why the boring parts were the best decisions.', 3],
  [3, 'A soup for every week of winter', 'Twelve pots that keep, freeze and reheat without complaint.', 5],
  [4, 'Quiet fans, ranked', 'Seventeen fans on one bench, measured at the same speed. The quietest isn\'t the dearest.', 8],
  [2, 'Backups you never test are wishes', 'A small monthly ritual that turns a backup into a restore you know works.', 20],
  [1, 'The small web is still here', 'Personal sites never left. A tour of the ones worth following.', 30],
] as const;
const feed = (id: number) => { const f = FEEDS.find(x => x[0] === id)!; return { id, title: f[1], site_url: `https://feed${id}.example.com`, feed_url: `https://feed${id}.example.com/rss`, category: { id, title: f[2] }, icon: { feed_id: id, icon_id: id }, parsing_error_count: 0 }; };
const entry = (i: number, starred = false) => { const [f, title, blurb, h] = STORIES[i]; return { id: 100 + i, feed_id: f, status: 'unread', title, url: `https://feed${f}.example.com/${i}`, published_at: ago(h * HOUR), changed_at: ago(h * HOUR),
  content: `<p>${blurb}</p><img src="http://miniflux:8080/proxy/${i}/picture.jpg">`, author: '', starred, reading_time: 4 + i, enclosures: [], tags: [], feed: feed(f) }; };
const minifluxHttp = route([
  ['/v1/feeds/counters', { reads: { 1: 6200, 2: 1400, 3: 900, 4: 1100, 5: 271 }, unreads: Object.fromEntries(FEEDS.map(f => [f[0], f[3]])) }],
  [/\/v1\/feeds$/, FEEDS.map(f => feed(f[0]))],
  ['starred=true', { total: 2, entries: [entry(4, true), entry(5, true)] }],
  [/\/v1\/entries\/\d+$/, (url: string) => entry(Math.max(0, Number(url.split('/').pop()) - 100) % STORIES.length)],
  ['/v1/entries', { total: 25, entries: STORIES.slice(0, 4).map((_, i) => entry(i)) }],
]);

export const homeRich: Record<string, Fixture> = {
  mealie: {
    config: { url: 'http://mealie:9000', key: 'x', href: 'https://food.example.com' },
    http: mealieHttp,
    states: [
      { widget: 'week', state: 'empty', label: 'Nothing planned', http: over([['/mealplans', { items: [] }]], mealieHttp) },
      { widget: 'today', state: 'empty', label: 'No recipes yet', http: over([['/recipes', { items: [] }]], mealieHttp) },
    ],
  },
  tandoor: {
    config: { url: 'http://tandoor:8080', key: 'x', href: 'https://recipes.example.com' },
    http: tandoorHttp,
    states: [{ widget: 'week', state: 'empty', label: 'Nothing planned', http: over([['/api/meal-plan/', []]], tandoorHttp) }],
  },
  komga: {
    config: { url: 'http://komga:25600', username: 'reader', password: 'x', href: 'https://comics.example.com' },
    http: komgaHttp, image: komgaImage,
    states: [{ widget: 'reading', state: 'empty', label: 'Nothing in progress', http: over([['/books/list?size=12', page([])]], komgaHttp) }],
  },
  kavita: {
    config: { url: 'http://kavita:5000', username: 'reader', password: 'x', href: 'https://books.example.com' },
    http: kavitaHttp, image: ref => cover(Number(ref) - 1),
    states: [{ widget: 'reading', state: 'empty', label: 'Nothing in progress', http: over([['/api/Series/on-deck', []]], kavitaHttp) }],
  },
  miniflux: {
    config: { url: 'http://miniflux:8080', key: 'x', href: 'https://rss.example.com' },
    http: minifluxHttp, image: ref => ref.startsWith('icon-') ? `/img/${ref}` : webPage(ref),
    states: [
      { widget: 'unread', state: 'empty', label: 'All caught up', http: over([['status=unread', { total: 0, entries: [] }]], minifluxHttp) },
      { widget: 'starred', state: 'empty', label: 'Nothing starred', http: over([['starred=true', { total: 0, entries: [] }]], minifluxHttp) },
    ],
  },
};
