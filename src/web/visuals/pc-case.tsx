// The desktop card: the 3D model (pc-model.ts) beside a panel. Nothing selected: presets and the parts.
// A part selected: the camera flies to it, the rest dims, and the panel shows its numbers and lighting.
import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { createViewer, hex, PICKS, topFans, type Light, type Metric, type ModelData } from './pc-model.ts';


const SWATCHES = ['#ffffff', '#ffd2a1', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00e0c6', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d92'];
const NAMES: Record<string, string> = { '#ffffff': 'White', '#ffd2a1': 'Warm white', '#ff3b30': 'Red', '#ff9500': 'Orange', '#ffd60a': 'Yellow', '#34c759': 'Green', '#00e0c6': 'Teal', '#0a84ff': 'Blue', '#5e5ce6': 'Indigo', '#bf5af2': 'Purple', '#ff2d92': 'Pink' };
const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const pretty = (m: string) => m.replace(/([a-z])([A-Z])/g, '$1 $2');
function describe(st?: Light) {
  if (!st || st.mode === 'Off') return 'Off';
  if (/rainbow|spectrum|wave|cycle|morph/i.test(st.mode ?? '')) return pretty(st.mode!);
  const name = NAMES[hex(st.color)] ?? hex(st.color);
  return `${name}${st.mode && !['Static', 'Direct'].includes(st.mode) ? ` · ${pretty(st.mode).toLowerCase()}` : ''}${(st.brightness ?? 100) < 100 ? ` · ${st.brightness}%` : ''}`;
}

/** A part's number as a ring: ¾ arc, value in the middle, coloured by health. */
function Gauge({ m }: { m: Metric }) {
  const r = 30, c = 2 * Math.PI * r, arc = c * .75, pct = Math.max(0, Math.min(1, m.pct ?? 0));
  const color = m.tone === 'bad' ? 'var(--bad)' : m.tone === 'warn' ? 'var(--warn)' : 'var(--good)';
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative size-[78px]">
        <svg viewBox="0 0 76 76" className="size-full rotate-[135deg]" aria-hidden>
          <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
          <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="5.5" strokeLinecap="round" strokeDasharray={`${Math.max(.001, pct) * arc} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out" style={{ filter: `drop-shadow(0 0 5px color-mix(in srgb, ${color} 40%, transparent))` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="metric text-[17px]">{m.value}</span>
          {m.unit && <span className="mt-0.5 text-[10px] text-muted-foreground">{m.unit}</span>}
        </div>
      </div>
      <div className="-mt-1 text-[11.5px] text-muted-foreground">{m.label}</div>
    </div>
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

  return (
    <div className="grid items-center gap-x-6 gap-y-4 @xl/card:grid-cols-[minmax(0,1fr)_220px]">
      <div ref={box} className="relative w-full touch-none select-none overflow-hidden rounded-xl" aria-label="3D model of the PC. Select a part to see it and change its lighting." role="img" />
      <div className="min-w-0 self-stretch">
        {!pick ? (
          <div className="flex h-full flex-col justify-center gap-5 animate-in fade-in duration-300">
            {data.presets?.length ? (
              <div>
                <div className="mb-2.5 text-[11.5px] text-muted-foreground">Presets</div>
                <div className="grid grid-cols-2 gap-2">
                  {data.presets.map(p => (
                    <button key={p.id} onClick={() => run?.('preset', { id: p.id })}
                      className="group/p flex items-center gap-2.5 rounded-xl bg-white/[.06] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[.12]">
                      <span className="size-5 shrink-0 rounded-full transition-transform group-hover/p:scale-110"
                        style={{ background: p.swatch.length > 1 ? `conic-gradient(${[...p.swatch, p.swatch[0]].join(', ')})` : p.swatch[0], boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / .2)' }} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <div className="mb-1.5 text-[11.5px] text-muted-foreground">Parts</div>
              <div className="flex flex-wrap gap-1.5">
                {PICKS.map(p => (
                  <button key={p.id} onClick={() => choose(p.id)} className="rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground ring-1 ring-white/12 transition-colors hover:bg-white/10 hover:text-foreground">{p.name}</button>
                ))}
              </div>
              {view.draggable && <p className="mt-3 text-[11.5px] text-muted-foreground/70">Drag to look around. Tap a part to focus it.</p>}
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-right-2 space-y-5 duration-300">
            <div className="flex items-center gap-2">
              <button onClick={() => choose(null)} aria-label="Back" className="-ml-1.5 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"><ChevronLeft className="size-4" /></button>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">{pick.name}</div>
                {lp?.sub && <div className="truncate text-xs text-muted-foreground">{lp.sub}</div>}
              </div>
            </div>
            {metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">{metrics.map(m => <Gauge key={m.label} m={m} />)}</div>
            )}
            {pick.note && <p className="text-sm text-muted-foreground">{pick.note}</p>}
            {pick.light && !lp && <p className="text-sm text-muted-foreground">Its lighting isn&rsquo;t reachable yet. OpenRGB needs access to the i2c bus: <code className="text-xs">sudo usermod -aG i2c $USER</code>, then reboot.</p>}
            {lp && data.controls !== false && (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[11.5px] text-muted-foreground">Colour</div>
                  <div className="flex flex-wrap gap-2">
                    {SWATCHES.map(c => {
                      const on = lp.zones[0]?.mode !== 'Off' && hex(lp.zones[0]?.color) === c;
                      return <button key={c} aria-label={NAMES[c]} title={NAMES[c]} onClick={() => set({ color: rgbOf(c), mode: ['Off', 'Rainbow', 'RainbowMorph', 'ColorCycle'].includes(lp.zones[0]?.mode ?? '') ? 'Static' : lp.zones[0]?.mode })}
                        className={cn('size-6 rounded-full transition-transform hover:scale-110', on && 'ring-2 ring-white ring-offset-2 ring-offset-transparent')} style={{ background: c, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .2)' }} />;
                    })}
                    <label className="relative size-6 cursor-pointer overflow-hidden rounded-full" title="Any colour" style={{ background: 'conic-gradient(#ff3b30, #ffd60a, #34c759, #00e0c6, #0a84ff, #bf5af2, #ff2d92, #ff3b30)' }}>
                      <input type="color" className="absolute inset-0 cursor-pointer opacity-0" aria-label="Any colour" value={hex(lp.zones[0]?.color)} onChange={e => set({ color: rgbOf(e.target.value), mode: 'Static' })} />
                    </label>
                  </div>
                </div>
                {lp.modes && lp.modes.length > 1 && (
                  <div>
                    <div className="mb-2 text-[11.5px] text-muted-foreground">Effect</div>
                    <Select value={lp.zones[0]?.mode} onValueChange={mode => set({ mode })}>
                      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{lp.modes.map(m => <SelectItem key={m} value={m}>{pretty(m)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <div className="mb-2 flex justify-between text-[11.5px] text-muted-foreground"><span>Brightness</span><span className="tabular">{lp.zones[0]?.brightness ?? 100}%</span></div>
                  <Slider value={[lp.zones[0]?.brightness ?? 100]} min={5} max={100} step={5} onValueChange={([b]) => setDraft(d => ({ ...d, [light!]: { ...(lp.zones[0] ?? {}), brightness: b } }))}
                    onValueCommit={([b]) => set({ brightness: b })} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
