// Telling the owner something when they aren't looking: phone push through the services homelabs already run. Apprise
// reaches dozens more; `webhook` reaches anything else.
import { z } from 'zod';

export const Channel = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ntfy'), url: z.string().url(), token: z.string().optional() }).strict(),                 // the full topic URL
  z.object({ type: z.literal('gotify'), url: z.string().url(), token: z.string() }).strict(),
  z.object({ type: z.literal('telegram'), token: z.string(), chat: z.union([z.string(), z.number()]) }).strict(),
  z.object({ type: z.literal('discord'), url: z.string().url() }).strict(),
  z.object({ type: z.literal('slack'), url: z.string().url() }).strict(),
  z.object({ type: z.literal('pushover'), token: z.string(), user: z.string() }).strict(),
  z.object({ type: z.literal('apprise'), url: z.string().url() }).strict(),                                            // e.g. http://apprise:8000/notify/mykey
  z.object({ type: z.literal('webhook'), url: z.string().url(), headers: z.record(z.string(), z.string()).optional() }).strict(),
]);
export type Channel = z.infer<typeof Channel>;
export interface Message { title: string; text?: string; urgent?: boolean }

const json = (url: string, body: unknown, headers: Record<string, string> = {}) => ({ url, init: { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } });

/** The request each service expects. */
export function request(c: Channel, m: Message): { url: string; init: RequestInit } {
  const line = m.text ? `${m.title}\n${m.text}` : m.title;
  switch (c.type) {
    case 'ntfy': return { url: c.url, init: { method: 'POST', body: m.text ?? m.title, headers: { Title: encodeURIComponent(m.title), Priority: m.urgent ? '4' : '3', ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) } } };
    case 'gotify': return json(`${c.url.replace(/\/$/, '')}/message`, { title: m.title, message: m.text ?? m.title, priority: m.urgent ? 8 : 5 }, { 'X-Gotify-Key': c.token });
    case 'telegram': return json(`https://api.telegram.org/bot${c.token}/sendMessage`, { chat_id: c.chat, text: line });
    case 'discord': return json(c.url, { content: line });
    case 'slack': return json(c.url, { text: line });
    case 'pushover': return json('https://api.pushover.net/1/messages.json', { token: c.token, user: c.user, title: m.title, message: m.text ?? m.title, priority: m.urgent ? 1 : 0 });
    case 'apprise': return json(c.url, { title: m.title, body: m.text ?? m.title, type: m.urgent ? 'warning' : 'info' });
    case 'webhook': return json(c.url, m, c.headers);
  }
}

/** To every channel. One failing doesn't stop the others, and a failure is only logged: nothing here can break the page. */
export async function push(channels: Channel[], m: Message, send: typeof fetch = fetch, redact: (s: string) => string = s => s) {
  await Promise.all(channels.map(async c => {
    const { url, init } = request(c, m);
    try {
      const r = await send(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) console.error(`notify: ${c.type} answered ${r.status}`);
    } catch (e) { console.error(`notify: ${c.type}: ${redact((e as Error).message)}`); }
  }));
}
