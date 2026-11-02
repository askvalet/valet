// Takes a card as data and draws it through Valet's real Widget and SummaryTile, in the same grid the page uses, so a
// screenshot here is what that size looks like on a page. Driven by scripts/shots.ts through window.show().
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MiniRing, NowPlaying, Ring, SummaryTile, Widget } from '@/cards.tsx';
import { Card } from '@/components/ui/card';
import { LiveRings } from '@/live.tsx';
import RecapStory from '@/recap.tsx';
import '@/styles.css';
import './harness.css';

type Size = 'small' | 'wide' | 'medium' | 'tall' | 'large';
export interface Spec {
  mode: 'size' | 'chat' | 'ring' | 'rings' | 'tiles' | 'media' | 'failed' | 'island' | 'recap' | 'group';
  key: string; card?: any; cards?: any[]; size?: Size; theme?: 'dark' | 'light'; error?: string; title?: string; minimal?: boolean; headless?: boolean;
  live?: any[]; notice?: any; recap?: any; start?: number; wall?: boolean; open?: boolean;
}

const run = async () => {};
function bento(size: Size, inner: ReactNode) {
  // the page's own bento classes, from renderSection in app.tsx
  const span = size === 'small' ? '' : size === 'wide' || size === 'medium' ? 'col-span-2' : size === 'tall' ? 'col-span-2 row-span-2' : 'col-span-full @5xl/main:col-span-4';
  return <div className="bento grid grid-flow-row-dense grid-cols-2 gap-(--card-gap) @2xl/main:grid-cols-4 @5xl/main:grid-cols-6"><div data-shot className={`min-w-0 ${span}`}>{inner}</div></div>;
}
function Sized({ s }: { s: Spec }) {
  const size = s.size ?? 'medium', c = s.card, large = size === 'large';
  // a calendar needs the room for its month, so wide means large for it
  const asked = c?.type === 'calendar' && size === 'wide' ? 'large' : size;
  if ((asked === 'small' || asked === 'wide') && c?.summary) return bento(asked, <SummaryTile s={c.summary} href={c.href} />);
  // tall spans two rows: the card fills them, the way it does when its neighbours set the height
  const widget = <Widget card={c} large={large || asked === 'large'} fill run={run} minimal={s.minimal} headless={s.headless} />;
  return <div style={asked === 'tall' ? { '--row-h': '236px' } as any : undefined}>{bento(asked === 'small' ? 'wide' : asked, widget)}</div>;
}
function Shot({ s }: { s: Spec }) {
  if (s.mode === 'size') return <Sized s={s} />;
  if (s.mode === 'failed') return bento('medium', <Widget title={s.title} failed={s.error} status={<span className="truncate text-xs text-warn" title={s.error}>{s.error}</span>} />);
  if (s.mode === 'chat') return <div data-shot className="w-[520px]"><Widget card={s.card} compact run={run} /></div>;
  if (s.mode === 'ring') return <div data-shot className="inline-flex items-center gap-4">{(s.card.summaries ?? [s.card.summary]).slice(0, 4).map((t: any, i: number) => <MiniRing key={i} s={t} />)}</div>;
  if (s.mode === 'rings') return <div data-shot><Card className="py-5 shadow-card"><div className="grid gap-y-5 px-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>{(s.cards ?? []).flatMap((c, i) => (c.summaries ?? (c.summary ? [c.summary] : [])).map((t: any, j: number) => <Ring key={`${i}${j}`} s={t} />))}</div></Card></div>;
  if (s.mode === 'tiles') return <div data-shot className="grid gap-(--tile-gap)" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 165px), 1fr))' }}>{(s.cards ?? []).flatMap((c, i) => (c.summaries ?? (c.summary ? [c.summary] : [])).map((t: any, j: number) => <div className="min-w-0" key={`${i}${j}`}><SummaryTile s={t} href={c.href} /></div>))}</div>;
  if (s.mode === 'media') return <div data-shot className="grid gap-(--card-gap)" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}>{(s.cards ?? []).flatMap(c => c.items ?? []).map((m: any, i: number) => <NowPlaying key={i} m={m} compact />)}</div>;
  if (s.mode === 'group') return <div data-shot className="grid gap-(--card-gap)" style={{ gridTemplateColumns: `repeat(${Math.min((s.cards ?? []).length, 3)}, minmax(0, 1fr))` }}>{(s.cards ?? []).map((c, i) => <Widget key={i} card={c} fill run={run} />)}</div>;
  if (s.mode === 'island') return <div data-shot className="glass-bar glass-plate relative inline-flex items-center gap-3 border px-4 py-1.5" style={{ marginBottom: 150 }}><LiveRings live={s.live ?? []} /></div>;
  return null;
}

/** The year in review is the real story; only /api/recap is answered from the spec. */
try { localStorage.setItem('valet-recap-hint', '1'); } catch { /* it only hides a hint */ }
const real = window.fetch;
let recap: unknown;
window.fetch = (async (u: any, i: any) => String(u).startsWith('/api/recap') ? new Response(JSON.stringify(recap)) : real(u, i)) as typeof fetch;
function Recap({ s }: { s: Spec }) {
  recap = s.recap;
  return <RecapStory key={s.key} onClose={() => {}} />;
}

function Harness() {
  const [spec, setSpec] = useState<Spec | null>(null);
  useEffect(() => {
    (window as any).show = (s: Spec) => {
      const root = document.documentElement;
      root.classList.toggle('dark', (s.theme ?? 'dark') === 'dark');
      root.classList.toggle('glass-light', s.theme === 'light');
      root.classList.toggle('has-wallpaper', s.wall !== false);
      root.classList.toggle('no-wall', s.wall === false);
      setSpec(s);
    };
    (window as any).ready = true;
  }, []);
  if (!spec) return null;
  return <TooltipProvider><div id="wall" />{spec.mode === 'recap' ? <Recap s={spec} /> : <div id="stage" key={spec.key}><Shot s={spec} /></div>}</TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
