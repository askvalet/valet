// The home card: the floor plan (home-model.ts) above a panel that works without it. Nothing selected: what's lit, the
// rooms, the robot. A room selected: its lights, each with a switch, brightness and colour, and "clean this room". The
// robot: its state, what its percentages mean, and its controls. Whatever is pressed answers in a line beside it.
import { ChevronLeft, Pause, Play, Power, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Chip, ChipDot } from '@/components/ui/chip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { batteryNote, createHome, heard, near, restoreGroups, unsettled, wearNote, type LightChange, type PlanData, type PlanLight, type PlanRobot } from './home-model.ts';
import { Counter, ElasticSlider } from '../feel.tsx';
import { Cant, Said, Slots, Swatch, useNote, useSteady } from './note.tsx';

type Run = (action: string, args?: Record<string, unknown>) => Promise<void>;
const WARMTH: [string, number, string][] = [['Candle', 2200, '#ffb46b'], ['Warm', 2700, '#ffc98f'], ['Neutral', 4000, '#ffe8d1'], ['Daylight', 6500, '#e6efff']];
const COLOURS: [string, string][] = [['Red', '#ff3b30'], ['Orange', '#ff9500'], ['Yellow', '#ffd60a'], ['Green', '#34c759'], ['Teal', '#00e0c6'], ['Blue', '#0a84ff'], ['Indigo', '#5e5ce6'], ['Purple', '#bf5af2'], ['Pink', '#ff2d92']];
const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hexOf = (c: number[]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const pretty = (s?: string) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const said = (r?: PlanRobot) => r?.error ?? pretty(r?.status ?? r?.state);
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;
const WAIT = 20_000;   // how long the robot gets to answer before the page says it hasn't
type Sent = { command: string; label: string; rooms?: number[]; fan?: string };

/** A row of a small surface, one line: ring, name, what's due, value. */
function Reading({ label, note, value, tone }: { label: string; note: string; value: number; tone?: 'warn' | 'bad' }) {
  const r = 7.5, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, value / 100)), color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--good)';
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 text-body leading-[1.35]">
      <svg viewBox="0 0 20 20" className="size-5 flex-none -rotate-90" aria-hidden>
        <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth="3" />
        <circle cx="10" cy="10" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${Math.max(.001, p) * c} ${c}`} className="transition-[stroke-dasharray] duration-(--dur-move)" />
      </svg>
      <span className="flex-none font-medium">{label}</span>
      <span className={cn('min-w-0 truncate', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-muted-foreground')}>{note}</span>
      <Counter value={`${value}%`} className="metric ml-auto flex-none text-[13px]" />
    </div>
  );
}

/** One line of the room: a name, its brightness and a switch that looks like one, whatever kind of light it is. */
function LightRow({ dot, name, state, label, middle, control }: { dot?: string; name: string; state: string; label: string; middle?: React.ReactNode; control: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="grid min-h-9 grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.5rem_auto] items-center gap-2 text-body leading-[1.35]">
      <span className="flex min-w-0 items-center gap-2">
        <ChipDot dot={dot ?? 'off'} />
        <span className="truncate" title={name}>{name}</span>
      </span>
      <span className="min-w-0">{middle}</span>
      <Counter value={state} className="text-right text-meta text-muted-foreground" />
      {control}
    </div>
  );
}

// the case's actions are chips; the one that starts the robot is the accent
const Pill = ({ accent, className, ...p }: { icon?: LucideIcon; accent?: boolean } & Omit<React.ComponentProps<'button'>, 'ref'>) =>
  <Chip {...p} className={cn('justify-center', accent && 'bg-primary font-medium text-primary-foreground [&:is(a,button)]:hover:bg-primary/90', className)} />;

export default function HomeCase({ data, run }: { data: PlanData; run?: Run }) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<ReturnType<typeof createHome> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Partial<PlanLight>>>({});   // optimistic changes while HA catches up
  const [note, say] = useNote();
  const [sent, setSent] = useState<Sent | null>(null), [queue, setQueue] = useState<{ rooms: number[]; running: boolean } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined), wait = useRef<ReturnType<typeof setTimeout>>(undefined), robot = useRef(data.robot);
  robot.current = data.robot;
  useEffect(() => setDraft(d => { const left = unsettled(d, data.rooms); return Object.keys(left).length === Object.keys(d).length ? d : left; }), [data]);
  useEffect(() => () => { clearTimeout(settle.current); clearTimeout(wait.current); }, []);
  const cleaning = useMemo(() => queue ? Object.fromEntries(queue.rooms.map(id => [id, queue.running ? 'running' as const : 'queued' as const])) : undefined, [queue]);
  const shown = useMemo(() => ({ ...data, cleaning, robot: data.robot && { ...data.robot, sent: !!sent && sent.command !== 'fan_speed' }, rooms: data.rooms.map(r => ({ ...r, lights: r.lights.map(l => ({ ...l, ...draft[l.id] })) })) }), [data, draft, cleaning, sent]);
  const view = data.view ?? { turn: -40, tilt: -35 };

  useEffect(() => {
    const s = createHome(box.current!, { ...view, remember: 'home', onPick: setSel });
    stage.current = s; return () => s.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.turn, view.tilt]);
  useEffect(() => { stage.current?.update(shown); }, [shown]);
  const choose = (id: string | null) => { setSel(id); stage.current?.select(id); };

  const set = async (l: PlanLight | PlanLight[], s: LightChange) => {
    const list = Array.isArray(l) ? l : [l];
    setDraft(d => ({ ...d, ...Object.fromEntries(list.map(x => [x.id, { on: s.on, ...(s.brightness ? { level: s.brightness } : {}), ...(s.rgb ? { color: hexOf(s.rgb), kelvin: undefined } : {}),
      ...(s.kelvin ? { kelvin: s.kelvin, color: WARMTH.find(w => w[1] === s.kelvin)?.[2] } : {}) }])) }));
    clearTimeout(settle.current); settle.current = setTimeout(() => setDraft({}), 8000);   // however long it's been, what comes back is the truth
    try { await run?.('light', { entity_id: list.map(x => x.id), ...s }); }
    catch (e) { setDraft(d => Object.fromEntries(Object.entries(d).filter(([id]) => !list.some(x => x.id === id)))); throw e; }
  };
  const failed = (e: Error) => say(`Couldn't change that: ${e.message}`, { tone: 'bad' });
  const change = (l: PlanLight | PlanLight[], s: LightChange) => { set(l, s).catch(failed); };
  // a switch that moves more than one light says what it did and can take it back, the same way it went
  const flip = (list: PlanLight[], on: boolean, what: string) => {
    const was = list.map(l => ({ ...l }));
    set(list, { on }).then(() => say(what, { undo: () => { Promise.all(restoreGroups(was).map(g => set(g.lights, g.change))).then(() => say('Put back as it was'), failed); } }), failed);
  };

  const r = data.robot, busy = !!r && /clean|return|mop/i.test(r.state), paused = !!r && /paus/i.test(r.state);
  const vac = (command: string, label: string, extra: { rooms?: number[]; fan_speed?: string } = {}) => {
    if (!r || !run) return;
    clearTimeout(wait.current);
    const drop = () => { setSent(null); setQueue(q => q?.running ? q : null); };
    setSent({ command, label, rooms: extra.rooms, fan: extra.fan_speed });
    if (extra.rooms) setQueue({ rooms: extra.rooms, running: false });
    say(`Sent: ${label}`, { tone: 'busy', ms: 0 });
    run('vacuum', { entity_id: r.id, command, ...extra }).then(() => {
      if (command === 'locate') { say('Sent: listen for the robot'); wait.current = setTimeout(() => setSent(null), 2500); return; }
      wait.current = setTimeout(() => { drop(); say(extra.fan_speed ? `Sent, but suction is still ${pretty(robot.current?.fanSpeed).toLowerCase()}` : `Sent, but the robot still says ${said(robot.current).toLowerCase()}`, { tone: 'warn' }); }, WAIT);
    }, (e: Error) => { drop(); say(`Couldn't send ${label}: ${e.message}`, { tone: 'bad' }); });
  };
  // the robot's own word settles it either way: what it did, then when it's finished
  useEffect(() => {
    if (!r) return;
    if (sent && heard(sent, r)) {
      clearTimeout(wait.current); setSent(null);
      say(sent.fan ? `Suction is ${pretty(r.fanSpeed).toLowerCase()}` : `Robot says: ${said(r).toLowerCase()}`);
      setQueue(q => q && (/clean/.test(sent.command) || sent.command === 'start') ? { ...q, running: true } : q);
    } else if (queue?.running && !busy && !paused) setQueue(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const lit = shown.rooms.flatMap(x => x.lights).filter(l => l.on);
  const room = shown.rooms.find(x => `room:${x.id}` === sel);
  const canAct = !!run;
  const lamps = room?.lights.filter(l => l.available) ?? [], lamped = lamps.filter(l => l.on);
  // colour goes to what's on; in a dark room, it's how you turn the room on
  const tint = (can: (l: PlanLight) => boolean) => lamped.some(can) ? lamped.filter(can) : lamps.filter(can);
  const warm = tint(l => l.canTemp), colour = tint(l => l.canColor), dims = tint(l => l.dims);
  const roomLevel = Math.max(0, ...lamped.filter(l => l.dims).map(l => l.level));
  const slide = (list: PlanLight[], v: number) => setDraft(d => ({ ...d, ...Object.fromEntries(list.map(l => [l.id, { ...d[l.id], on: true, level: v }])) }));
  const mine = room && queue?.rooms.includes(room.id), roomAt = mine ? queue!.running ? 'running' : 'sent' : 'clean';
  const sentWord = (...commands: string[]) => !!sent && commands.includes(sent.command);
  const viewOnly = !canAct && <Cant>View only: sign in to change this.</Cant>;
  const steady = useSteady(!!sel), [more, setMore] = useState(false), FEW = 4;
  const back = <Chip variant="outline" icon={ChevronLeft} onClick={() => choose(null)} className="gap-1 text-muted-foreground hover:text-foreground">All rooms</Chip>;
  return (
    <div className="case"><div ref={steady.body} className="case-body" style={steady.style}>
      <div className="relative">
        <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-inset" role="img" aria-label="3D floor plan. Drag to look around; select a room or the robot. Every room is also in the list below." />
      </div>
      {!sel && (
        <div key="all" className="@container/rooms space-y-2 animate-in fade-in duration-(--dur-pop)">
          <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1.5">
            {note ? <Said note={note} /> : <>
              <Counter value={String(lit.length)} className="metric text-metric-s leading-none" />
              <span className="text-body text-muted-foreground">{lit.length === 1 ? 'light on' : 'lights on'}</span>
              <Pill icon={Power} disabled={!canAct || !lit.length} onClick={() => flip(lit, false, `Turned off ${plural(lit.length, 'light')}`)}>All off</Pill>
            </>}
            {r && (
              <Chip onClick={() => choose('robot')} className="ml-auto @max-md/rooms:ml-0 @max-md/rooms:w-full @max-md/rooms:[&>span:last-child]:ml-auto" dot={r.error ? 'bad' : sent ? 'warn' : busy ? '#64d2ff' : 'good'}>
                <span>Vacuum · {sent ? 'Sent' : said(r)}</span>
                {r.battery != null && <span className="tabular text-muted-foreground">{r.battery}%</span>}
              </Chip>
            )}
          </div>
          {/* rooms in even columns, each chip its column's width with the state at the far end: tidy when the card is narrow */}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {shown.rooms.filter(rm => rm.lights.length || r).map((rm, i, all) => {
              const on = rm.lights.filter(l => l.on), clean = cleaning?.[rm.id], c = on[0]?.color ?? '#ffd8a8';
              // a narrow card shows four rooms and a chip for the rest, so the card stays short
              return (<Fragment key={rm.id}>
                {i === FEW && !more && <Chip variant="outline" onClick={() => /^#?home$/i.test(location.hash) ? setMore(true) : (location.hash = 'home')} className="hidden w-full text-muted-foreground @max-md/rooms:inline-flex">{all.length - FEW} more rooms</Chip>}
                <Chip variant="outline" onClick={() => choose(`room:${rm.id}`)} dot={on.length ? c : 'off'} className={cn('w-full min-w-0', i >= FEW && !more && '@max-md/rooms:hidden')}>
                  <span className="min-w-0 truncate">{rm.name}</span><span className="ml-auto flex-none text-muted-foreground">{clean ? (clean === 'queued' ? 'Queued' : 'Cleaning') : !rm.lights.length ? 'No lights' : on.length ? `${on.length}/${rm.lights.length}` : 'Off'}</span>
                </Chip></Fragment>
              );
            })}
          </div>
          {viewOnly}
        </div>
      )}

      {room && (
        <section key={room.id} aria-label={`${room.name} controls`} className="space-y-1 animate-in fade-in duration-(--dur-pop)">
          <div className="flex min-h-8 items-center gap-2">
            {back}
            <h4 className="min-w-0 truncate text-title font-semibold">{room.name}</h4>
            {room.lights.length > 0 && <span className="flex-none text-body text-muted-foreground">{lamped.length ? `${lamped.length} of ${room.lights.length} on` : 'All off'}</span>}
          </div>
          {!room.lights.length && <Cant>No lights in this room. Add them under <code className="text-caption">floorplans → rooms</code>.</Cant>}
          {room.lights.length > 0 && <>
            <LightRow name="Whole room" label="Whole room" dot={lamped[0]?.color} state={lamped.length ? `${roomLevel || 100}%` : 'Off'}
              middle={dims.length > 0 ? <ElasticSlider aria-label="Room brightness" disabled={!canAct} value={[roomLevel || 1]} min={1} max={100} step={1} onValueChange={([v]) => slide(dims, v)} onValueCommit={([v]) => change(dims, { on: true, brightness: v })} /> : <Cant>On/off only</Cant>}
              control={<Switch className="tap flex-none" disabled={!canAct || !lamps.length} checked={lamped.length > 0} aria-label={`${room.name}: whole room`} onCheckedChange={on => flip(lamps, on, `${room.name} ${on ? 'on' : 'off'}, ${plural(lamps.length, 'light')}`)} />} />
            {room.lights.map(l => (
              <LightRow key={l.id} name={l.name} label={l.name} dot={l.on ? l.color ?? '#ffd8a8' : undefined} state={!l.available ? '' : !l.on ? 'Off' : l.dims ? `${l.level}%` : 'On'}
                middle={!l.available ? <Cant>Unavailable</Cant> : !l.on || room.lights.length === 1 ? null : l.dims ? <ElasticSlider aria-label={`${l.name} brightness`} disabled={!canAct} value={[l.level]} min={1} max={100} step={1} onValueChange={([v]) => slide([l], v)} onValueCommit={([v]) => change(l, { on: true, brightness: v })} /> : <Cant>On/off only</Cant>}
                control={<Switch className="tap flex-none" disabled={!canAct || !l.available} checked={l.on} aria-label={l.name} onCheckedChange={on => change(l, { on })} />} />
            ))}
            <div className="flex flex-wrap items-center gap-x-3 pt-0.5">
              {warm.length > 0 && <div role="group" aria-label="Warmth" className="flex flex-wrap">{WARMTH.map(([name, k, swatch]) => (
                <Swatch key={k} name={name} color={swatch} disabled={!canAct} on={warm.every(l => l.on && (l.kelvin ? Math.abs(l.kelvin - k) < 250 : near(l.color, swatch)))} press={() => change(warm, { on: true, kelvin: k })} />))}</div>}
              {colour.length > 0 && <div role="group" aria-label="Colour" className="flex flex-wrap">{COLOURS.map(([name, c]) => (
                <Swatch key={c} name={name} color={c} disabled={!canAct} on={colour.every(l => l.on && !l.kelvin && near(l.color, c))} press={() => change(colour, { on: true, rgb: rgbOf(c) })} />))}</div>}
            </div>
            {lamps.length > 0 && !warm.length && !colour.length && <Cant>These lights can't change colour.</Cant>}
          </>}
          <div className="flex min-h-8 items-center gap-2">
            <Said note={note} className="flex-1" />
            {r && <Pill icon={Sparkles} disabled={!canAct || roomAt !== 'clean'} aria-label={`Clean ${room.name}`} onClick={() => vac('clean_rooms', `clean ${room.name}`, { rooms: [room.id] })}>
              <Slots at={roomAt} words={{ clean: 'Clean room', sent: 'Sent', running: 'Cleaning' }} /></Pill>}
          </div>
          {viewOnly}
        </section>
      )}

      {sel === 'robot' && r && (
        <section key="robot" aria-label="Vacuum controls" className="space-y-1.5 animate-in fade-in duration-(--dur-pop)">
          <div className="flex min-h-8 items-center gap-2">
            {back}
            <h4 className="flex-none text-title font-semibold">Vacuum</h4>
            <span className={cn('min-w-0 truncate text-body', r.error ? 'text-bad' : 'text-muted-foreground')}>{sent ? `Sent, ${said(r).toLowerCase()} for now` : said(r)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Pill accent={!busy} disabled={!canAct || !!sent} aria-label={busy ? 'Pause' : paused ? 'Resume' : 'Clean'} onClick={() => busy ? vac('pause', 'pause') : vac('start', paused ? 'resume' : 'clean everywhere')}>
              <Slots at={sentWord('start', 'pause', 'clean_rooms') ? 'sent' : busy ? 'pause' : paused ? 'resume' : 'clean'} words={{ clean: <><Play className="size-icon" fill="currentColor" />Clean</>, resume: <><Play className="size-icon" fill="currentColor" />Resume</>, pause: <><Pause className="size-icon" fill="currentColor" />Pause</>, sent: 'Sent' }} />
            </Pill>
            <Pill disabled={!canAct || !!sent || r.state === 'docked'} aria-label="Dock" onClick={() => vac('dock', 'dock')}><Slots at={sentWord('dock') ? 'sent' : r.state === 'docked' ? 'docked' : 'dock'} words={{ dock: 'Dock', docked: 'Docked', sent: 'Sent' }} /></Pill>
            <Pill disabled={!canAct || !!sent} aria-label="Find" onClick={() => vac('locate', 'find the robot')}><Slots at={sentWord('locate') ? 'sent' : 'find'} words={{ find: <><Zap className="size-icon" fill="currentColor" />Find</>, sent: 'Sent' }} /></Pill>
          </div>
          <div className="flex min-h-8 items-center gap-2 text-body">
            {r.fanSpeeds.length > 0 ? <>
              <span className="flex-none font-medium">Suction</span>
              <Select disabled={!canAct} value={sent?.fan ?? r.fanSpeed} onValueChange={v => vac('fan_speed', `suction ${pretty(v).toLowerCase()}`, { fan_speed: v })}>
                <SelectTrigger size="sm" className="ml-auto h-8 w-auto flex-none rounded-sm text-meta" aria-label="Suction"><SelectValue /></SelectTrigger>
                <SelectContent>{r.fanSpeeds.map(s => <SelectItem key={s} value={s}>{pretty(s)}</SelectItem>)}</SelectContent>
              </Select>
            </> : <Cant>This robot doesn't report suction levels.</Cant>}
          </div>
          <div>
            {r.battery != null && <Reading label="Battery" note={batteryNote(r.battery, r)} value={r.battery} tone={r.battery < 20 ? 'bad' : r.battery < 40 ? 'warn' : undefined} />}
            {r.wear.map(([name, n]) => <Reading key={name} label={name} note={wearNote(n)} value={n} tone={n < 10 ? 'bad' : n < 25 ? 'warn' : undefined} />)}
          </div>
          {r.wear.length > 0 ? <p className="text-meta leading-[1.35] text-muted-foreground">Part percentages are life left.</p> : <Cant>This robot doesn't report brush or filter wear.</Cant>}
          <Said note={note} />
          {viewOnly}
        </section>
      )}
    </div></div>
  );
}
