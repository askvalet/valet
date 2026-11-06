import { ArrowUp } from 'lucide-react'
import { Stage, type Act } from '../../kit'
import { Clip, type Src } from './cam'
import './mobile.css'

// Valet's film for a phone feed, 4:5. The footage is the demo's own phone layout, recorded frame-exact at 3x
// (rec/phone.mjs). The whole phone screen is always in frame, under a short caption, so nothing is cut at an edge.

const clips = import.meta.glob<string>('./assets/clips/*.mp4', { eager: true, query: '?url', import: 'default' })
type Mark = { name: string; t: number }
type Log = { W: number; H: number; frames: number; marks: Mark[] }
const logs = import.meta.glob<Log>('./assets/clips/*.json', { eager: true, import: 'default' })
const log = (n: string) => logs[`./assets/clips/${n}.json`]!
const url = (n: string) => clips[`./assets/clips/${n}.mp4`]!
const ms = (n: string) => Math.round(log(n).frames / 60 * 1000)
const at = (n: string, m: string) => Math.round(log(n).marks.find(x => x.name === m)!.t * 1000)
const iconFiles = import.meta.glob<string>('./assets/icons/*.png', { eager: true, query: '?url', import: 'default' })
const cardFiles = import.meta.glob<string>('./assets/cards/*.jpg', { eager: true, query: '?url', import: 'default' })
const cardMeta = Object.values(import.meta.glob<{ file: string; name: string; icon: string; w: number; h: number }[]>('./assets/cards/cards.json', { eager: true, import: 'default' }))[0] ?? []

const SRC: Src = { W: 402, H: 620 }
const PLATE = { w: 726, h: 1120 }
const BOX = { w: 900, h: 700 }, GAP = 70
const PICK = ['plex', 'homeassistant', 'frigate', 'immich', 'pihole', 'qbittorrent', 'tautulli', 'romm', 'mealie', 'paperless', 'navidrome', 'hackernews']
const REEL = (() => {
  let x = 0
  return PICK.map(f => cardMeta.find(c => c.file === f)!).filter(Boolean).map(c => {
    const s = Math.min(BOX.w / c.w, BOX.h / c.h), w = Math.round(c.w * s), h = Math.round(c.h * s)
    const item = { ...c, w, h, at: x + w / 2 }
    x += w + GAP
    return item
  })
})()

type Scene = 'open' | 'main' | 'ask' | 'self' | 'cards' | 'end'
type S = { scene: Scene; typed: number; ok: boolean; reel: number }
const TAG = 'Talk to your homelab.'
const initial: S = { scene: 'open', typed: 0, ok: false, reel: 0 }

async function script(a: Act<S>) {
  await a.wait(350)
  for (let i = 1; i <= TAG.length; i++) { a.set({ typed: i }); await a.wait(42) }
  await a.wait(900)
  a.mark('main'); a.set({ scene: 'main' }); await a.wait(ms('main'))
  a.mark('ask'); a.set({ scene: 'ask' }); await a.wait(at('ask', 'approval') - 300); a.set({ ok: true }); await a.wait(ms('ask') - at('ask', 'approval') + 300)
  a.mark('self'); a.set({ scene: 'self' }); await a.wait(ms('self'))
  a.mark('cards'); a.set({ scene: 'cards' }); await a.wait(700)
  for (let i = 1; i < REEL.length; i++) { a.set({ reel: i }); await a.wait(Math.max(260, 470 - i * 22)) }
  await a.wait(600)
  a.mark('end'); a.set({ scene: 'end' }); await a.wait(3800)
  a.mark('done')
  await a.wait(60000)
}

function Title({ on, big, sub }: { on: boolean; big: string; sub?: string }) {
  return <div className="mf-title" data-on={on || undefined}><h2>{big}</h2>{sub && <p>{sub}</p>}</div>
}

export default function ValetFilmMobile() {
  return (
    <Stage width={1080} height={1350} theme="dark" fidelity="realistic" play="once" initial={initial} script={script} className="mf">
      {(s: S) => (
        <div className="mf-film" data-scene={s.scene}>
          <div className="mf-wall" />
          <section className="mf-open" data-on={s.scene === 'open' || undefined}>
            <div className="mf-box"><span>{TAG.slice(0, s.typed)}<i /></span><b data-ready={s.typed === TAG.length || undefined}><ArrowUp size={30} strokeWidth={2.2} /></b></div>
          </section>

          <Title on={s.scene === 'main'} big="A homepage worth opening." sub="Your services, the house and the week, on one page." />
          <Title on={s.scene === 'ask' && !s.ok} big="Just ask." sub="Run it on fully local AI, and nothing leaves your home." />
          <Title on={s.scene === 'ask' && s.ok} big="Nothing changes without your OK." sub="Pausing Pi-hole waits for you." />
          <Title on={s.scene === 'self'} big="Self-improving." sub="Ask for a card. Valet edits its own config, with your OK." />
          {(['main', 'ask', 'self'] as const).map(n => (
            <div key={n} className="mf-phone" data-on={s.scene === n || undefined}>
              <Clip src={SRC} url={url(n)} on={s.scene === n} plate={PLATE} />
            </div>
          ))}

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
