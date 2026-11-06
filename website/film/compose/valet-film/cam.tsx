import { useEffect, useRef } from 'react'
import { clock } from '../../kit/clock'

// A camera over recorded footage. Footage is a frame-exact recording of the demo at 2x; a View is the part of the
// recorded viewport (CSS px) that fills the plate. Keys move the camera with an eased glide, so a zoom always lands
// on a whole card with even margins: fit() works out the view from the card's own measured rectangle.

export type Rect = [number, number, number, number]
export type View = { x: number; y: number; w: number }
export type Key = { t: number; v: View; d?: number }
export type Src = { W: number; H: number }
export type Region = { x: number; y: number; w: number; h: number }

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
export const full = (s: Src): View => ({ x: 0, y: 0, w: s.W })

export function union(...rs: (Rect | null | undefined)[]): Rect {
  const ok = rs.filter(Boolean) as Rect[]
  const x = Math.min(...ok.map(r => r[0])), y = Math.min(...ok.map(r => r[1]))
  return [x, y, Math.max(...ok.map(r => r[0] + r[2])) - x, Math.max(...ok.map(r => r[1] + r[3])) - y]
}

/** The view that shows `r` whole inside `region` (plate px), as close as `zmax` allows, kept inside the footage. */
export function fit(r: Rect, src: Src, plate: { w: number; h: number }, region: Region, zmax = 1.6): View {
  const k = plate.w / src.W
  const z = Math.max(1, Math.min(zmax, region.w / (r[2] * k), region.h / (r[3] * k)))
  const s = k * z, w = src.W / z, h = w * plate.h / plate.w
  const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2
  let x = cx - (region.x + region.w / 2) / s, y = cy - (region.y + region.h / 2) / s
  x = Math.max(0, Math.min(src.W - w, x)); y = Math.max(0, Math.min(src.H - h, y))
  return { x, y, w }
}

function lerp(a: View, b: View, e: number, src: Src): View {
  const R = src.H / src.W
  // zoom moves evenly in scale; the centre glides on a straight line; the view never leaves the footage
  const w = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * e)
  const cx = a.x + a.w / 2 + (b.x + b.w / 2 - a.x - a.w / 2) * e, cy = a.y + a.w * R / 2 + (b.y + b.w * R / 2 - a.y - a.w * R / 2) * e
  return { x: Math.max(0, Math.min(src.W - w, cx - w / 2)), y: Math.max(0, Math.min(src.H - w * R, cy - w * R / 2)), w }
}

export function camAt(keys: Key[], sec: number, start: View, src: Src): View {
  let v = start
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    if (sec < k.t) break
    const from = camAt(keys.slice(0, i), k.t, start, src)
    v = lerp(from, k.v, ease(Math.min(1, (sec - k.t) / (k.d ?? 1.2))), src)
  }
  return v
}

/**
 * Scene time to clip time, with the given clip-time stretches played at exactly 2x (typing, waiting for an answer).
 * Whole-number rates keep every output frame one or two source frames apart, so motion stays even.
 */
export function fast(segs: [number, number][]) {
  const map = (e: number) => {
    let t = 0, left = e
    for (const [a, b] of segs) {
      if (left <= a - t) return t + left
      left -= a - t; t = a
      if (left <= (b - a) / 2) return t + left * 2
      left -= (b - a) / 2; t = b
    }
    return t + left
  }
  const saved = segs.reduce((n, [a, b]) => n + (b - a) / 2, 0)
  return { map, saved }
}

/** A clip played at 1x from `from` seconds (or through `map`), framed by `keys`. */
export function Clip({ src, url, on, from = 0, keys = [], plate, hold, map }: { src: Src; url: string; on: boolean; from?: number; keys?: Key[]; plate: { w: number; h: number }; hold?: number; map?: (e: number) => number }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current!
    if (!on) return
    const t0 = clock.now()
    let id = 0
    const k = plate.w / src.W
    const tick = () => {
      let e = (clock.now() - t0) / 1000
      if (hold !== undefined) e = Math.min(e, hold)
      // the middle of the frame, so rounding never lands on the one before
      const t = map ? map(e) : from + e
      v.currentTime = t + 1 / 120
      const c = camAt(keys, t, full(src), src), z = src.W / c.w
      v.style.transform = `scale(${z}) translate(${-c.x * k}px, ${-c.y * k}px)`
      id = clock.raf(tick)
    }
    tick()
    return () => clock.cancelRaf(id)
  }, [on])
  return <video ref={ref} src={url} muted playsInline preload="auto" style={{ width: plate.w, height: plate.h, transformOrigin: '0 0' }} />
}
