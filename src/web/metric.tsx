// A number and its unit, drawn one way everywhere: no gap before ° or %, a thin one before a word (GB, MB/s, h), and the
// unit muted at a set fraction of the number's size, so "18%", "20.0°C" and "58 GB" read alike at any size. The size
// itself stays the caller's class; `size` only picks how much smaller the unit is (l: a hero, m: a tile, s: inline).
import { cn } from '@/lib/utils';
import { splitUnit } from './format.ts';
import { Counter } from './feel.tsx';

export function Metric({ value, unit, size = 'm', flap, className }: { value: string | number; unit?: string; size?: 's' | 'm' | 'l'; flap?: boolean; className?: string }) {
  const [n, u] = unit != null ? [String(value), unit.trim()] : splitUnit(value);
  if (!u) return <Counter value={n} flap={flap} className={className} />;
  // a degree belongs to the number ("20.0°"), and only its letter is the unit
  const deg = u.startsWith('°'), rest = deg ? u.slice(1) : u;
  return (
    <span className={cn('metric-pair', className)}>
      <Counter value={deg ? `${n}°` : n} flap={flap} />
      {rest && <span className="metric-unit" data-size={size} data-word={/^[%′″]/.test(rest) || deg ? undefined : ''}>{rest}</span>}
    </span>
  );
}
