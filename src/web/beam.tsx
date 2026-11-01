// The light that travels around the chat box, if the config asks for it (`chat.beam`). Loaded only then.
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useOnScreen } from '@/lib/utils';
import type { ChatUi } from './assistant.tsx';

const BorderBeam = lazy(() => import('border-beam').then(m => ({ default: m.BorderBeam })));

export function ChatBeam({ ui, busy, className, children }: { ui?: ChatUi; busy?: boolean; className?: string; children: ReactNode }) {
  const [typing, setTyping] = useState(false), [box, seen] = useOnScreen<HTMLDivElement>(), mode = ui?.beam ?? 'off';
  if (mode === 'off') return <div className={className}>{children}</div>;
  const on = seen && (mode === 'always' || (mode === 'focus' && typing) || (mode === 'thinking' && !!busy));
  return (
    <div ref={box} className={className} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}>
      <Suspense fallback={children}><BorderBeam active={on} colorVariant={ui?.beamColor ?? 'mono'} strength={ui?.beamStrength ?? .45} duration={5} style={{ display: 'block', width: '100%' }}>{children}</BorderBeam></Suspense>
    </div>
  );
}
