// ⌘K's search inside the services: as you type, the server asks every search tool at once (GET /api/search) and sends
// each answer as it arrives, one group per service under the page's own things. It never holds the palette up: nothing
// is asked until the typing rests, an answer that's late lands in its own place, and what was found before stays until
// its service answers again.
import { ArrowUpRight, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { hitsOf, type Found } from '../shared/search.ts';

/** Where found rows sit: under anything of the page's own that what's typed names (1 to .8), under asking (.5) and a web
 *  search (.45), so they never take Enter from those; above what only loosely matches. The services have already chosen
 *  and ordered the rows themselves. */
export const FOUND_SCORE = .44;
export const isFound = (value: string) => value.startsWith('found ');
const REST = 90, MIN = 2;

const seen = new Map<string, Found[]>();
const inOrder = (list: Iterable<Found>) => [...list].filter(f => f.card).sort((a, b) => a.n - b.n);

/** Read the answer line by line, calling `each` as lines arrive. */
export async function lines(body: ReadableStream<Uint8Array>, each: (batch: Found[]) => void) {
  const reader = body.getReader(), text = new TextDecoder();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += text.decode(value, { stream: true });
    const parts = rest.split('\n');
    rest = parts.pop()!;
    const batch = parts.filter(Boolean).map(p => JSON.parse(p) as Found);
    if (batch.length) each(batch);
  }
}

export function useFound(query: string, on: boolean) {
  const typed = query.trim().replace(/\s+/g, ' ').slice(0, 80), q = typed.toLowerCase();
  const [found, setFound] = useState<Found[]>(() => seen.get(q) ?? []);
  const words = useRef(typed);
  words.current = typed;
  useEffect(() => {
    if (!on || q.length < MIN) return setFound([]);
    const known = seen.get(q);
    if (known) return setFound(known);
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const got = new Map<string, Found>();
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(words.current)}`, { signal: ac.signal });
        if (!r.ok || !r.body) return;
        // each service's new answer takes the place of its old one; the ones still thinking keep theirs for now
        await lines(r.body, batch => {
          for (const f of batch) got.set(f.id, f);
          setFound(was => inOrder(new Map([...was.map(f => [f.id, f] as const), ...got]).values()));
        });
        const all = inOrder(got.values());
        if (seen.size > 100) seen.clear();
        seen.set(q, all); setFound(all);
      } catch { /* the typing moved on, or Valet can't be reached: the rest of the palette is unaffected */ }
    }, REST);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q, on]);
  return q.length >= MIN ? found : [];
}

export function FoundGroups({ found, show, close }: { found: Found[]; show: (f: Found) => void; close: () => void }) {
  return found.map(f => {
    const hits = hitsOf(f.card);
    return hits.length > 0 && (
      <CommandGroup key={f.id} heading={f.source}>
        {hits.map((h, i) => (
          // a row with an address opens it; one without shows what the service found, as its card
          <CommandItem key={i} value={`found ${f.id} ${i}`} onSelect={() => { if (h.href) { window.open(h.href, '_blank', 'noopener'); close(); } else show(f); }}>
            {h.image ? <img src={h.image} alt="" loading="lazy" className="-my-1 size-7 shrink-0 rounded-thumb object-cover" /> : <Search className="text-muted-foreground" />}
            <span className="min-w-0 truncate">{h.title}{h.sub && <span className="text-muted-foreground"> · {h.sub}</span>}</span>
            {h.href && <ArrowUpRight className="ml-auto shrink-0 text-muted-foreground" />}
          </CommandItem>
        ))}
      </CommandGroup>
    );
  });
}
