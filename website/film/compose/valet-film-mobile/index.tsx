import { ArrowUp } from 'lucide-react'
import { Stage } from '../../kit'
import { union, type Rect, type Src } from '../valet-film/cam'
import { at, cardFiles, cardMeta, FAST, FROM, iconFiles, icons, initial, PICK, r, script, TAG, url, YAML, type S } from '../valet-film/index'
import { camera, TallClip, type PKey } from './cam'
import './mobile.css'

// Valet's film for small screens, 4:5. The same story, beats and footage as the desktop film (the desktop page,
// recorded at 1600x900, 2x), framed for a tall screen: wide, the whole page sits at full width under the caption;
// close, the band opens to the bottom of the frame and one part of the page fills it.

const SRC: Src = { W: 1600, H: 900 }
const WIDE = { x: 0, y: 526, w: 1080, h: 607.5 }, CLOSE = { x: 0, y: 300, w: 1080, h: 1050 }
const cam = camera(SRC, WIDE, CLOSE)
const P = (t: number, rect: Rect | null, d = 1.1, zmax = 1.6): PKey => ({ t, r: rect, d, zmax })

const BOX = { w: 900, h: 700 }, GAP = 70
const REEL = (() => {
  let x = 0
  return PICK.map(f => cardMeta.find(c => c.file === f)!).filter(Boolean).map(c => {
    const s = Math.min(BOX.w / c.w, BOX.h / c.h), w = Math.round(c.w * s), h = Math.round(c.h * s)
    const item = { ...c, w, h, at: x + w / 2 }
    x += w + GAP
    return item
  })
})()

const tt = (n: string, m: string) => at(n, m).t
const keys: Record<string, () => PKey[]> = {
  // the first seconds are the whole page; then, still before anything scrolls, a slow glide in to the greeting and services
  overview: () => [
    P(2.9, [96, 24, 1000, 400], 1.8),
    P(tt('overview', 'three') - .1, union(r('overview', 'three', 'ha'), r('overview', 'three', 'pc')), .9),
    P(tt('overview', 'dns') - .1, r('overview', 'dns', 'dns'), .9),
    P(tt('overview', 'now') - .1, union(r('overview', 'now', 'now'), r('overview', 'now', 'photos')), .9),
    P(tt('overview', 'carousels') + .05, r('overview', 'carousels', 'recent'), 1.1)],
  kbar: () => [P(tt('kbar', 'open') - .3, union(...['open', 'svc', 'answer', 'docs'].map(m => r('kbar', m, 'pal'))), 1), P(tt('kbar', 'closed'), null, 1.1)],
  services: () => [P(.5, union(r('services', 'top', 'Updates'), r('services', 'top', 'Pi-hole')), 2.4)],
  home: () => [P(.4, union(r('home', 'top', 'Cameras'), r('home', 'top', 'Hallway')), 2.4)],
  media: () => [P(.4, r('media', 'top', 'Now playing'), 2.4)],
  library: () => [P(.4, r('library', 'top', 'Hacker News'), 2.4)],
  chat: () => [P(tt('chat', 'sheet') + .1, r('chat', 'sheet', 'sheet'), 1),
    ...['watching', 'popular', 'approval', 'paused'].map(m => P(tt('chat', m) - .1, r('chat', m, 'card'), 1))],
  self: () => [P(tt('self', 'ask') - .1, r('self', 'ask', 'card'), 1), P(tt('self', 'done') - .05, null, 1), P(tt('self', 'page') + .3, r('self', 'page', 'speed'), 1.2, 1.4)],
}

function Title({ on, big, sub, keys: k }: { on: boolean; big: string; sub?: string; keys?: string[] }) {
  return <div className="mf-title" data-on={on || undefined}><h2>{k && <span className="mf-keys">{k.map(x => <kbd key={x}>{x}</kbd>)}</span>}{big}</h2>{sub && <p>{sub}</p>}</div>
}

export default function ValetFilmMobile() {
  return (
    <Stage width={1080} height={1350} theme="dark" fidelity="realistic" play="once" initial={initial} script={script} className="mf">
      {(s: S) => (
        <div className="mf-film" data-scene={s.scene}>
          <div className="mf-wall" />
          <section className="mf-open" data-on={s.scene === 'open' || undefined}>
            <div className="mf-box"><span>{TAG.slice(0, s.words)}<i /></span><b data-ready={s.words === TAG.length || undefined}><ArrowUp size={30} strokeWidth={2.2} /></b></div>
          </section>

          {(['overview', 'kbar', 'services', 'home', 'media', 'library', 'chat', 'self'] as const).map(n => (
            <div key={n} className="mf-plate" data-on={s.scene === n || undefined}>
              <TallClip src={SRC} url={url(n)} on={s.scene === n} keys={keys[n]!()} map={FAST[n]?.map} from={FROM[n] ?? 0} cam={cam} />
            </div>
          ))}

          <Title on={s.scene === 'overview'} big="A homepage worth opening." sub="Your services, the house, the week and what's playing." />
          <Title on={s.scene === 'kbar'} keys={['⌘', 'K']} big="finds anything." sub="Open a service, ask, or search the docs." />
          <Title on={['services', 'home', 'media', 'library'].includes(s.scene)} big="No more switching." sub="Services, Home, Media and Library, each a tab." />
          <Title on={s.scene === 'chat' && !s.ok} big="Just ask." sub="Run it on fully local AI. Nothing leaves home." />
          <Title on={s.scene === 'chat' && s.ok} big="Nothing changes without your OK." sub="Pausing Pi-hole waits for you." />
          <Title on={s.scene === 'self'} big="Self-improving." sub="Ask for a card. Valet edits its own config." />

          <Title on={s.scene === 'cards'} big="185 integrations." />
          <div className="mf-reel" data-on={s.scene === 'cards' || undefined}>
            <div className="mf-track" style={{ translate: `${540 - (REEL[s.reel]?.at ?? 0)}px 0` }}>
              {REEL.map((c, i) => (
                <figure key={c.file} data-now={i === s.reel || undefined} style={{ left: c.at - c.w / 2, width: c.w }}>
                  <div className="mf-slot"><img src={cardFiles[`./assets/cards/${c.file}.jpg`]} width={c.w} height={c.h} alt="" /></div>
                  <figcaption><img src={iconFiles[`./assets/icons/${c.icon}.png`]} alt="" />{c.name}</figcaption>
                </figure>
              ))}
            </div>
          </div>

          <Title on={s.scene === 'yours'} big="All in one YAML file." />
          <div className="mf-yours" data-on={s.scene === 'yours' || undefined}>
            <pre className="mf-code">{YAML.map((l, i) => <div key={l} data-on={i < s.yaml || undefined}>{l || ' '}</div>)}</pre>
            <div className="mf-wallicons">
              {icons.slice(0, 28).map((u, i) => <span key={u} style={{ '--i': i } as React.CSSProperties}><img src={u} alt="" /></span>)}
            </div>
          </div>

          <section className="mf-end" data-on={s.scene === 'end' || undefined}>
            <svg width="140" height="140" viewBox="0 0 32 32" aria-hidden><path d="M9 22V13l7-5 7 5v9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" /></svg>
            <h1>Talk to your<br />homelab.</h1>
            <p>A self-hosted, open-source,<br />AI-native homepage.</p>
            <strong>askvalet.dev</strong>
          </section>
        </div>
      )}
    </Stage>
  )
}
