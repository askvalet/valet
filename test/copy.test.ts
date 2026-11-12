// Copying from the chat: the clipboard API where the page is secure and it works, the old copy command where it isn't
// (a plain http LAN address has no navigator.clipboard), and an honest answer when neither copies.
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

test('a secure page uses the clipboard', async () => {
  const log = page({ secure: true, api: 'ok', command: true });
  assert.equal(await copyText('hello'), true);
  assert.deepEqual(log, ['api:hello']);
});

test('a plain http page, with no clipboard, copies with the copy command and cleans up', async () => {
  const log = page({ secure: false, command: true });
  assert.equal(await copyText('hello'), true);
  assert.deepEqual(log, ['box', 'command:copy', 'gone']);
});

test('a clipboard that refuses falls back to the copy command', async () => {
  const log = page({ secure: true, api: 'refuses', command: true });
  assert.equal(await copyText('hello'), true);
  assert.deepEqual(log, ['box', 'command:copy', 'gone']);
});

test('when nothing copies, it says so, so the button never claims it did', async () => {
  page({ secure: false, command: false });
  assert.equal(await copyText('hello'), false);
});
