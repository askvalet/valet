// Installing Valet as an app, and its own notifications on this device. The worker (sw.js) is registered once the page
// loads; notifications only start when someone turns them on in ⌘K, and the browser asks for permission only then.
import { useSyncExternalStore } from 'react';

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
/** An iPhone or iPad: push only reaches apps added to the Home Screen there. */
export const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerWorker() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  addEventListener('load', () => {
    // updateViaCache none: the browser checks sw.js itself on every visit, never an HTTP-cached copy
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(r => { addEventListener('visibilitychange', () => { if (!document.hidden) void r.update().catch(() => {}); }); }, () => {});
  });
  // a notification clicked while Valet was open in a tab the worker doesn't control yet
  navigator.serviceWorker.addEventListener('message', e => { const url = e.data?.type === 'valet-go' && typeof e.data.url === 'string' ? e.data.url : null; if (url?.startsWith('/') && !url.startsWith('//')) location.assign(url); });
}

export type PushState = 'on' | 'off' | 'unknown';
let state: PushState = 'unknown';
const subs = new Set<() => void>(), set = (s: PushState) => { state = s; subs.forEach(f => f()); };
export const usePush = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);

const current = async () => supported() && isSecureContext ? (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription() ?? null : null;
const post = (method: 'POST' | 'DELETE', body: unknown) => fetch('/api/push', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Is this browser on? Checked with the server too, so a subscription it dropped (or another account's) reads as off. */
export async function checkPush() {
  const sub = await current().catch(() => null);
  if (!sub) return set('off');
  const r = await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`).then(r => r.json()).catch(() => null);
  set(r?.on ? 'on' : 'off');
}

/** Why this browser can't, in words for the person, or null if it can. Checked before anything is asked. */
export function cannot(page: { sandbox?: boolean; canAct: boolean; member?: boolean }): string | null {
  if (page.sandbox) return 'The demo can\'t send notifications. On your own Valet, this turns them on for this device.';
  if (page.member) return 'Notifications are for the owners of this Valet.';
  if (!page.canAct) return 'Valet is read-only here, so notifications are off. Turn on sign-in (or auth.trustNetwork on a private network) first.';
  if (ios() && !standalone()) return 'On iPhone and iPad, notifications only work once Valet is on your Home Screen: tap Share, then Add to Home Screen, and turn them on from there.';
  if (!isSecureContext) return 'Notifications need Valet on HTTPS. This page came over plain HTTP, so the browser won\'t allow them.';
  if (!supported()) return 'This browser can\'t receive notifications from a web page.';
  if (Notification.permission === 'denied') return 'Notifications are blocked for this site. Allow them in the browser\'s site settings, then try again.';
  return null;
}

const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));

/** On: permission (asked now, after the click), a subscription, and the server told. Returns what to say. */
export async function enablePush(): Promise<{ ok: boolean; text: string }> {
  const info = await fetch('/api/push').then(r => r.json()).catch(() => null);
  if (!info?.ready) return { ok: false, text: info?.why === 'off' ? 'Notifications are off in the config (notify.webPush.enabled).' : 'Valet can\'t turn notifications on right now.' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, text: permission === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser\'s site settings.' : 'Notifications stay off.' };
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // made with another key (a reset data folder, say): it would never deliver, so start again
  if (sub && sub.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== info.key) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.key) });
  const r = await post('POST', { subscription: sub.toJSON() });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return { ok: false, text: e.error ?? 'Valet couldn\'t keep this device\'s subscription.' }; }
  set('on');
  return { ok: true, text: 'Notifications on. A first one is on its way to check.' };
}

/** Off here, on the server and in the browser. Signing out does this too: a device nobody's signed in on hears nothing. */
export async function disablePush() {
  const sub = await current().catch(() => null);
  if (sub) { await post('DELETE', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  set('off');
}
