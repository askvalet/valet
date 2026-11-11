import { ArrowUp, ChevronLeft } from 'lucide-react'
import { Stage, type Act } from '../../kit'
import { Clip, fast, fit, full, union, type Key, type Rect, type Src, type View } from './cam'
import './film.css'
import './tg.css'

// Valet's film, desktop. Every picture of the product is a frame-exact recording of the demo at 2x (rec/desktop.mjs);
// the camera only ever frames whole cards, and the words sit in a small glass caption over the footage.

export const clips = import.meta.glob<string>('./assets/clips/*.mp4', { eager: true, query: '?url', import: 'default' })
export type Mark = { name: string; t: number; [k: string]: unknown }
type Log = { W: number; H: number; frames: number; marks: Mark[] }
const logs = import.meta.glob<Log>('./assets/clips/*.json', { eager: true, import: 'default' })
export const log = (n: string) => logs[`./assets/clips/${n}.json`]!
export const url = (n: string) => clips[`./assets/clips/${n}.mp4`]!
export const secs = (n: string) => log(n).frames / 60
export const at = (n: string, m: string) => log(n).marks.find(x => x.name === m)!
export const r = (n: string, m: string, k: string) => at(n, m)[k] as Rect
export const iconFiles = import.meta.glob<string>('./assets/icons/*.png', { eager: true, query: '?url', import: 'default' })
export const icons = Object.values(iconFiles)
export const cardFiles = import.meta.glob<string>('./assets/cards/*.jpg', { eager: true, query: '?url', import: 'default' })
export const cardMeta = Object.values(import.meta.glob<{ file: string; name: string; icon: string; w: number; h: number }[]>('./assets/cards/cards.json', { eager: true, import: 'default' }))[0] ?? []

const PLATE = { w: 1920, h: 1080 }
const SRC: Src = { W: 1600, H: 900 }
const FULL = full(SRC)
// where a framed card may sit: clear of the caption in the bottom-left corner
const SAFE = { x: 80, y: 60, w: 1760, h: 1080 - 60 - 196 }
const F = (rect: Rect, zmax = 1.5) => fit(rect, SRC, PLATE, SAFE, zmax)
const K = (t: number, v: View, d = 1.2): Key => ({ t, v, d })

// the reel: each card at its own shape inside a 1180x600 box, side by side
const BOX = { w: 1180, h: 600 }, GAP = 90
export const PICK = ['plex', 'homeassistant', 'frigate', 'immich', 'pihole', 'tautulli', 'romm', 'mealie', 'paperless', 'hackernews']
const REEL = (() => {
  let x = 0
  return PICK.map(f => cardMeta.find(c => c.file === f)!).filter(Boolean).map(c => {
    const s = Math.min(BOX.w / c.w, BOX.h / c.h), w = Math.round(c.w * s), h = Math.round(c.h * s)
    const item = { ...c, w, h, at: x + w / 2 }
    x += w + GAP
    return item
  })
})()

export type Scene = 'open' | 'overview' | 'kbar' | 'services' | 'home' | 'media' | 'library' | 'chat' | 'phone' | 'self' | 'machines' | 'cards' | 'yours' | 'end'
// `part` is which of the chat's four captions is up; `tg` is how far the Telegram conversation has got
export type S = { scene: Scene; words: number; part: number; cap: boolean; yaml: number; reel: number; tg: number }
export const TAG = 'Talk to your homelab.'
export const YAML = ['integrations:', '  docs:', '    type: paperless', '    url: http://paperless:8000', '  dns:', '    type: pihole', '    url: http://pihole']
export const initial: S = { scene: 'open', words: 0, part: 0, cap: false, yaml: 0, reel: 0, tg: 0 }
// typing and waiting for answers play at 2x; every hold is real time
export const t = (n: string, m: string) => at(n, m).t
// each stretch ends before the camera's next move, so no glide ever runs at 2x
const T = (m: string) => t('chat', m)
/** `f` with one stretch of clip time left out: the scene goes straight from `a` to `b`. */
const cut = (f: ReturnType<typeof fast>, a: number, b: number): ReturnType<typeof fast> => {
  const when = (c: number) => { let lo = 0, hi = 600; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f.map(m) < c) lo = m; else hi = m } return lo }
  const from = when(a), gone = when(b) - from
  return { map: e => f.map(e < from ? e : e + gone), saved: f.saved + gone }
}
export const FAST: Record<string, ReturnType<typeof fast>> = {
  // typing and the waits: the question, the answer, the spoken one's answer, the command, the mention and the change
  // and one cut: from the spoken question's answer straight to the command, without the pause between them
  chat: cut(fast([[.9, T('watching') - .25], [T('heard') + .8, T('popular') - .95], [T('read') + .9, T('slash') - 1], [T('slash') + .5, T('picker') - .5], [T('switched') + 1, T('at') - .7], [T('at') + 1, T('approval') - .35], [T('approval') + 2.35, T('paused') - 1]]), T('popular') + 1.05, T('slash') - 1.15),
  self: fast([[.5, t('self', 'ask') - .25], [t('self', 'ask') + 2.35, t('self', 'done') - .2]]),
}
export const FROM: Record<string, number> = { overview: .5 }
// the overview ends once the page has scrolled down to what's playing
export const END: Record<string, number> = { overview: t('overview', 'now') + .15 }
export const ms = (n: string) => Math.round(((END[n] ?? secs(n)) - (FAST[n]?.saved ?? 0) - (FROM[n] ?? 0)) * 1000)
export const sceneAt = (n: string, clipSec: number) => { let lo = 0, hi = secs(n); const f = FAST[n]?.map ?? (e => e + (FROM[n] ?? 0)); for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) < clipSec) lo = mid; else hi = mid } return Math.round(lo * 1000) }

export async function script(a: Act<S>) {
  await a.wait(600)
  for (let i = 1; i <= TAG.length; i++) { a.set({ words: i }); await a.wait(52) }
  await a.wait(1100)
  // each caption is up for the first seconds of its beat, then gets out of the way of the footage
  const beat = async (n: Scene, capMs: number) => { a.mark(n); a.set({ scene: n, cap: true }); const d = ms(n); await a.wait(Math.min(capMs, d)); a.set({ cap: false }); if (d > capMs) await a.wait(d - capMs) }
  await beat('overview', 4200); await beat('kbar', ms('kbar')); await beat('services', 3700)
  for (const n of ['home', 'media', 'library'] as const) await beat(n, 0)
  // the chat is one take with four captions: asked, spoken, a command, and a change that waits
  const parts = ['listen', 'slash', 'at'].map(m => sceneAt('chat', T(m)) - 500), total = ms('chat')
  a.mark('chat'); a.set({ scene: 'chat', part: 0, cap: true })
  for (let i = 0, at = 0; i < 4; i++) {
    const end = parts[i] ?? total, up = Math.min(3600, end - at - 350)
    await a.wait(up); a.set({ cap: false }); await a.wait(end - at - up)
    if (i < 3) a.set({ part: i + 1, cap: true })
    at = end
  }
  // Telegram: a question, then a change that asks first, there too
  a.mark('phone'); a.set({ scene: 'phone', tg: 0 }); await a.wait(900)
  for (const [n, d] of [[1, 900], [2, 1000], [3, 1900], [4, 800], [5, 900], [6, 1500], [7, 420], [8, 800], [9, 2300]] as const) { a.set({ tg: n }); await a.wait(d) }
  await beat('self', 4200); await beat('machines', 3400)
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
  overview: () => [],
  kbar: () => {
    const pal = union(...['open', 'found', 'card'].map(m => r('kbar', m, 'pal')))
    return [K(at('kbar', 'open').t - .3, F(pal, 1.45), 1), K(at('kbar', 'closed').t, FULL, 1.1)]
  },
  // one calm look at each tab: the camera leans in once, slowly
  services: () => [K(.5, F(union(r('services', 'top', 'Updates'), r('services', 'top', 'Pi-hole'), r('services', 'top', 'CPU')), 1.3), 2.6)],
  home: () => [K(.4, F(union(r('home', 'top', 'Cameras'), r('home', 'top', 'Weather')), 1.3), 2.4)],
  media: () => [K(.4, F(union(r('media', 'top', 'Now playing'), r('media', 'top', 'Downloading')), 1.3), 2.4)],
  library: () => [K(.4, F([96, 101, 976, 460], 1.3), 2.4)],
  chat: () => {
    const c = (m: string, ...ks: string[]) => union(...ks.map(k => r('chat', m, k)))
    return [
      K(T('watching') - .1, F(c('watching', 'card')), 1),
      K(T('listen') - .95, F(c('listen', 'box'), 1.7), 1),
      K(T('popular') - .1, F(c('read', 'card', 'said', 'row')), 1),
      K(T('slash') - .9, F(union(c('slash', 'menu', 'box'), c('picker', 'menu'), c('switched', 'model')), 1.7), 1),
      K(T('approval') - .1, F(c('approval', 'card'), 1.6), 1),
      K(T('paused') - .1, F(c('paused', 'card')), 1)]
  },
  machines: () => [K(.4, F(r('machines', 'top', 'Machines'), 1.5), 2), K(3.5, F(r('machines', 'top', 'NAS'), 1.5), 1.4)],
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

// The assistant in Telegram: the same question, and the same OK before anything changes. Valet sends plain lines, and a
// change comes with two buttons; pressing one edits the message to say what was decided, as the real bot does.
const ASK = 'Turn off the living room lights?'
export function TgPhone({ n }: { n: number }) {
  const typing = n === 2 || n === 5
  return (
    <div className="tg">
      <header>
        <ChevronLeft size={34} strokeWidth={2.2} />
        <span className="tg-me"><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden><path d="M9 22V13l7-5 7 5v9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" /></svg></span>
        <div><b>Valet</b><i>{typing ? 'typing…' : 'bot'}</i></div>
      </header>
      <div className="tg-thread">
        <time>Today</time>
        <p className="tg-out" data-on={n >= 1 || undefined}>Did last night's backups run?<small>21:04</small></p>
        <p className="tg-in" data-on={n >= 3 || undefined}>Three ran fine. The offsite copy is overdue: its last good backup was 4 days ago.<small>21:04</small></p>
        <p className="tg-out" data-on={n >= 4 || undefined}>Turn off the living room lights<small>21:05</small></p>
        <div className="tg-ask" data-on={n >= 6 || undefined} data-done={n >= 8 || undefined}>
          <p className="tg-in">{ASK}<span className="tg-verdict"><br /><br />Approved</span><small>21:05</small></p>
          <div className="tg-keys"><b data-press={n === 7 || undefined}>Turn off</b><b>Not now</b></div>
        </div>
        <p className="tg-in" data-on={n >= 9 || undefined}>The living room lights are off.<small>21:05</small></p>
      </div>
    </div>
  )
}
function Telegram({ on, n }: { on: boolean; n: number }) {
  return (
    <section className="vf-phone" data-on={on || undefined}>
      <div className="vf-pitch">
        <h2>And from anywhere.</h2>
        <p>The same assistant in Telegram, with the same OK.<br />No port to open.</p>
      </div>
      <TgPhone n={n} />
    </section>
  )
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

          {(['overview', 'kbar', 'services', 'home', 'media', 'library', 'chat', 'self', 'machines'] as const).map(n => (
            <div key={n} className="vf-plate" data-on={s.scene === n || undefined}>
              <Clip src={SRC} url={url(n)} on={s.scene === n} keys={cam[n]!()} plate={PLATE} map={FAST[n]?.map} from={FROM[n] ?? 0} />
            </div>
          ))}

          <Cap on={s.scene === 'overview' && s.cap} big="A homepage worth opening." sub="Your services, the house, the week and what's playing, on one page." />
          <Cap on={s.scene === 'kbar' && s.cap} keys={['⌘', 'K']} big="searches inside your services." sub="Films, books, documents, photos. As you type, with no AI." />
          <Cap on={s.scene === 'services' && s.cap} big="No more switching between services." sub="Services, Home, Media and Library, each a tab." />
          <Cap on={s.scene === 'chat' && s.part === 0 && s.cap} big="Just ask." sub="Run it on fully local AI, and nothing leaves your home." />
          <Cap on={s.scene === 'chat' && s.part === 1 && s.cap} big="Out loud, if you like." sub="Talk to it, and hear it answer." />
          <Cap on={s.scene === 'chat' && s.part === 2 && s.cap} big="Any model, switched mid-chat." sub="Type / for commands." />
          <Cap on={s.scene === 'chat' && s.part === 3 && s.cap} big="Nothing changes without your OK." sub="Pausing Pi-hole waits for you." />
          <Cap on={s.scene === 'self' && s.cap} big="Self-improving." sub="Ask for a card. Valet edits its own config, with your OK." />
          <Cap on={s.scene === 'machines' && s.cap} big="Several machines, one Valet." sub="Every server, NAS and Pi, side by side." />

          <Telegram on={s.scene === 'phone'} n={s.tg} />

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
