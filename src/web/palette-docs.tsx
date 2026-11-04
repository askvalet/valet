// ⌘K's Docs group: Valet's own pages as you type, searched by the server from the copy it ships (GET /api/docs), so it
// works with no internet; only opening one goes to the site. It sits under everything else and never holds the palette up.
import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CommandGroup, CommandItem } from '@/components/ui/command';
import { DOCS_SITE, type DocHit } from '../shared/docs.ts';

/** What the palette's filter gives a docs result: above nothing, so its group is always last and never takes Enter from
 *  the owner's own things. The server has already chosen and ordered them. */
export const DOCS_SCORE = 1e-6;
export const isDoc = (value: string) => value.startsWith('docs ');

const seen = new Map<string, DocHit[]>();
export const docsUrl = (h: DocHit) => `${DOCS_SITE}/${h.path}${h.anchor ? `#${h.anchor}` : ''}`;

/** The results for what's typed, a beat after the typing stops. What was shown stays until the next answer arrives. */
function useDocs(query: string) {
  const q = query.trim().toLowerCase().slice(0, 80);
  const [hits, setHits] = useState<DocHit[]>(() => seen.get(q) ?? []);
  useEffect(() => {
    if (!q) return setHits([]);
    const known = seen.get(q);
    if (known) return setHits(known);
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/docs?q=${encodeURIComponent(q)}`, { signal: ac.signal }).then(r => r.ok ? r.json() : { docs: [] }).then(d => {
        const list: DocHit[] = Array.isArray(d.docs) ? d.docs : [];
        if (seen.size > 100) seen.clear();
        seen.set(q, list); setHits(list);
      }, () => {});
    }, 120);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q]);
  return q ? hits : [];
}

export function DocsGroup({ query, close }: { query: string; close: () => void }) {
  const hits = useDocs(query);
  if (!hits.length) return null;
  return (
    <CommandGroup heading="Docs">
      {hits.map(h => (
        <CommandItem key={`${h.path}#${h.anchor ?? ''}`} value={`docs ${h.path}#${h.anchor ?? ''}`} title={h.snippet}
          onSelect={() => { window.open(docsUrl(h), '_blank', 'noopener'); close(); }}>
          <BookOpen className="text-muted-foreground" />
          <span className="min-w-0 truncate">{h.title}{h.heading && <span className="text-muted-foreground"> · {h.heading}</span>}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
