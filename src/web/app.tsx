import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { StatusCard, WidgetState } from '../shared/cards.ts';
import { Frame } from './cards.tsx';
import { Icon } from './icons.tsx';

// The assistant (and the AI SDK client) loads only when someone asks something.
const Assistant = lazy(() => import('./assistant.tsx'));

interface Page {
  title: string; greeting?: string; location?: string;
  assistant: { name: string; model: string } | null;
  sections: { title?: string; columns?: number; widgets: string[] }[];
  widgets: Record<string, { title: string }>;
}

function useLive() {
  const [state, setState] = useState<Record<string, WidgetState>>({});
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('widget', e => {
      const s = JSON.parse((e as MessageEvent).data) as WidgetState;
      setState(prev => ({ ...prev, [s.key]: s }));
    });
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, []);
  return { state, online };
}

const greet = (h: number) => h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  return now;
}

/** One line that says whether anything needs attention, built from whatever widgets are on the page. */
function Pulse({ state }: { state: Record<string, WidgetState> }) {
  const status = Object.values(state).map(s => s.card).filter((c): c is StatusCard => c?.type === 'status');
  const items = status.flatMap(c => c.items);
  const down = items.filter(i => !i.ok);
  const errors = Object.values(state).filter(s => s.error);
  if (!items.length && !errors.length) return <span className="muted">Connecting…</span>;
  if (down.length) return <span className="tone-bad font-medium">{down.map(d => d.name).join(', ')} {down.length === 1 ? 'is' : 'are'} down</span>;
  if (errors.length) return <span className="tone-warn font-medium">{errors.length} widget{errors.length > 1 ? 's' : ''} can't reach {errors.length > 1 ? 'their services' : 'its service'}</span>;
  return <span className="muted">All {items.length} services are up</span>;
}

async function runAction(key: string, action: string, args?: Record<string, unknown>) {
  const inst = key.split('.')[0];
  const r = await fetch(`/api/action/${inst}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
}

export function App() {
  const [page, setPage] = useState<Page | null>(null);
  const { state, online } = useLive();
  const now = useClock();
  const [ask, setAsk] = useState<{ text: string; n: number } | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => { fetch('/api/page').then(r => r.json()).then(setPage); }, []);
  useEffect(() => { if (page) document.title = page.title; }, [page]);

  const suggestions = useMemo(() => ['Is anything down?', 'How are my downloads doing?', 'How is the server doing?'], []);
  const submit = (text: string) => { if (!text.trim()) return; setAsk({ text: text.trim(), n: Date.now() }); setDraft(''); };

  return (
    <>
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className={`mx-auto max-w-[1240px] px-4 sm:px-8 pt-10 sm:pt-16 pb-16 transition-[padding] ${ask ? 'lg:pr-[452px]' : ''}`}>
        <header className="mb-8 sm:mb-10 fade-in">
          <div className="text-[14px] muted flex items-center gap-2">
            <span>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
            <span className="faint">·</span>
            <span className="num">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
            {!online && <span className="ml-2 tone-warn">reconnecting…</span>}
          </div>
          <h1 className="text-[34px] sm:text-[44px] leading-[1.05] font-semibold tracking-[-0.02em] mt-2">
            {greet(now.getHours())}{page?.greeting ? `, ${page.greeting}` : ''}
          </h1>
          <p className="text-[17px] mt-2"><Pulse state={state} /></p>

          {page?.assistant && (
            <form className="ask mt-6 flex items-center gap-2 pl-4 pr-2 py-2 max-w-[720px]" onSubmit={e => { e.preventDefault(); submit(draft); }}>
              <Icon name="sparkle" className="tone-accent shrink-0" size={18} />
              <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={`Ask ${page.assistant.name} about your homelab…`}
                aria-label="Ask the assistant" className="flex-1 bg-transparent outline-none py-2 text-[16px] min-w-0 placeholder:text-[var(--faint)]" />
              <button type="submit" aria-label="Ask" className="w-9 h-9 grid place-items-center rounded-xl bg-[var(--ink)] text-[var(--base)] disabled:opacity-30" disabled={!draft.trim()}>
                <Icon name="send" />
              </button>
            </form>
          )}
          {page?.assistant && (
            <div className="flex flex-wrap gap-2 mt-3">
              {suggestions.map(s => <button key={s} className="chip" onClick={() => submit(s)}>{s}</button>)}
            </div>
          )}
        </header>

        {page?.sections.map((sec, i) => (
          <section key={i} className="mb-8">
            {sec.title && <h2 className="text-[15px] font-semibold muted mb-3 px-1">{sec.title}</h2>}
            <div className="grid gap-4" style={{ gridTemplateColumns: sec.columns ? `repeat(${sec.columns}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
              {sec.widgets.map(key => {
                const s = state[key];
                return (
                  <Frame key={key} card={s?.card} title={page.widgets[key]?.title}
                    status={s?.error ? <span className="text-[12.5px] tone-warn truncate" title={s.error}>{s.card ? 'stale' : s.error}</span> : null}
                    run={(action, args) => runAction(key, action, args)} />
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {ask && page?.assistant && (
        <Suspense fallback={null}>
          <Assistant name={page.assistant.name} model={page.assistant.model} ask={ask} onClose={() => setAsk(null)} />
        </Suspense>
      )}
    </>
  );
}
