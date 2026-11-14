// A background script of your own (appearance.background): data/backgrounds/<name>.js, served by Valet, mounted into a
// full-screen box behind the cards and over the wallpaper. Its default export is called with that box and what it may
// want to follow: mount(el, { theme, tab }) → { update?({ theme, tab }), destroy?() }. The theme's colours are the
// page's CSS variables (--primary, --foreground…), read with getComputedStyle. It never runs with motion reduced or none,
// or when the device asks for less motion: then the wallpaper, or the page's own colour, is all there is.
import { useEffect, useRef, useState } from 'react';

export interface SceneContext { theme: 'light' | 'dark'; tab: string }
type Mounted = { update?(ctx: SceneContext): void; destroy?(): void } | void;
export type Scenes = { all?: { light: string; dark: string }; tabs: Record<string, { light: string; dark: string }> };

/** The script for this tab and theme, if any: a tab's own first, `none` being none. */
export function sceneFor(scenes: Scenes | undefined, tab: string, dark: boolean): string | undefined {
  const s = scenes?.tabs[tab] ?? scenes?.all, name = s && (dark ? s.dark : s.light);
  return name && name !== 'none' ? name : undefined;
}

const stillNow = () => matchMedia('(prefers-reduced-motion: reduce)').matches || /\bmotion-(reduced|none)\b/.test(document.documentElement.className);
/** Whether things should stay still: the device's setting, or appearance.motion. Follows either changing. */
export function useStill() {
  const [still, setStill] = useState(stillNow);
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)'), check = () => setStill(stillNow());
    const seen = new MutationObserver(check);
    q.addEventListener('change', check); seen.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => { q.removeEventListener('change', check); seen.disconnect(); };
  }, []);
  return still;
}

export function Scene({ name, theme, tab }: { name: string } & SceneContext) {
  const box = useRef<HTMLDivElement>(null), live = useRef<Mounted>(undefined), now = useRef<SceneContext>({ theme, tab });
  now.current = { theme, tab };
  useEffect(() => {
    const el = box.current!;
    let gone = false;
    import(/* @vite-ignore */ `/backgrounds/${encodeURIComponent(name)}.js`).then((m: { default?: (el: HTMLElement, ctx: SceneContext) => Mounted }) => {
      if (gone) return;
      if (typeof m.default !== 'function') throw new Error('its default export should be a function: mount(el, { theme, tab })');
      const host = document.createElement('div');
      host.className = 'scene-host';
      el.appendChild(host);
      live.current = m.default(host, { ...now.current });
    }).catch(e => console.warn(`background ${name}: ${(e as Error).message}`));
    return () => {
      gone = true;
      try { live.current?.destroy?.(); } catch (e) { console.warn(`background ${name}: ${(e as Error).message}`); }
      live.current = undefined;
      el.replaceChildren();
    };
  }, [name]);
  useEffect(() => { try { live.current?.update?.({ theme, tab }); } catch (e) { console.warn(`background ${name}: ${(e as Error).message}`); } }, [theme, tab]);
  return <div ref={box} className="scene" aria-hidden />;
}
