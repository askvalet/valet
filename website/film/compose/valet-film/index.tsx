import { ArrowUp } from 'lucide-react'
import { Stage, type Act } from '../../kit'
import { Clip, fast, fit, full, union, type Key, type Rect, type Src, type View } from './cam'
import './film.css'

// Valet's film, desktop. Every picture of the product is a frame-exact recording of the demo at 2x (rec/desktop.mjs);
// the camera only ever frames whole cards, and the words sit in a small glass caption over the footage.

const clips = import.meta.glob<string>('./assets/clips/*.mp4', { eager: true, query: '?url', import: 'default' })
type Mark = { name: string; t: number; [k: string]: unknown }
type Log = { W: number; H: number; frames: number; marks: Mark[] }
const logs = import.meta.glob<Log>('./assets/clips/*.json', { eager: true, import: 'default' })
const log = (n: string) => logs[`./assets/clips/${n}.json`]!
const url = (n: string) => clips[`./assets/clips/${n}.mp4`]!
const secs = (n: string) => log(n).frames / 60
const at = (n: string, m: string) => log(n).marks.find(x => x.name === m)!
const r = (n: string, m: string, k: string) => at(n, m)[k] as Rect
const iconFiles = import.meta.glob<string>('./assets/icons/*.png', { eager: true, query: '?url', import: 'default' })
const icons = Object.values(iconFiles)
const cardFiles = import.meta.glob<string>('./assets/cards/*.jpg', { eager: true, query: '?url', import: 'default' })
const cardMeta = Object.values(import.meta.glob<{ file: string; name: string; icon: string; w: number; h: number }[]>('./assets/cards/cards.json', { eager: true, import: 'default' }))[0] ?? []

const PLATE = { w: 1920, h: 1080 }
const SRC: Src = { W: 1600, H: 900 }
const FULL = full(SRC)
// where a framed card may sit: clear of the caption in the bottom-left corner
const SAFE = { x: 80, y: 60, w: 1760, h: 1080 - 60 - 196 }
const F = (rect: Rect, zmax = 1.5) => fit(rect, SRC, PLATE, SAFE, zmax)
const K = (t: number, v: View, d = 1.2): Key => ({ t, v, d })

// the reel: each card at its own shape inside a 1180x600 box, side by side
const BOX = { w: 1180, h: 600 }, GAP = 90
const PICK = ['plex', 'homeassistant', 'frigate', 'immich', 'pihole', 'tautulli', 'romm', 'mealie', 'paperless', 'hackernews']
const REEL = (() => {
  let x = 0
  return PICK.map(f => cardMeta.find(c => c.file === f)!).filter(Boolean).map(c => {
    const s = Math.min(BOX.w / c.w, BOX.h / c.h), w = Math.round(c.w * s), h = Math.round(c.h * s)
    const item = { ...c, w, h, at: x + w / 2 }
    x += w + GAP
    return item
  })
})()

type Scene = 'open' | 'overview' | 'kbar' | 'services' | 'home' | 'media' | 'library' | 'chat' | 'self' | 'cards' | 'yours' | 'end'
type S = { scene: Scene; words: number; ok: boolean; cap: boolean; yaml: number; reel: number }
const TAG = 'Talk to your homelab.'
const YAML = ['integrations:', '  docs:', '    type: paperless', '    url: http://paperless:8000', '  dns:', '    type: pihole', '    url: http://pihole']
const initial: S = { scene: 'open', words: 0, ok: false, cap: false, yaml: 0, reel: 0 }
// typing and waiting for answers play at 2x; every hold is real time
const t = (n: string, m: string) => at(n, m).t
// each stretch ends before the camera's next move, so no glide ever runs at 2x
const FAST: Record<string, ReturnType<typeof fast>> = {
  chat: fast([[.9, t('chat', 'watching') - .25], [t('chat', 'watching') + 1.75, t('chat', 'popular') - .95],
    [t('chat', 'popular') + 1.95, t('chat', 'approval') - .35], [t('chat', 'approval') + 2.35, t('chat', 'paused') - 1]]),
  self: fast([[.5, t('self', 'ask') - .25], [t('self', 'ask') + 2.35, t('self', 'done') - .2]]),
}
const FROM: Record<string, number> = { overview: .5 }
const ms = (n: string) => Math.round((secs(n) - (FAST[n]?.saved ?? 0) - (FROM[n] ?? 0)) * 1000)
const sceneAt = (n: string, clipSec: number) => { let lo = 0, hi = secs(n); const f = FAST[n]?.map ?? (e => e + (FROM[n] ?? 0)); for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) < clipSec) lo = mid; else hi = mid } return Math.round(lo * 1000) }

async function script(a: Act<S>) {
  await a.wait(600)
  for (let i = 1; i <= TAG.length; i++) { a.set({ words: i }); await a.wait(52) }
  await a.wait(1100)
  // each caption is up for the first seconds of its beat, then gets out of the way of the footage
  const beat = async (n: Scene, capMs: number) => { a.mark(n); a.set({ scene: n, cap: true }); const d = ms(n); await a.wait(Math.min(capMs, d)); a.set({ cap: false }); if (d > capMs) await a.wait(d - capMs) }
  await beat('overview', 4200); await beat('kbar', ms('kbar')); await beat('services', 3700)
  for (const n of ['home', 'media', 'library'] as const) await beat(n, 0)
  const ok = sceneAt('chat', t('chat', 'approval'))
  a.mark('chat'); a.set({ scene: 'chat', cap: true }); await a.wait(3400); a.set({ cap: false }); await a.wait(ok - 3400 - 300)
  a.set({ ok: true, cap: true }); await a.wait(3400); a.set({ cap: false }); await a.wait(ms('chat') - ok + 300 - 3400)
  await beat('self', 4200)
  a.mark('cards'); a.set({ scene: 'cards' }); await a.wait(900)
  for (let i = 1; i < REEL.length; i++) { a.set({ reel: i }); await a.wait(Math.max(360, 560 - i * 24)) }
  await a.wait(700)
  a.mark('yours'); a.set({ scene: 'yours' }); await a.wait(700)
  for (let i = 1; i <= YAML.length; i++) { a.set({ yaml: i }); await a.wait(300) }
  await a.wait(1100)
  a.mark('end'); a.set({ scene: 'end' }); await a.wait(4400)
  a.mark('done')
  await a.wait(60000)
}

// the camera for each clip, from the rectangles measured while recording: wide while the page scrolls, close on a
// whole card (or a row of them) when it holds
const cam: Record<string, () => Key[]> = {
  overview: () => [K(at('overview', 'carousels').t + .05, F(union(r('overview', 'carousels', 'reading'), r('overview', 'carousels', 'recent'))), 1.3)],
  kbar: () => [K(at('kbar', 'open').t - .25, F(r('kbar', 'open', 'pal'), 1.5), 1), K(at('kbar', 'closed').t, FULL, 1.1)],
  services: () => [],
  home: () => [],   // a close-up here would cut the weather and who's home at the frame's edge
  media: () => [K(at('media', 'low').t + .05, F(union(r('media', 'low', 'Games'), r('media', 'low', 'Most played'))), 1.2)],
  library: () => [],   // the books and the collage are taller than a clean zoom allows
  chat: () => [
    K(at('chat', 'watching').t - .1, F(r('chat', 'watching', 'card')), 1),
    K(at('chat', 'popular').t - .1, F(r('chat', 'popular', 'card')), 1),
    K(at('chat', 'approval').t - .1, F(r('chat', 'approval', 'card'), 1.6), 1),
    K(at('chat', 'paused').t - .1, F(r('chat', 'paused', 'card')), 1)],
  self: () => [K(at('self', 'ask').t - .1, F(r('self', 'ask', 'card'), 1.6), 1), K(at('self', 'done').t - .05, FULL, 1), K(at('self', 'page').t + .3, F(r('self', 'page', 'speed'), 1.4), 1.2)],
}

function Cap({ on, big, sub, keys }: { on: boolean; big: string; sub?: string; keys?: string[] }) {
  return <div className="vf-cap" data-on={on || undefined}>
    <h2>{keys && <span className="vf-keys">{keys.map(k => <kbd key={k}>{k}</kbd>)}</span>}{big}</h2>{sub && <p>{sub}</p>}
  </div>
}
function Title({ on, big }: { on: boolean; big: string }) {
  return <div className="vf-title" data-on={on || undefined}><h2>{big}</h2></div>
}

export default function ValetFilm() {
  return (
    <Stage width={1920} height={1080} theme="dark" fidelity="realistic" play="once" initial={initial} script={script} className="vf">
      {(s: S) => (
        <div className="vf-film" data-scene={s.scene}>
          <div className="vf-wall" />

          <section className="vf-open" data-on={s.scene === 'open' || undefined}>
            <div className="vf-box"><span>{TAG.slice(0, s.words)}<i /></span><b data-ready={s.words === TAG.length || undefined}><ArrowUp size={26} strokeWidth={2.2} /></b></div>
          </section>

          {(['overview', 'kbar', 'services', 'home', 'media', 'library', 'chat', 'self'] as const).map(n => (
            <div key={n} className="vf-plate" data-on={s.scene === n || undefined}>
              <Clip src={SRC} url={url(n)} on={s.scene === n} keys={cam[n]!()} plate={PLATE} map={FAST[n]?.map} from={FROM[n] ?? 0} />
            </div>
          ))}

          <Cap on={s.scene === 'overview' && s.cap} big="A homepage worth opening." sub="Your services, the house, the week and what's playing, on one page." />
          <Cap on={s.scene === 'kbar' && s.cap} keys={['⌘', 'K']} big="finds anything." sub="Even the look: liquid glass, on this device." />
          <Cap on={s.scene === 'services' && s.cap} big="No more switching between services." sub="Services, Home, Media and Library, each a tab." />
          <Cap on={s.scene === 'chat' && !s.ok && s.cap} big="Just ask." sub="Run it on fully local AI, and nothing leaves your home." />
          <Cap on={s.scene === 'chat' && s.ok && s.cap} big="Nothing changes without your OK." sub="Pausing Pi-hole waits for you." />
          <Cap on={s.scene === 'self' && s.cap} big="Self-improving." sub="Ask for a card. Valet edits its own config, with your OK." />

          <Title on={s.scene === 'cards'} big="185 integrations." />
          <div className="vf-reel" data-on={s.scene === 'cards' || undefined}>
            <div className="vf-track" style={{ translate: `${960 - (REEL[s.reel]?.at ?? 0)}px 0` }}>
              {REEL.map((c, i) => (
                <figure key={c.file} data-now={i === s.reel || undefined} style={{ left: c.at - c.w / 2, width: c.w }}>
                  <div className="vf-slot"><img src={cardFiles[`./assets/cards/${c.file}.jpg`]} width={c.w} height={c.h} alt="" /></div>
                  <figcaption><img src={iconFiles[`./assets/icons/${c.icon}.png`]} alt="" />{c.name}</figcaption>
                </figure>
              ))}
            </div>
          </div>

          <Title on={s.scene === 'yours'} big="All in one YAML file." />
          <div className="vf-yours" data-on={s.scene === 'yours' || undefined}>
            <pre className="vf-code">{YAML.map((l, i) => <div key={l} data-on={i < s.yaml || undefined}>{l || ' '}</div>)}</pre>
            <div className="vf-wallicons">
              {icons.slice(0, 35).map((u, i) => <span key={u} style={{ '--i': i } as React.CSSProperties}><img src={u} alt="" /></span>)}
            </div>
          </div>

          <section className="vf-end" data-on={s.scene === 'end' || undefined}>
            <svg width="120" height="120" viewBox="0 0 32 32" aria-hidden><path d="M9 22V13l7-5 7 5v9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" /></svg>
            <h1>Talk to your homelab.</h1>
            <p>A self-hosted, open-source, AI-native homepage.</p>
            <strong>askvalet.dev</strong>
          </section>
        </div>
      )}
    </Stage>
  )
}
