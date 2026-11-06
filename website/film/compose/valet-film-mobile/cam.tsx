import { useEffect, useRef } from 'react'
import { clock } from '../../kit/clock'
import type { Rect, Src } from '../valet-film/cam'

// A camera for a tall frame over the desktop footage. Wide, the whole page shows at full width in a band under the
// caption; a close-up opens the band to the bottom of the frame and fills it with one part of the page. The band and
// the zoom glide together on one eased curve, and the view never leaves the footage.

export type Win = { x: number; y: number; w: number; h: number }
/** `r` null is the whole page. */
export type PKey = { t: number; r: Rect | null; d?: number; zmax?: number }
type Cam = { win: Win; s: number; cx: number; cy: number }

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export function camera(src: Src, wide: Win, close: Win) {
  const whole: Cam = { win: wide, s: wide.w / src.W, cx: src.W / 2, cy: src.H / 2 }
  const shot = (k: PKey): Cam => {
    if (!k.r) return whole
    const [x, y, w, h] = k.r, win = close
    // as close as fits (with a margin), but never so far out that the footage stops filling the band's width
    const s = Math.max(win.w / src.W, Math.min(k.zmax ?? 1.6, (win.w - 56) / w, (win.h - 56) / h))
    const hw = win.w / s / 2, hh = win.h / s / 2
    const cx = hw * 2 >= src.W ? src.W / 2 : Math.max(hw, Math.min(src.W - hw, x + w / 2))
    const cy = hh * 2 >= src.H ? src.H / 2 : Math.max(hh, Math.min(src.H - hh, y + h / 2))
    return { win, s, cx, cy }
  }
  const mix = (a: Cam, b: Cam, e: number): Cam => {
    const l = (p: number, q: number) => p + (q - p) * e
    return { win: { x: l(a.win.x, b.win.x), y: l(a.win.y, b.win.y), w: l(a.win.w, b.win.w), h: l(a.win.h, b.win.h) }, s: Math.exp(l(Math.log(a.s), Math.log(b.s))), cx: l(a.cx, b.cx), cy: l(a.cy, b.cy) }
  }
  return (keys: PKey[], sec: number): Cam => {
    let v = whole
    for (const k of keys) {
      if (sec < k.t) break
      v = mix(v, shot(k), ease(Math.min(1, (sec - k.t) / (k.d ?? 1.2))))
    }
    return v
  }
}

/** A clip played from `from` (or through `map`), in a band that the camera moves and sizes. */
export function TallClip({ src, url, on, from = 0, keys = [], map, cam }: { src: Src; url: string; on: boolean; from?: number; keys?: PKey[]; map?: (e: number) => number; cam: ReturnType<typeof camera> }) {
  const box = useRef<HTMLDivElement>(null), ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current!, b = box.current!
    if (!on) return
    const t0 = clock.now()
    let id = 0
    const tick = () => {
      const e = (clock.now() - t0) / 1000
      const t = map ? map(e) : from + e
      v.currentTime = t + 1 / 120
      const c = cam(keys, t)
      b.style.cssText = `left:${c.win.x}px;top:${c.win.y}px;width:${c.win.w}px;height:${c.win.h}px`
      v.style.transform = `translate(${c.win.w / 2 - c.cx * c.s}px, ${c.win.h / 2 - c.cy * c.s}px) scale(${c.s})`
      id = clock.raf(tick)
    }
    tick()
    return () => clock.cancelRaf(id)
  }, [on])
  return <div ref={box} className="mf-band"><video ref={ref} src={url} muted playsInline preload="auto" style={{ width: src.W, height: src.H, transformOrigin: '0 0' }} /></div>
}
