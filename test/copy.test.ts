// Copying from the chat: the copy command first (plain text, the same as ⌘C on a selection: it works on a plain http LAN
// address, and Safari doesn't store it as a link), the clipboard API when that didn't copy, and an honest answer when
// neither did.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyText } from '../src/web/copy.ts';

function page(o: { secure: boolean; api?: 'ok' | 'refuses'; command: boolean }) {
  const log: string[] = [], body = { appendChild: (el: any) => { el.isConnected = true; log.push('box'); } };
  const box = () => ({ value: '', style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() { log.push('gone'); } });
  // Node has a navigator of its own, with only a getter: each of these is defined over it
  const set = (k: string, v: unknown) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('window', { isSecureContext: o.secure });
  set('navigator', o.api ? { clipboard: { writeText: async (t: string) => { if (o.api === 'refuses') throw new Error('Document is not focused'); log.push(`api:${t}`); } } } : {});
  set('document', { body, activeElement: null, createElement: box, execCommand: (c: string) => { log.push(`command:${c}`); return o.command; } });
  return log;
}

test('the copy command goes first, on any page, and cleans up after itself', async () => {
  for (const secure of [true, false]) {
    const log = page({ secure, api: 'ok', command: true });
    assert.equal(await copyText('Roughly: 11 torrents'), true);
    assert.deepEqual(log, ['box', 'command:copy', 'gone'], 'never the clipboard API, which Safari would also store as a link');
  }
});

test('when the command doesn\'t copy, a secure page uses the clipboard', async () => {
  const log = page({ secure: true, api: 'ok', command: false });
  assert.equal(await copyText('hello'), true);
  assert.deepEqual(log, ['box', 'command:copy', 'gone', 'api:hello']);
});

test('a plain http page has no clipboard to fall back on: the command or nothing', async () => {
  const log = page({ secure: false, api: 'ok', command: false });
  assert.equal(await copyText('hello'), false);
  assert.ok(!log.includes('api:hello'));
});

test('when nothing copies, it says so, so the button never claims it did', async () => {
  page({ secure: true, api: 'refuses', command: false });
  assert.equal(await copyText('hello'), false);
});
