// Twitch: which of your channels are live, and what's popular. Uses Twitch's own API, so it needs a free app from
// dev.twitch.tv (clientId and clientSecret); that's the only supported way in.
import { z } from 'zod';
import { defineIntegration } from '../server/core.ts';
import type { ListItem } from '../shared/cards.ts';

const viewers = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default defineIntegration({
  type: 'twitch',
  name: 'Twitch',
  config: z.object({ clientId: z.string(), clientSecret: z.string(), channels: z.array(z.string()).max(100).default([]), limit: z.number().int().min(1).max(20).default(8) }),
  create(cfg, ctx) {
    const token = ctx.session(async () => (await ctx.http<any>('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' }) })).access_token as string);
    const api = async (path: string, again = true): Promise<any> => {
      const res = await ctx.http<Response>(`https://api.twitch.tv/helix/${path}`, { as: 'response', headers: { 'Client-Id': cfg.clientId, Authorization: `Bearer ${await token.get()}` } });
      if (res.status === 401 && again) { token.reset(); return api(path, false); }
      if (!res.ok) throw new Error(`Twitch answered ${res.status}`);
      return res.json();
    };
    const row = (s: any): ListItem => ({ title: s.user_name, subtitle: `${s.game_name}${s.title ? ` · ${s.title}` : ''}`, meta: viewers(s.viewer_count), href: `https://twitch.tv/${s.user_login}`, dot: 'good' });
    const live = async () => cfg.channels.length ? (await api(`streams?first=100&${cfg.channels.map(c => `user_login=${encodeURIComponent(c)}`).join('&')}`)).data as any[] : [];
    const games = async () => (await api(`games/top?first=${cfg.limit}`)).data as any[];
    return {
      widgets: {
        channels: { title: 'Twitch', interval: 120_000, async fetch() { const l = await live(); return { type: 'list', title: 'Live on Twitch', icon: 'play', items: l.map(row), empty: 'Nobody is live', summary: { label: 'Twitch', icon: 'play', value: `${l.length} live`, sub: l[0]?.user_name } }; } },
        games: { title: 'Top games', interval: 900_000, async fetch() { const l = await games(); return { type: 'list', title: 'Top on Twitch', icon: 'game', items: l.map((g, i) => ({ title: g.name, meta: `#${i + 1}`, href: `https://twitch.tv/directory/category/${encodeURIComponent(g.name)}` })), summary: { label: 'Twitch', icon: 'game', value: l[0]?.name ?? '–', sub: 'most watched' } }; } },
      },
      tools: { twitch_live: { label: 'Checked Twitch', access: 'read', input: z.object({}), description: `Which of ${cfg.channels.join(', ') || 'your channels'} are live, playing what, with how many viewers.`, async run() { const l = await live(); return { data: l.map(s => ({ channel: s.user_name, game: s.game_name, title: s.title, viewers: s.viewer_count })) }; } } },
    };
  },
});
