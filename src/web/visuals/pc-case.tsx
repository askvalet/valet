// The desktop card: the 3D model (pc-model.ts) beside a panel. Nothing selected: presets and the parts.
// A part selected: the camera flies to it, the rest dims, and the panel shows its numbers and lighting.
import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
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
        <circle cx="16" cy="16" r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${Math.max(.001, pct) * arc} ${c}`} className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <span className="leading-tight"><span className="metric block text-[13px]">{m.value}<span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{m.unit}</span></span>
        <span className="block text-[10.5px] text-muted-foreground">{m.label}</span></span>
    </span>
  );
}

type Run = (action: string, args?: Record<string, unknown>) => Promise<void>;
export interface PcCaseData extends ModelData {
  metrics?: Record<string, Metric[]>;                      // what each part shows when selected
  presets?: { id: string; name: string; swatch: string[] }[];
  view?: { turn: number; tilt: number; draggable: boolean };
  controls?: boolean;
}

export default function PcCase({ data, run }: { data: PcCaseData; run?: Run }) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<ReturnType<typeof createViewer> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Light>>({});   // optimistic lighting while a change is on its way
  const view = data.view ?? { turn: -8, tilt: 0, draggable: true };
  const fanId = topFans(data);
  const lightId = (pick: string) => pick === 'fans' ? fanId : PICKS.find(p => p.id === pick)?.light;
  // the data the model paints with: server state, overlaid with what was just picked
  const shown = useMemo(() => ({ ...data, parts: data.parts.map(p => draft[p.id] ? { ...p, zones: p.zones.map(z => ({ ...z, ...draft[p.id] })) } : p) }), [data, draft]);
  useEffect(() => setDraft({}), [data]);

  useEffect(() => {
    const v = createViewer(box.current!, { ...view, onPick: setSel });
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
    setDraft(d => ({ ...d, [light]: { ...(lp?.zones[0] ?? {}), ...st } }));
    run('light', { part: light, state: st }).catch(() => setDraft(d => { const { [light]: _, ...rest } = d; return rest; }));
  };

  const row = 'no-scrollbar flex h-9 items-center gap-2 overflow-x-auto';
  return (
    <div className="space-y-3">
      <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-xl" aria-label="3D model of the PC. Select a part to see it and change its lighting." role="img" />
      {/* the controls: two rows under the model, always the same height, so picking a part never resizes the card */}
      <div className="h-[82px] space-y-2.5">
        {!pick ? (
          <div key="all" className="space-y-2.5 animate-in fade-in duration-300">
            <div className={row}>
              {data.presets?.map(p => (
                <button key={p.id} onClick={() => run?.('preset', { id: p.id })} title={p.name} aria-label={`Preset: ${p.name}`}
                  className="size-7 shrink-0 rounded-full transition-transform hover:scale-110"
                  style={{ background: p.swatch.length > 1 ? `conic-gradient(${[...p.swatch, p.swatch[0]].join(', ')})` : p.swatch[0], boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / .22)' }} />
              ))}
              {view.draggable && <span className="ml-auto shrink-0 pl-3 text-[11.5px] text-muted-foreground/70">Drag to look around</span>}
            </div>
            <div className={row}>
              {PICKS.map(p => (
                <button key={p.id} onClick={() => choose(p.id)} className="shrink-0 rounded-full px-3 py-1 text-[12.5px] text-muted-foreground ring-1 ring-white/12 transition-colors hover:bg-white/10 hover:text-foreground">{SHORT[p.id] ?? p.name}</button>
              ))}
            </div>
          </div>
        ) : (
          <div key={pick.id} className="space-y-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className={row}>
              <button onClick={() => choose(null)} aria-label="Back" className="-ml-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><ChevronLeft className="size-4" /></button>
              <span className="shrink-0 text-[15px] font-semibold">{pick.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-4 pl-3">{metrics.map(m => <MiniGauge key={m.label} m={m} />)}</span>
            </div>
            <div className={row}>
              {pick.note && <span className="text-[12.5px] text-muted-foreground">{pick.note}</span>}
              {pick.light && !lp && <span className="text-[12.5px] text-muted-foreground">Lighting not reachable yet: OpenRGB needs the i2c group (<code className="text-[11px]">sudo usermod -aG i2c $USER</code>, reboot).</span>}
              {lp && data.controls !== false && (<>
                {SWATCHES.map(c => {
                  const on = lp.zones[0]?.mode !== 'Off' && hex(lp.zones[0]?.color) === c;
                  return <button key={c} aria-label={NAMES[c]} title={NAMES[c]} onClick={() => set({ color: rgbOf(c), mode: ['Off', 'Rainbow', 'RainbowMorph', 'ColorCycle'].includes(lp.zones[0]?.mode ?? '') ? 'Static' : lp.zones[0]?.mode })}
                    className={cn('size-5 shrink-0 rounded-full transition-transform hover:scale-110', on && 'ring-2 ring-white ring-offset-1 ring-offset-transparent')} style={{ background: c, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .2)' }} />;
                })}
                <label className="relative size-5 shrink-0 cursor-pointer overflow-hidden rounded-full" title="Any colour" style={{ background: 'conic-gradient(#ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92, #ff3b30)' }}>
                  <input type="color" className="absolute inset-0 cursor-pointer opacity-0" aria-label="Any colour" value={hex(lp.zones[0]?.color)} onChange={e => set({ color: rgbOf(e.target.value), mode: 'Static' })} />
                </label>
                {lp.modes && lp.modes.length > 1 && (
                  <Select value={lp.zones[0]?.mode} onValueChange={mode => set({ mode })}>
                    <SelectTrigger size="sm" className="ml-1 h-7 w-auto shrink-0 rounded-full text-xs" aria-label="Effect"><SelectValue /></SelectTrigger>
                    <SelectContent>{lp.modes.map(m => <SelectItem key={m} value={m}>{pretty(m)}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Slider className="min-w-20 flex-1" aria-label="Brightness" value={[lp.zones[0]?.brightness ?? 100]} min={5} max={100} step={5}
                  onValueChange={([b]) => setDraft(d => ({ ...d, [light!]: { ...(lp.zones[0] ?? {}), brightness: b } }))} onValueCommit={([b]) => set({ brightness: b })} />
                <span className="w-9 shrink-0 text-right text-xs tabular text-muted-foreground">{lp.zones[0]?.brightness ?? 100}%</span>
              </>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
