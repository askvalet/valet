// The one bar: how far along, or how much. Its look lives in styles.css (`.meter`); this only says which.
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { Tone } from '../shared/cards.ts';

export type MeterLook = {
  pct: number;
  size?: 'sm' | 'md' | 'lg';
  /** a status, which wins over everything else */
  tone?: Tone;
  /** one of a set but not its leader: a neutral step, unless it has a hue */
  rest?: boolean;
  /** a ranking rather than progress: no track behind the fill */
  rank?: boolean;
  /** over a picture: white on white */
  art?: boolean;
  /** the scale is the colour (a temperature): the fill uncovers a gradient instead of sliding */
  scale?: boolean;
  /** its own colour, e.g. a live activity's */
  color?: string;
  /** a poster's hue, from `hue(tintOf(img))` */
  hue?: CSSProperties;
  label?: string;
  valuetext?: string;
  className?: string;
};

const TONE: Partial<Record<Tone, string>> = { good: 'meter-good', warn: 'meter-warn', bad: 'meter-bad', accent: 'meter-accent' };

export function Meter({ pct, size = 'md', tone, rest, rank, art, scale, color, hue, label, valuetext, className }: MeterLook) {
  const p = Math.max(0, Math.min(1, pct)), shown = p > 0 ? Math.max(.015, p) : 0;   // anything above nothing shows a sliver
  const own = tone && tone !== 'neutral' ? TONE[tone] : undefined;
  return (
    <div role={scale ? 'meter' : 'progressbar'} aria-label={label} aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={valuetext}
      data-tint={hue && !own ? '' : undefined} style={{ ...(!own && hue), ...(color && { '--meter-c': color }) } as CSSProperties}
      className={cn('meter', size !== 'md' && `meter-${size}`, own, !own && rest && 'meter-rest', !own && hue && !rest && 'is-lead', rank && 'meter-rank', art && 'meter-art', scale && 'meter-scale', className)}>
      <i className="meter-fill" style={scale ? { clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0 round 99px)` } : { transform: `translateX(${((shown - 1) * 100).toFixed(2)}%)` }} />
    </div>
  );
}
