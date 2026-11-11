// Images attached in chat, shown to a model that can see (`assistant.vision`). The page sends an attachment as a line in
// the message, "[attached: name (file id X)]", which tools like Paperless's file it by; for a model that can see, the
// newest few images are also added to their messages as pictures, read from the uploads, so it can answer what they show.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { UIMessage } from 'ai';
import type { Config } from './config.ts';
import { UPLOAD_DIR } from './core.ts';

/** An attachment line, with or without the type the system prompt describes: its name and file id. */
export const ATTACHED = /\[attached: ([^\]\n]*?) \((?:[^()\n]*?, )?file id ([a-f0-9]{24})\)\]/g;
/** How many images one request shows, newest first: each costs the model about as much as a page of text. */
export const MAX_IMAGES = 4;
/** Anthropic takes 5 MB an image, and most servers less than OpenAI's 20; a phone photo is under this. */
export const MAX_BYTES = 5 * 2 ** 20;

/** Whether this model is shown images: as configured, else Anthropic's yes and everyone else's no. */
export const canSee = (a: NonNullable<Config['assistant']>) => a.vision ?? a.provider === 'anthropic';

const text = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
/** What an image really is, from its first bytes. The upload's type is only what the browser said. */
export function imageType(b: Uint8Array): string | undefined {
  if (b.length >= 8 && b[0] === 0x89 && text(b, 1, 4) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && text(b, 0, 4) === 'RIFF' && text(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 6 && /^GIF8[79]a$/.test(text(b, 0, 6))) return 'image/gif';
  return undefined;
}

export interface Upload { name: string; type: string; size: number; data: () => Promise<Buffer> }
/** An upload's details, and its bytes only when asked: a 50 MB PDF isn't read to learn it isn't a picture. */
export async function upload(id: string): Promise<Upload | undefined> {
  const meta = await readFile(resolve(UPLOAD_DIR, `${id}.json`), 'utf8').then(JSON.parse).catch(() => undefined);
  return meta && { name: String(meta.name), type: String(meta.type), size: Number(meta.size) || 0, data: () => readFile(resolve(UPLOAD_DIR, `${id}.bin`)) };
}

/** The chat as the model gets it: each of the newest images attached (up to MAX_IMAGES) is added to its own message, after
 *  the words. One that can't be shown (gone after a day, too big, not really an image) gets a line saying so instead, so
 *  the model doesn't pretend to see it. Files that aren't images are left to the tools, as before. */
export async function withImages(messages: UIMessage[], read: (id: string) => Promise<Upload | undefined> = upload): Promise<UIMessage[]> {
  const added = new Map<number, UIMessage['parts']>(), seen = new Set<string>();
  let shown = 0;
  for (let i = messages.length - 1; i >= 0 && shown < MAX_IMAGES; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    const ids = m.parts.flatMap(p => p.type === 'text' ? [...p.text.matchAll(ATTACHED)].map(x => x[2]!) : []);
    const parts: UIMessage['parts'] = [];
    for (const id of ids) {
      if (seen.has(id) || shown >= MAX_IMAGES) continue;
      seen.add(id);
      const f = await read(id).catch(() => undefined);
      if (!f) continue;   // gone, or never was: the tools say so if it's asked for
      if (!f.type.startsWith('image/')) continue;
      const note = (why: string) => parts.push({ type: 'text', text: `(${f.name} isn't shown to you: ${why}.)` });
      if (f.size > MAX_BYTES) { note('it is over 5 MB'); continue; }
      const data = await f.data().catch(() => undefined);
      const type = data && imageType(data);
      if (!data) { note('it has expired'); continue; }
      if (!type) { note('it is not a PNG, JPEG, WebP or GIF'); continue; }
      parts.push({ type: 'file', mediaType: type, filename: f.name, url: `data:${type};base64,${data.toString('base64')}` });
      shown++;
    }
    if (parts.length) added.set(i, parts);
  }
  return added.size ? messages.map((m, i) => added.has(i) ? { ...m, parts: [...m.parts, ...added.get(i)!] } : m) : messages;
}
