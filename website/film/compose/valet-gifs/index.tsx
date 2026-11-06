import { Stage, type Act } from '../../kit'
import { Clip, fit, full, type Key, type Rect, type Src, type View } from '../valet-film/cam'

// The README's GIFs. Each is the page at its full desktop width (rec/gifs.mjs, 1600x900 at 1.5x), with a camera that
// starts wide, glides in on what matters and back out. Pick one with ?gif=chat (live, home3d, chat, card, recap, rule).

const clips = import.meta.glob<string>('./assets/clips/*.mp4', { eager: true, query: '?url', import: 'default' })
type Mark = { name: string; t: number; [k: string]: unknown }
type Log = { W: number; H: number; frames: number; marks: Mark[] }
const logs = import.meta.glob<Log>('./assets/clips/*.json', { eager: true, import: 'default' })
const GIF = new URLSearchParams(location.search).get('gif') ?? 'chat'
const log = logs[`./assets/clips/${GIF}.json`]!
const url = clips[`./assets/clips/${GIF}.mp4`]!
const at = (m: string) => log.marks.find(x => x.name === m)!
const t = (m: string) => at(m).t
const r = (m: string, k: string) => at(m)[k] as Rect

const PLATE = { w: 1440, h: 810 }
const SRC: Src = { W: 1600, H: 900 }
const FULL = full(SRC)
const F = (rect: Rect, zmax = 1.8): View => fit(rect, SRC, PLATE, { x: 24, y: 24, w: PLATE.w - 48, h: PLATE.h - 48 }, zmax)
const K = (at: number, v: View, d = 1.1): Key => ({ t: at, v, d })
// the newest message in the chat: the sheet's width, from just above the card to the words under it
const latest = (m: string, below = 150): Rect => { const s = r(m, 'sheet'), c = r(m, 'card'); return [s[0], c[1] - 36, s[2], Math.min(c[3] + 36 + below, s[1] + s[3] - c[1] + 36)] }
const ask = () => { const a = r('top', 'ask'); return [a[0] - 20, a[1] - 20, a[2] + 40, a[3] + 90] as Rect }

const cams: Record<string, () => Key[]> = {
  live: () => [K(t('r1') - 1.4, F([690, 8, 905, 300], 1.8), 1.1), K(t('r5') - .6, FULL, 1.3)],
  home3d: () => [K(t('card') + .1, F(r('card', 'card'), 1.6), 1.2), K(t('drive') + 2.6, FULL, 1.6)],
  chat: () => [
    K(.9, F(ask(), 1.6), 1), K(t('sheet') - .5, F(r('sheet', 'sheet'), 2), 1),
    K(t('watching') - .1, F(latest('watching')), 1), K(t('popular') - .1, F(latest('popular')), 1),
    K(t('approval') - .1, F(latest('approval', 40)), 1), K(t('paused') - .1, F(latest('paused')), 1),
    K(t('closed') - .2, FULL, 1.1)],
  card: () => [
    K(.9, F(ask(), 1.6), 1), K(t('sheet') - .5, F(r('sheet', 'sheet'), 2), 1),
    K(t('ask') - .1, F(latest('ask', 40)), 1), K(t('done') - .4, F(r('done', 'sheet'), 2), 1),
    K(t('closed') - .3, FULL, 1), K(t('page') + .1, F(r('page', 'speed'), 1.5), 1.1), K(t('page') + 2.4, FULL, 1.2)],
  recap: () => [],   // the story is full screen: a close-up would cut its words at the edge
  rule: () => [
    K(.9, F(ask(), 1.6), 1), K(t('sheet') - .5, F(r('sheet', 'sheet'), 2), 1),
    K(t('approval') - .1, F(latest('approval', 40)), 1), K(t('confirmed') - .2, F(r('confirmed', 'sheet'), 2), 1),
    K(t('confirmed') + 1.6, FULL, 1), K(t('media') + .1, F(r('media', 'dl'), 1.5), 1.1),
    K(t('fired') - .1, F((([x, y, w, h]) => [x - 330, y - 300, w + 660, h + 320] as Rect)(r('fired', 'toast')), 1.8), 1), K(t('end'), FULL, 1.2)],
}

// where a GIF starts and ends in its clip, when it's tighter than the whole recording
const trims: Record<string, () => [number, number]> = {
  recap: () => [.4, t('uptime') + 2.2],
  live: () => [0, t('r5') + 1.6],   // the network's card opens late under headless Chrome's hit-testing: end on the CPU
}
const [FROM, TO] = trims[GIF]?.() ?? [0, log.frames / 60]

type S = { on: boolean }
async function script(a: Act<S>) {
  a.mark('play'); a.set({ on: true })
  await a.wait(Math.round((TO - FROM) * 1000))
  a.mark('done')
  await a.wait(60000)
}

export default function ValetGifs() {
  return (
    <Stage width={PLATE.w} height={PLATE.h} theme="dark" fidelity="realistic" play="once" initial={{ on: false }} script={script}>
      {(s: S) => (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#08090b' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Clip src={SRC} url={url} on={s.on} from={FROM} keys={cams[GIF]!()} plate={PLATE} />
          </div>
        </div>
      )}
    </Stage>
  )
}
