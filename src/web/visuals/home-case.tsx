// The home card: the floor plan (home-model.ts) beside a panel. Nothing selected: what's lit, the rooms, the robot.
// A room selected: its lights, each with on/off, brightness and colour, and "clean this room". The robot: its state,
// battery and wear as rings, and its controls.
import { ChevronLeft, Pause, Play, Power, Sparkles, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { createHome, type PlanData, type PlanLight } from './home-model.ts';

type Run = (action: string, args?: Record<string, unknown>) => Promise<void>;
const WARMTH: [string, number, string][] = [['Candle', 2200, '#ffb46b'], ['Warm', 2700, '#ffc98f'], ['Neutral', 4000, '#ffe8d1'], ['Daylight', 6500, '#e6efff']];
const COLOURS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00e0c6', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d92'];
const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const pretty = (s?: string) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const mins = (n?: number) => n == null ? undefined : n >= 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`;

function Ring({ label, value, unit, pct, tone }: { label: string; value: ReactNode; unit?: string; pct: number; tone?: 'warn' | 'bad' }) {
  const r = 30, c = 2 * Math.PI * r, arc = c * .75, p = Math.max(0, Math.min(1, pct));
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--good)';
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative size-[72px]">
        <svg viewBox="0 0 76 76" className="size-full rotate-[135deg]" aria-hidden>
          <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
          <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${Math.max(.001, p) * arc} ${c}`} className="transition-[stroke-dasharray] duration-700" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="metric text-[16px]">{value}</span>{unit && <span className="mt-0.5 text-[10px] text-muted-foreground">{unit}</span>}
        </div>
      </div>
      <div className="-mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function LightRow({ l, set }: { l: PlanLight; set: (l: PlanLight, s: Record<string, unknown>) => void }) {
  const [level, setLevel] = useState(l.level);
  useEffect(() => setLevel(l.level), [l.level]);
  return (
    <div className={cn('rounded-xl bg-white/[.05] p-3 transition-opacity', !l.available && 'opacity-50')}>
      <div className="flex items-center gap-3">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.on ? l.color ?? '#ffd8a8' : 'transparent', boxShadow: l.on ? `0 0 8px ${l.color ?? '#ffd8a8'}` : 'inset 0 0 0 1px rgb(255 255 255 / .3)' }} />
        <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
        {l.available ? <Switch checked={l.on} onCheckedChange={on => set(l, { on })} aria-label={`${l.name} on`} /> : <span className="text-xs text-muted-foreground">Unavailable</span>}
      </div>
      {l.on && l.dims && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <Slider value={[level]} min={1} max={100} step={1} onValueChange={([v]) => setLevel(v)} onValueCommit={([v]) => set(l, { on: true, brightness: v })} aria-label="Brightness" />
            <span className="w-9 text-right text-xs tabular text-muted-foreground">{level}%</span>
          </div>
          {(l.canTemp || l.canColor) && (
            <div className="flex flex-wrap gap-1.5">
              {l.canTemp && WARMTH.map(([name, k, swatch]) => (
                <button key={k} title={name} aria-label={name} onClick={() => set(l, { on: true, kelvin: k })}
                  className={cn('size-5 rounded-full transition-transform hover:scale-110', l.kelvin && Math.abs(l.kelvin - k) < 250 && 'ring-2 ring-white/80 ring-offset-1 ring-offset-transparent')} style={{ background: swatch }} />
              ))}
              {l.canColor && COLOURS.map(c => (
                <button key={c} aria-label="Colour" onClick={() => set(l, { on: true, rgb: rgbOf(c) })} className="size-5 rounded-full transition-transform hover:scale-110" style={{ background: c }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HomeCase({ data, run }: { data: PlanData; run?: Run }) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<ReturnType<typeof createHome> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Partial<PlanLight>>>({});   // optimistic changes while HA catches up
  useEffect(() => setDraft({}), [data]);
  const shown = useMemo(() => ({ ...data, rooms: data.rooms.map(r => ({ ...r, lights: r.lights.map(l => ({ ...l, ...draft[l.id] })) })) }), [data, draft]);
  const view = data.view ?? { turn: -10, tilt: -58 };

  useEffect(() => {
    const s = createHome(box.current!, { ...view, onPick: setSel });
    stage.current = s; return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.turn, view.tilt]);
  useEffect(() => { stage.current?.update(shown); }, [shown]);
  const choose = (id: string | null) => { setSel(id); stage.current?.select(id); };

  const set = (l: PlanLight | PlanLight[], s: Record<string, unknown>) => {
    const list = Array.isArray(l) ? l : [l];
    setDraft(d => ({ ...d, ...Object.fromEntries(list.map(x => [x.id, { on: s.on as boolean, ...(s.brightness ? { level: s.brightness as number } : {}),
      ...(s.rgb ? { color: '#' + (s.rgb as number[]).map(v => v.toString(16).padStart(2, '0')).join('') } : {}) }])) }));
    run?.('light', { entity_id: list.map(x => x.id), ...s });
  };
  const vac = (command: string, extra: Record<string, unknown> = {}) => data.robot && run?.('vacuum', { entity_id: data.robot.id, command, ...extra });

  const lit = shown.rooms.flatMap(r => r.lights).filter(l => l.on);
  const room = shown.rooms.find(r => `room:${r.id}` === sel);
  const r = data.robot;
  const busy = r && /clean|return|mop/i.test(r.state);

  return (
    <div className="grid items-start gap-x-4 gap-y-4 @xl/card:grid-cols-[minmax(0,1fr)_188px]">
      <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-xl" role="img" aria-label="3D floor plan. Drag to look around; select a room or the robot." />
      <div className="min-w-0 @xl/card:pt-2">
        {!sel && (
          <div className="space-y-5 animate-in fade-in duration-300">
            <div className="flex items-end justify-between">
              <div>
                <div className="metric text-[30px] leading-none">{lit.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">{lit.length === 1 ? 'light on' : 'lights on'}</div>
              </div>
              {lit.length > 0 && <Button size="sm" variant="secondary" className="rounded-full" onClick={() => set(lit, { on: false })}><Power className="size-3.5" />All off</Button>}
            </div>
            <div className="space-y-1">
              {shown.rooms.filter(rm => rm.lights.length).map(rm => {
                const on = rm.lights.filter(l => l.on);
                return (
                  <button key={rm.id} onClick={() => choose(`room:${rm.id}`)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[.07]">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: on.length ? on[0].color ?? '#ffd8a8' : 'transparent', boxShadow: on.length ? `0 0 8px ${on[0].color ?? '#ffd8a8'}` : 'inset 0 0 0 1px rgb(255 255 255 / .3)' }} />
                    <span className="flex-1 truncate text-sm">{rm.name}</span>
                    <span className="text-xs text-muted-foreground">{on.length ? `${on.length} of ${rm.lights.length}` : 'Off'}</span>
                  </button>
                );
              })}
            </div>
            {r && (
              <button onClick={() => choose('robot')} className="flex w-full items-center gap-3 rounded-xl bg-white/[.05] px-3 py-2.5 text-left transition-colors hover:bg-white/[.09]">
                <span className={cn('size-2.5 shrink-0 rounded-full', r.error ? 'bg-bad' : busy ? 'bg-[#64d2ff]' : 'bg-good')} />
                <span className="min-w-0 flex-1"><span className="block text-sm">Vacuum</span><span className="block truncate text-xs text-muted-foreground">{r.error ?? pretty(r.status ?? r.state)}</span></span>
                {r.battery != null && <span className="text-xs tabular text-muted-foreground">{r.battery}%</span>}
              </button>
            )}
            <p className="text-[11.5px] text-muted-foreground/70">Drag to look around. Tap a room to see its lights.</p>
          </div>
        )}

        {room && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
            <div className="flex items-center gap-2">
              <button onClick={() => choose(null)} aria-label="Back" className="-ml-1.5 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><ChevronLeft className="size-4" /></button>
              <div className="flex-1 truncate text-[15px] font-semibold">{room.name}</div>
              {room.lights.length > 1 && <Switch checked={room.lights.some(l => l.on)} onCheckedChange={on => set(room.lights.filter(l => l.available), { on })} aria-label="Whole room" />}
            </div>
            {room.lights.length ? room.lights.map(l => <LightRow key={l.id} l={l} set={set} />) : <p className="text-sm text-muted-foreground">No lights in this room. Add them under <code className="text-xs">floorplans → rooms</code> in the config.</p>}
            {r && <Button variant="secondary" className="w-full rounded-xl" onClick={() => vac('clean_rooms', { rooms: [room.id] })}><Sparkles className="size-4" />Clean this room</Button>}
          </div>
        )}

        {sel === 'robot' && r && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-300">
            <div className="flex items-center gap-2">
              <button onClick={() => choose(null)} aria-label="Back" className="-ml-1.5 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><ChevronLeft className="size-4" /></button>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">Vacuum</div>
                <div className={cn('truncate text-xs', r.error ? 'text-bad' : 'text-muted-foreground')}>{r.error ?? pretty(r.status ?? r.state)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-3">
              {r.battery != null && <Ring label="Battery" value={r.battery} unit="%" pct={r.battery / 100} tone={r.battery < 20 ? 'bad' : r.battery < 40 ? 'warn' : undefined} />}
              {r.wear.map(([name, n]) => <Ring key={name} label={name} value={n} unit="% left" pct={n / 100} tone={n < 10 ? 'bad' : n < 25 ? 'warn' : undefined} />)}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {busy ? <Button variant="secondary" className="rounded-xl" onClick={() => vac('pause')}><Pause className="size-4" />Pause</Button>
                : <Button className="rounded-xl" onClick={() => vac('start')}><Play className="size-4" />Clean</Button>}
              <Button variant="secondary" className="rounded-xl" onClick={() => vac('dock')}>Dock</Button>
              <Button variant="secondary" className="rounded-xl" onClick={() => vac('locate')}><Zap className="size-4" />Find</Button>
            </div>
            {r.fanSpeeds.length > 0 && (
              <div>
                <div className="mb-2 text-[11.5px] text-muted-foreground">Suction</div>
                <Select value={r.fanSpeed} onValueChange={v => vac('fan_speed', { fan_speed: v })}>
                  <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{r.fanSpeeds.map(s => <SelectItem key={s} value={s}>{pretty(s)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {(r.cleanedArea != null || r.cleaningTime != null) && (
              <p className="text-xs text-muted-foreground">Last clean: {r.cleanedArea ?? '–'} m²{r.cleaningTime ? ` in ${mins(r.cleaningTime)}` : ''}{r.cleaningMode ? ` · ${r.cleaningMode.toLowerCase()}` : ''}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
