// /#gallery: every card in the library, in every size, with made-up data. For designing cards and checking a change
// didn't break one. Loads only when asked for.
import { TooltipProvider } from '@/components/ui/tooltip';
import { MiniRing, SummaryTile, Widget } from './cards.tsx';
import { SAMPLES } from './samples.ts';

export default function Gallery() {
  return (
    <TooltipProvider>
      <main className="mx-auto max-w-[1400px] space-y-14 px-6 py-12">
        <header>
          <h1 className="text-[28px] font-semibold tracking-tight">Card library</h1>
          <p className="mt-1 text-sm text-muted-foreground">{SAMPLES.length} samples · each as a homepage card, a large card, in chat, and as a headline tile. Made-up data.</p>
        </header>
        {SAMPLES.map(({ name, card }) => (
          <section key={name} className="space-y-3">
            <h2 className="font-mono text-xs text-muted-foreground">{name}</h2>
            <div className="grid items-start gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr) minmax(0,.9fr)' }}>
              <div className="min-w-0 space-y-1.5"><div className="text-[11px] text-muted-foreground">medium</div><Widget card={card} run={async () => {}} /></div>
              <div className="min-w-0 space-y-1.5"><div className="text-[11px] text-muted-foreground">large</div><Widget card={card} large run={async () => {}} /></div>
              <div className="min-w-0 space-y-3">
                <div className="space-y-1.5"><div className="text-[11px] text-muted-foreground">in chat</div><Widget card={card} compact run={async () => {}} /></div>
                {card.summary && <div className="space-y-1.5"><div className="text-[11px] text-muted-foreground">small · tile and ring</div>
                  <div className="flex items-center gap-3"><div className="w-[200px]"><SummaryTile s={card.summary} /></div><MiniRing s={card.summary} /></div></div>}
              </div>
            </div>
          </section>
        ))}
      </main>
    </TooltipProvider>
  );
}
