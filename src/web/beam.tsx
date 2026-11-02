// The light that travels around the chat box, if the config asks for it (`chat.beam`). Loaded only then. `thinking` is
// a band of our own, there only while the answer comes, so nothing about it runs or loads the rest of the time.
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn, useOnScreen } from '@/lib/utils';
import type { ChatUi } from './assistant.tsx';

const BorderBeam = lazy(() => import('border-beam').then(m => ({ default: m.BorderBeam })));

/** One band going round: a faint tail that brightens in steps to a short head, measured along the edge so it keeps its speed in any box. */
function Edge({ ui }: { ui?: ChatUi }) {
  return <svg className="edge" data-tone={ui?.beamColor ?? 'colorful'} style={{ '--edge-a': (ui?.beamStrength ?? .45) * 1.8 } as CSSProperties} aria-hidden><rect className="edge-tail" pathLength={100} /><rect className="edge-head" pathLength={100} /><rect className="edge-head is-tip" pathLength={100} /></svg>;
}

export function ChatBeam({ ui, busy, className, children }: { ui?: ChatUi; busy?: boolean; className?: string; children: ReactNode }) {
  const [typing, setTyping] = useState(false), [box, seen] = useOnScreen<HTMLDivElement>(), mode = ui?.beam ?? 'off';
  // `once`: a lap to say hello as the page opens, then only while you're typing
  const [hello, setHello] = useState(false), greeted = useRef(false);
  useEffect(() => {
    if (mode !== 'once' || greeted.current) return;   // the setting arrives with the page, after this first draws
    greeted.current = true; setHello(true);
    setTimeout(() => setHello(false), 5000);
  }, [mode]);
  if (mode === 'off') return <div className={className}>{children}</div>;
  if (mode === 'thinking') return <div ref={box} className={cn('relative', className)}>{children}{busy && seen && <Edge ui={ui} />}</div>;
  const on = seen && (mode === 'always' || hello || ((mode === 'focus' || mode === 'once') && typing));
  return (
    <div ref={box} className={className} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}>
      <Suspense fallback={children}><BorderBeam active={on} colorVariant={ui?.beamColor ?? 'mono'} strength={ui?.beamStrength ?? .45} duration={5} style={{ display: 'block', width: '100%' }}>{children}</BorderBeam></Suspense>
    </div>
  );
}
