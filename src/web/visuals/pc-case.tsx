// The desktop card: the 3D model (pc-model.ts) above a panel. Nothing selected: presets, named, and the parts with their
// numbers. A part selected: the camera flies to it, the rest dims, and the panel shows its numbers and lighting.
import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Counter, ElasticSlider } from '../feel.tsx';
import { Cant, Said, StageTools, Swatch, useNote } from './note.tsx';
import { createViewer, hex, PICKS, topFans, type Light, type Metric, type ModelData } from './pc-model.ts';


// chip labels, short enough that every part fits on one row
const SHORT: Record<string, string> = { fans: 'Fans', pump: 'Cooler', ram: 'Memory', gpu: 'GPU', floor: 'Floor fans', strip: 'Case light' };
const SWATCHES = ['#ffffff', '#ffd2a1', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00e0c6', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d92'];
const NAMES: Record<string, string> = { '#ffffff': 'White', '#ffd2a1': 'Warm white', '#ff3b30': 'Red', '#ff9500': 'Orange', '#ffd60a': 'Yellow', '#34c759': 'Green', '#00e0c6': 'Teal', '#0a84ff': 'Blue', '#5e5ce6': 'Indigo', '#bf5af2': 'Purple', '#ff2d92': 'Pink' };
const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const pretty = (m: string) => m.replace(/([a-z])([A-Z])/g, '$1 $2');

/** A part's number as a small ring with its label beside it, coloured by health. */
function MiniGauge({ m }: { m: Metric }) {
  const r = 13, c = 2 * Math.PI * r, arc = c * .75, pct = Math.max(0, Math.min(1, m.pct ?? 0));
  const color = m.tone === 'bad' ? 'var(--bad)' : m.tone === 'warn' ? 'var(--warn)' : 'var(--good)';
  return (
    <span className="flex items-center gap-1.5" title={m.label}>
      <svg viewBox="0 0 32 32" className="size-7 rotate-[135deg]" aria-hidden>
        <circle cx="16" cy="16" r={r} fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        <circle cx="16" cy="16" r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${Math.max(.001, pct) * arc} ${c}`} className="transition-[stroke-dasharray] duration-(--dur-move)" />
      </svg>
      <span className="leading-[1.3]"><span className="metric flex items-baseline gap-0.5 text-[13px]"><Counter value={String(m.value)} /><span className="text-[11px] font-medium text-muted-foreground">{m.unit}</span></span>
        <span className="block text-[11px] text-muted-foreground">{m.label}</span></span>
    </span>
  );
}

type Run = (action: string, args?: Record<string, unknown>) => Promise<void>;
export interface PcCaseData extends ModelData {
  metrics?: Record<string, Metric[]>;                      // what each part shows when selected
  presets?: { id: string; name: string; swatch: string[]; active?: boolean }[];
  view?: { turn: number; tilt: number; draggable: boolean };
  controls?: boolean;
}

export default function PcCase({ data, run }: { data: PcCaseData; run?: Run }) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof createViewer> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Light>>({});   // optimistic lighting while a change is on its way
  const [moved, setMoved] = useState(false), [preset, setPreset] = useState<string | null>(null), [note, say] = useNote();
  const view = data.view ?? { turn: -27, tilt: -18, draggable: true };
  const fanId = topFans(data);
  const lightId = (pick: string) => pick === 'fans' ? fanId : PICKS.find(p => p.id === pick)?.light;
  // the data the model paints with: server state, overlaid with what was just picked
  const shown = useMemo(() => ({ ...data, parts: data.parts.map(p => draft[p.id] ? { ...p, zones: p.zones.map(z => ({ ...z, ...draft[p.id] })) } : p) }), [data, draft]);
  useEffect(() => setDraft({}), [data]);

  useEffect(() => {
    const v = createViewer(box.current!, { ...view, onPick: setSel, onMove: setMoved });
    viewer.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.turn, view.tilt, view.draggable]);
  useEffect(() => { viewer.current?.update(shown); }, [shown, view.turn, view.tilt, view.draggable]);
  const choose = (id: string | null) => { setSel(id); viewer.current?.select(id); };

  const pick = PICKS.find(p => p.id === sel);
  const light = pick ? lightId(pick.id) : undefined;
  const lp = shown.parts.find(p => p.id === light);
  const metrics = (sel === 'fans' ? data.metrics?.[fanId] : sel ? data.metrics?.[sel] : undefined) ?? [];
  const set = (st: Light) => {
    if (!light || !run) return;
    setDraft(d => ({ ...d, [light]: { ...(lp?.zones[0] ?? {}), ...st } })); setPreset(null);
    run('light', { part: light, state: st }).catch((e: Error) => { setDraft(d => { const { [light]: _, ...rest } = d; return rest; }); say(`Couldn't change that: ${e.message}`, { tone: 'bad' }); });
  };
  const applyPreset = (p: { id: string; name: string }) => {
    const was = preset; setPreset(p.id);
    run?.('preset', { id: p.id }).then(() => say(`Preset: ${p.name}`), (e: Error) => { setPreset(was); say(`Couldn't apply ${p.name}: ${e.message}`, { tone: 'bad' }); });
  };

  const zone = lp?.zones[0], off = zone?.mode === 'Off', effect = /rainbow|cycle/i.test(zone?.mode ?? '');
  const colourNow = off ? 'Off' : effect ? 'Set by the effect' : NAMES[hex(zone?.color)] ?? 'Custom';
  const active = preset ?? data.presets?.find(p => p.active)?.id;
  const value = (id: string) => { const m = (id === 'fans' ? data.metrics?.[fanId] : data.metrics?.[id])?.[0]; return m ? `${m.value}${m.unit === '°C' ? '°' : ` ${m.unit}`}` : undefined; };
  const dotOf = (id: string) => { const z = shown.parts.find(p => p.id === lightId(id))?.zones[0]; return z && z.mode !== 'Off' ? hex(z.color) : undefined; };
  const canAct = !!run && data.controls !== false;
  return (
    <div className="case"><div className="case-body">
      <div className="relative">
        <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-xl" aria-label="3D model of the PC. Select a part to see it and change its lighting; every part is also in the list below." role="img" />
        <StageTools moved={moved} reset={() => viewer.current?.reset()} hint={view.draggable ? 'Drag to look around' : undefined} />
      </div>
      {!pick ? (
        <div key="all" className="space-y-2 animate-in fade-in duration-(--dur-pop)">
          {!!data.presets?.length && (
            <div role="group" aria-label="Lighting presets" className="flex flex-wrap gap-1">
              {data.presets.map(p => (
                <button key={p.id} disabled={!run} onClick={() => applyPreset(p)} aria-pressed={p.id === active} title={p.name} className="press flex h-14 w-[60px] flex-none flex-col items-center gap-1 rounded-xl pt-1 hover:bg-foreground/[.06] aria-pressed:bg-foreground/10">
                  <i className="size-7 flex-none rounded-full outline-offset-1" style={{ background: p.swatch.length > 1 ? `conic-gradient(${[...p.swatch, p.swatch[0]].join(', ')})` : p.swatch[0], boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / .22)', outline: p.id === active ? '2px solid var(--foreground)' : '2px solid transparent' }} />
                  <span className={cn('max-w-full truncate text-[11px] leading-[1.3]', p.id === active ? 'font-medium' : 'text-muted-foreground')}>{p.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {PICKS.map(p => (
              <button key={p.id} onClick={() => choose(p.id)} className="press flex h-8 flex-none items-center gap-2 rounded-full px-3 text-[12.5px] ring-1 ring-foreground/15 hover:bg-foreground/10">
                {p.light && <i className="size-2 flex-none rounded-full" style={dotOf(p.id) ? { background: dotOf(p.id), boxShadow: `0 0 6px ${dotOf(p.id)}` } : { boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--foreground) 35%, transparent)' }} />}
                {SHORT[p.id] ?? p.name}{value(p.id) && <span className="tabular text-muted-foreground">{value(p.id)}</span>}
              </button>
            ))}
          </div>
          {data.controls === false ? <Cant>Lighting is read-only in this install.</Cant> : !run ? <Cant>View only: sign in to change this.</Cant> : <Said note={note} />}
        </div>
      ) : (
        <section key={pick.id} aria-label={`${pick.name} controls`} className="space-y-1.5 animate-in fade-in duration-(--dur-pop)">
          <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
            <button onClick={() => choose(null)} className="press flex h-8 flex-none items-center gap-1 rounded-full pr-3 pl-1.5 text-[12.5px] text-muted-foreground ring-1 ring-foreground/15 hover:bg-foreground/10 hover:text-foreground"><ChevronLeft className="size-4" />All parts</button>
            <h4 className="min-w-0 truncate text-[15px] font-semibold">{pick.name}</h4>
            {metrics.length > 0 && <span className="ml-auto flex flex-none items-center gap-4">{metrics.map(m => <MiniGauge key={m.label} m={m} />)}</span>}
          </div>
          {pick.note && <Cant>{pick.note}</Cant>}
          {pick.light && !lp && <Cant>Lighting not reachable yet: OpenRGB needs the i2c group (<code className="text-[11px]">sudo usermod -aG i2c $USER</code>, reboot).</Cant>}
          {lp && !canAct && <Cant>{data.controls === false ? 'Lighting is read-only in this install.' : 'View only: sign in to change this.'}</Cant>}
          {lp && canAct && (<>
            <div className="text-[12.5px] leading-[1.35]"><span className="font-medium">Colour</span> <span className="text-muted-foreground">{colourNow}</span></div>
            <div role="group" aria-label="Colour" className="flex flex-wrap">
              {SWATCHES.map(c => <Swatch key={c} name={NAMES[c]} color={c} on={!off && !effect && hex(zone?.color) === c} press={() => set({ color: rgbOf(c), mode: ['Off', 'Rainbow', 'RainbowMorph', 'ColorCycle'].includes(zone?.mode ?? '') ? 'Static' : zone?.mode })} />)}
              <label className="swatch relative cursor-pointer" title="Any colour">
                <i style={{ background: 'conic-gradient(#ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92, #ff3b30)' }} />
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0" aria-label="Any colour" value={hex(zone?.color)} onChange={e => set({ color: rgbOf(e.target.value), mode: 'Static' })} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {lp.modes && lp.modes.length > 1 ? (
                <span className="flex flex-none items-center gap-2 text-[12.5px]"><span className="font-medium">Effect</span>
                  <Select value={zone?.mode} onValueChange={mode => set({ mode })}>
                    <SelectTrigger size="sm" className="h-8 w-auto flex-none rounded-full text-xs" aria-label="Effect"><SelectValue /></SelectTrigger>
                    <SelectContent>{lp.modes.map(m => <SelectItem key={m} value={m}>{pretty(m)}</SelectItem>)}</SelectContent>
                  </Select></span>
              ) : <Cant className="flex-none">One effect only</Cant>}
              <span className="flex min-w-40 flex-1 items-center gap-2 text-[12.5px]"><span className="flex-none font-medium">Brightness</span>
                <ElasticSlider className="min-w-16 flex-1" aria-label="Brightness" value={[zone?.brightness ?? 100]} min={5} max={100} step={5}
                  onValueChange={([b]) => setDraft(d => ({ ...d, [light!]: { ...(lp.zones[0] ?? {}), brightness: b } }))} onValueCommit={([b]) => set({ brightness: b })} />
                <Counter value={`${zone?.brightness ?? 100}%`} className="w-9 flex-none text-right text-muted-foreground" /></span>
            </div>
          </>)}
          <Said note={note} />
        </section>
      )}
    </div></div>
  );
}
