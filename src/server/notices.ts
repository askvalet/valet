// Island notices: short messages when something changes, worked out by comparing a widget's previous card with the
// new one. Which changes are worth a notice is up to the config (island.notify); nothing is announced by default.
import type { Card } from '../shared/cards.ts';

export interface NoticeRule { widget: string; on: 'start' | 'end' | 'down' | 'up'; text?: string }
export interface Notice { key: string; text: string; sub?: string; icon?: string; image?: string; tone: 'good' | 'warn' | 'bad' | 'accent'; at: number }

const fill = (t: string, v: Record<string, string | undefined>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

export function noticesFor(key: string, prev: Card | undefined, next: Card | undefined, rules: NoticeRule[], at = Date.now()): Notice[] {
  if (!prev || !next) return [];   // the first load of a widget isn't news
  const out: Notice[] = [];
  for (const r of rules.filter(r => r.widget === key)) {
    if (r.on === 'start' && !prev.activity && next.activity)
      out.push({ key, at, tone: 'accent', icon: next.activity.icon, image: next.activity.image, text: fill(r.text ?? '{title}', { title: next.activity.title }), sub: next.activity.subtitle });
    if (r.on === 'end' && prev.activity && !next.activity)
      out.push({ key, at, tone: 'good', icon: prev.activity.icon, image: prev.activity.image, text: fill(r.text ?? '{title} · done', { title: prev.activity.title }) });
    if ((r.on === 'down' || r.on === 'up') && prev.type === 'status' && next.type === 'status') {
      const was = new Map(prev.items.map(i => [i.name, i.ok]));
      for (const i of next.items) {
        if (i.quiet || !was.has(i.name) || was.get(i.name) === i.ok) continue;
        if (r.on === 'down' && !i.ok) out.push({ key, at, tone: 'bad', icon: 'pulse', text: fill(r.text ?? '{name} is down', { name: i.name }), sub: i.detail });
        if (r.on === 'up' && i.ok) out.push({ key, at, tone: 'good', icon: 'pulse', text: fill(r.text ?? '{name} is back', { name: i.name }) });
      }
    }
  }
  return out;
}
