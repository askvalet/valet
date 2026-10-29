// Renders any card from the shared catalog. The homepage and the assistant use exactly this, so a generated card
// looks the same as the widget it came from.
import type { Card, ChartCard, Control, ControlsCard, ListCard, MediaCard, StatsCard, StatusCard, Tone } from '../shared/cards.ts';
import { Icon } from './icons.tsx';

const toneText = (t?: Tone) => (t && t !== 'neutral' ? `tone-${t}` : '');

function Spark({ points, tone }: { points: number[]; tone?: Tone }) {
  if (points.length < 2) return null;
  const w = 120, h = 28, max = Math.max(...points, 1), min = Math.min(...points, 0);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 2 - ((p - min) / (max - min || 1)) * (h - 4)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const color = tone && tone !== 'neutral' ? `var(--${tone})` : 'var(--accent)';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-7 mt-2" aria-hidden="true">
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={color} opacity=".1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Meter({ pct, tone }: { pct: number; tone?: Tone }) {
  return <div className="meter"><i className={`bg-tone-${tone ?? 'neutral'}`} style={{ width: `${Math.max(2, Math.min(100, pct * 100))}%` }} /></div>;
}

function Stats({ card }: { card: StatsCard }) {
  return (
    <div className="grid gap-x-5 gap-y-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))` }}>
      {card.items.map(s => (
        <div key={s.label} className="min-w-0">
          <div className="text-[13px] muted">{s.label}</div>
          <div className={`num text-[30px] leading-tight ${toneText(s.tone)}`}>
            {s.value}{s.unit && <span className="text-[17px] muted font-medium ml-0.5">{s.unit}</span>}
          </div>
          {s.sub && <div className="text-[12.5px] muted truncate">{s.sub}</div>}
          {s.trend ? <Spark points={s.trend} tone={s.tone} /> : s.pct != null && <div className="mt-2"><Meter pct={s.pct} tone={s.tone} /></div>}
        </div>
      ))}
    </div>
  );
}

function List({ card }: { card: ListCard }) {
  if (!card.items.length) return <Empty text={card.empty ?? 'Nothing here'} />;
  return (
    <ul className="space-y-3">
      {card.items.map((it, i) => (
        <li key={i} className="min-w-0 flex gap-3 items-center">
          {it.image && <img src={it.image} alt="" loading="lazy" className="w-9 h-[52px] rounded-md object-cover shrink-0 bg-[var(--hair)]" />}
          <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{it.title}</div>
              {it.subtitle && <div className={`text-[12.5px] truncate ${it.tone && it.tone !== 'neutral' ? toneText(it.tone) : 'muted'}`}>{it.subtitle}</div>}
            </div>
            {it.meta && <div className="num text-[14px] muted shrink-0">{it.meta}</div>}
          </div>
          {it.pct != null && <div className="mt-1.5"><Meter pct={it.pct} tone={it.tone} /></div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Status({ card }: { card: StatusCard }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {card.items.map(s => (
        <a key={s.name} href={s.href} target="_blank" rel="noreferrer"
          className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-[var(--hair)] transition-colors min-w-0">
          <span className={`dot ${s.ok ? 'ok' : 'down'}`} />
          <span className="truncate flex-1">{s.name}</span>
          <span className={`num text-[12.5px] ${s.ok ? 'faint' : 'tone-bad'}`}>{s.ok ? (s.ms != null ? `${s.ms} ms` : '') : s.detail}</span>
        </a>
      ))}
    </div>
  );
}

function Media({ card }: { card: MediaCard }) {
  if (!card.items.length) return <Empty text={card.empty ?? 'Nothing playing'} />;
  return (
    <ul className="space-y-3">
      {card.items.map((m, i) => (
        <li key={i} className="flex gap-3 min-w-0">
          <div className="w-14 h-20 rounded-lg overflow-hidden shrink-0 bg-[var(--hair)] grid place-items-center">
            {m.image ? <img src={m.image} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Icon name="film" className="faint" />}
          </div>
          <div className="min-w-0 flex-1 flex flex-col">
            <div className="font-medium truncate">{m.title}</div>
            {m.subtitle && <div className="text-[13px] muted truncate">{m.subtitle}</div>}
            <div className="text-[12.5px] muted truncate mt-0.5">{[m.user, m.device].filter(Boolean).join(' · ')}</div>
            <div className="mt-auto">
              <div className="flex justify-between text-[12px] faint mb-1">
                <span>{m.state === 'paused' ? 'Paused' : m.state === 'buffering' ? 'Buffering' : 'Playing'}</span><span>{m.detail}</span>
              </div>
              {m.pct != null && <Meter pct={m.pct} tone={m.state === 'paused' ? 'warn' : 'accent'} />}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Chart({ card }: { card: ChartCard }) {
  const w = 300, h = 90;
  const all = card.series.flatMap(s => s.points), max = card.max ?? Math.max(...all, 1);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-24" aria-hidden="true">
        {card.series.map((s, k) => {
          const xy = s.points.map((p, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, s.points.length - 1)) * w).toFixed(1)},${(h - 2 - (p / max) * (h - 6)).toFixed(1)}`).join('');
          const color = s.tone && s.tone !== 'neutral' ? `var(--${s.tone})` : k ? 'var(--muted)' : 'var(--accent)';
          return <g key={s.name}><path d={`${xy}L${w},${h}L0,${h}Z`} fill={color} opacity={k ? 0 : .1} />
            <path d={xy} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></g>;
        })}
      </svg>
      <div className="flex gap-4 text-[12.5px] muted mt-1">{card.series.map(s => <span key={s.name}>{s.name}</span>)}{card.span && <span className="ml-auto">{card.span}</span>}</div>
    </div>
  );
}

export type RunAction = (action: string, args?: Record<string, unknown>) => Promise<void>;

function Controls({ card, run }: { card: ControlsCard; run?: RunAction }) {
  const fire = (c: Control, extra: Record<string, unknown>) => c.action && run?.(c.action, { ...c.args, ...extra });
  return (
    <div className="space-y-2.5">
      {card.items.map(c => (
        <div key={c.id} className="flex items-center gap-3 min-w-0">
          {c.color && <span className="w-3 h-3 rounded-full shrink-0 border hair" style={{ background: c.color }} />}
          <span className="flex-1 min-w-0"><span className="block truncate">{c.label}</span>{c.sub && <span className="block text-[12.5px] muted truncate">{c.sub}</span>}</span>
          {c.kind === 'value' && <span className="num text-[15px]">{String(c.value ?? '–')}</span>}
          {c.kind === 'toggle' && (
            <button role="switch" aria-checked={!!c.value} aria-label={c.label} disabled={!run} onClick={() => fire(c, { value: !c.value })}
              className={`w-10 h-6 rounded-full p-0.5 transition-colors ${c.value ? 'bg-[var(--accent)]' : 'bg-[var(--hair)]'}`}>
              <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${c.value ? 'translate-x-4' : ''}`} />
            </button>
          )}
          {c.kind === 'slider' && (
            <input type="range" min={c.min ?? 0} max={c.max ?? 100} step={c.step ?? 1} defaultValue={Number(c.value ?? 0)} aria-label={c.label}
              className="w-32 accent-[var(--accent)]" disabled={!run} onChange={e => fire(c, { value: Number(e.target.value) })} />
          )}
          {c.kind === 'select' && (
            <select defaultValue={String(c.value ?? '')} aria-label={c.label} disabled={!run} onChange={e => fire(c, { value: e.target.value })}
              className="bg-transparent border hair rounded-lg px-2 py-1 text-[13.5px]">
              {c.options?.map(o => <option key={o}>{o}</option>)}
            </select>
          )}
          {c.kind === 'button' && <button className="btn btn-ghost" disabled={!run} onClick={() => fire(c, {})}>{String(c.value ?? 'Run')}</button>}
        </div>
      ))}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="muted text-[14px] py-1">{text}</div>;

/** The body of a card (no frame), so cards can sit inside a widget frame or a chat bubble. */
export function CardBody({ card, run }: { card: Card; run?: RunAction }) {
  switch (card.type) {
    case 'stats': return <Stats card={card} />;
    case 'list': return <List card={card} />;
    case 'status': return <Status card={card} />;
    case 'media': return <Media card={card} />;
    case 'chart': return <Chart card={card} />;
    case 'controls': return <Controls card={card} run={run} />;
    case 'kv': return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">{card.rows.map(([k, v]) => <><dt className="muted">{k}</dt><dd className="text-right num">{v}</dd></>)}</dl>;
    case 'text': return <p className={toneText(card.tone)}>{card.text}</p>;
    case 'group': return (
      <div className={card.layout === 'row' ? 'grid gap-3 sm:grid-cols-2' : 'space-y-3'}>
        {card.cards.map((c, i) => <Frame key={i} card={c} run={run} nested />)}
      </div>
    );
  }
}

export function Frame({ card, run, title, status, nested }: { card?: Card; run?: RunAction; title?: string; status?: React.ReactNode; nested?: boolean }) {
  const t = card?.title ?? title;
  return (
    <section className={`${nested ? 'rounded-2xl border hair p-4' : 'glass p-5'} min-w-0 fade-in`}>
      {(t || card?.href || status) && (
        <header className="flex items-center gap-2 mb-3.5 min-w-0">
          <Icon name={card?.icon} className="muted shrink-0" />
          <h2 className="font-semibold truncate">{t}</h2>
          {status}
          {card?.note && <span className="ml-auto text-[12.5px] muted num truncate">{card.note}</span>}
          {card?.href && (
            <a href={card.href} target="_blank" rel="noreferrer" aria-label={`Open ${t}`}
              className={`${card.note ? 'ml-2' : 'ml-auto'} faint hover:text-[var(--ink)] transition-colors`}><Icon name="ext" /></a>
          )}
        </header>
      )}
      {card ? <CardBody card={card} run={run} /> : <div className="space-y-2"><div className="h-4 w-2/3 rounded bg-[var(--hair)] pulse" /><div className="h-4 w-1/2 rounded bg-[var(--hair)] pulse" /></div>}
    </section>
  );
}
