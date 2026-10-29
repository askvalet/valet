// The home card: the floor plan (home-model.ts) beside a panel. Nothing selected: what's lit, the rooms, the robot.
// A room selected: its lights, each with on/off, brightness and colour, and "clean this room". The robot: its state,
// battery and wear as rings, and its controls.
import { ChevronLeft, Pause, Play, Power, Sparkles, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

/** A number as a small ring with its label beside it, coloured by health. */
function MiniRing({ label, value, pct, tone }: { label: string; value: number; pct: number; tone?: 'warn' | 'bad' }) {
  const r = 13, c = 2 * Math.PI * r, arc = c * .75, p = Math.max(0, Math.min(1, pct));
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--good)';
  return (
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 32 32" className="size-7 rotate-[135deg]" aria-hidden>
        <circle cx="16" cy="16" r={r} fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        <circle cx="16" cy="16" r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${Math.max(.001, p) * arc} ${c}`} className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <span className="leading-tight"><span className="metric block text-[13px]">{value}<span className="text-[10px] font-medium text-muted-foreground">%</span></span>
        <span className="block text-[10.5px] text-muted-foreground">{label}</span></span>
    </span>
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

  const row = 'no-scrollbar flex h-9 items-center gap-2 overflow-x-auto';
  const dot = (l?: { on: boolean; color?: string }) => ({ background: l?.on ? l.color ?? '#ffd8a8' : 'transparent', boxShadow: l?.on ? `0 0 8px ${l.color ?? '#ffd8a8'}` : 'inset 0 0 0 1px rgb(255 255 255 / .3)' });
  const roomLevel = room ? Math.max(0, ...room.lights.filter(l => l.on).map(l => l.level)) : 0;
  return (
    <div className="space-y-3">
      <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-xl" role="img" aria-label="3D floor plan. Drag to look around; select a room or the robot." />
      {/* the controls: two rows under the plan, always the same height, so picking a room never resizes the card */}
      <div className="h-[82px]">
        {!sel && (
          <div key="all" className="space-y-2.5 animate-in fade-in duration-300">
            <div className={row}>
              <span className="metric shrink-0 text-[22px] leading-none">{lit.length}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{lit.length === 1 ? 'light on' : 'lights on'}</span>
              {lit.length > 0 && <Button size="sm" variant="secondary" className="h-7 shrink-0 rounded-full text-xs" onClick={() => set(lit, { on: false })}><Power className="size-3.5" />All off</Button>}
              {r && (
                <button onClick={() => choose('robot')} className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-white/[.06] py-1 pr-3 pl-2.5 text-xs transition-colors hover:bg-white/[.1]">
                  <span className={cn('size-2 rounded-full', r.error ? 'bg-bad' : busy ? 'bg-[#64d2ff]' : 'bg-good')} />
                  <span>Vacuum · {r.error ?? pretty(r.status ?? r.state)}</span>
                  {r.battery != null && <span className="tabular text-muted-foreground">{r.battery}%</span>}
                </button>
              )}
            </div>
            <div className={row}>
              {shown.rooms.filter(rm => rm.lights.length).map(rm => {
                const on = rm.lights.filter(l => l.on);
                return (
                  <button key={rm.id} onClick={() => choose(`room:${rm.id}`)} className="flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[12.5px] ring-1 ring-white/12 transition-colors hover:bg-white/10">
                    <span className="size-2 rounded-full" style={dot(on[0])} />{rm.name}<span className="text-muted-foreground">{on.length ? `${on.length}/${rm.lights.length}` : 'Off'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {room && (
          <div key={room.id} className="space-y-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className={row}>
              <button onClick={() => choose(null)} aria-label="Back" className="-ml-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><ChevronLeft className="size-4" /></button>
              <span className="shrink-0 text-[15px] font-semibold">{room.name}</span>
              {room.lights.length > 0 && <Switch className="shrink-0" checked={room.lights.some(l => l.on)} onCheckedChange={on => set(room.lights.filter(l => l.available), { on })} aria-label="Whole room" />}
              {room.lights.some(l => l.on && l.dims) && (<>
                <Slider className="min-w-20 flex-1" aria-label="Room brightness" value={[roomLevel]} min={1} max={100} step={1}
                  onValueChange={([v]) => setDraft(d => ({ ...d, ...Object.fromEntries(room.lights.filter(l => l.on).map(l => [l.id, { ...d[l.id], level: v }])) }))}
                  onValueCommit={([v]) => set(room.lights.filter(l => l.on), { on: true, brightness: v })} />
                <span className="w-9 shrink-0 text-right text-xs tabular text-muted-foreground">{roomLevel}%</span>
              </>)}
              {r && <Button size="sm" variant="secondary" className="ml-auto h-7 shrink-0 rounded-full text-xs" onClick={() => vac('clean_rooms', { rooms: [room.id] })}><Sparkles className="size-3.5" />Clean</Button>}
            </div>
            <div className={row}>
              {!room.lights.length && <span className="text-[12.5px] text-muted-foreground">No lights here. Add them under <code className="text-[11px]">floorplans → rooms</code>.</span>}
              {room.lights.map(l => (
                <button key={l.id} disabled={!l.available} onClick={() => set(l, { on: !l.on })} title={l.on ? `${l.name}: ${l.level}%` : l.name}
                  className={cn('flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-[12.5px] ring-1 transition-colors', l.on ? 'bg-white/[.1] ring-white/20' : 'text-muted-foreground ring-white/10 hover:bg-white/[.06]', !l.available && 'opacity-40')}>
                  <span className="size-2 rounded-full" style={dot(l)} />{l.name}
                </button>
              ))}
              {room.lights.some(l => l.on && l.canTemp) && <span className="mx-1 h-4 w-px shrink-0 bg-white/15" />}
              {room.lights.some(l => l.on && l.canTemp) && WARMTH.map(([name, k, swatch]) => (
                <button key={k} title={name} aria-label={name} onClick={() => set(room.lights.filter(l => l.on && l.canTemp), { on: true, kelvin: k })}
                  className="size-5 shrink-0 rounded-full transition-transform hover:scale-110" style={{ background: swatch }} />
              ))}
              {room.lights.some(l => l.on && l.canColor) && COLOURS.slice(0, 6).map(c => (
                <button key={c} aria-label="Colour" onClick={() => set(room.lights.filter(l => l.on && l.canColor), { on: true, rgb: rgbOf(c) })}
                  className="size-5 shrink-0 rounded-full transition-transform hover:scale-110" style={{ background: c }} />
              ))}
            </div>
          </div>
        )}

        {sel === 'robot' && r && (
          <div key="robot" className="space-y-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className={row}>
              <button onClick={() => choose(null)} aria-label="Back" className="-ml-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><ChevronLeft className="size-4" /></button>
              <span className="shrink-0 text-[15px] font-semibold">Vacuum</span>
              <span className={cn('shrink-0 text-xs', r.error ? 'text-bad' : 'text-muted-foreground')}>{r.error ?? pretty(r.status ?? r.state)}</span>
              <span className="ml-auto flex shrink-0 gap-1.5">
                {busy ? <Button size="sm" variant="secondary" className="h-7 rounded-full text-xs" onClick={() => vac('pause')}><Pause className="size-3.5" />Pause</Button>
                  : <Button size="sm" className="h-7 rounded-full text-xs" onClick={() => vac('start')}><Play className="size-3.5" />Clean</Button>}
                <Button size="sm" variant="secondary" className="h-7 rounded-full text-xs" onClick={() => vac('dock')}>Dock</Button>
                <Button size="sm" variant="secondary" className="h-7 rounded-full text-xs" onClick={() => vac('locate')}><Zap className="size-3.5" />Find</Button>
              </span>
            </div>
            <div className={row}>
              <span className="flex shrink-0 items-center gap-4">
                {r.battery != null && <MiniRing label="Battery" value={r.battery} pct={r.battery / 100} tone={r.battery < 20 ? 'bad' : r.battery < 40 ? 'warn' : undefined} />}
                {r.wear.map(([name, n]) => <MiniRing key={name} label={name} value={n} pct={n / 100} tone={n < 10 ? 'bad' : n < 25 ? 'warn' : undefined} />)}
              </span>
              {r.fanSpeeds.length > 0 && (
                <Select value={r.fanSpeed} onValueChange={v => vac('fan_speed', { fan_speed: v })}>
                  <SelectTrigger size="sm" className="ml-auto h-7 w-auto shrink-0 rounded-full text-xs" aria-label="Suction"><SelectValue /></SelectTrigger>
                  <SelectContent>{r.fanSpeeds.map(s => <SelectItem key={s} value={s}>{pretty(s)}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
