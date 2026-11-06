// The virtual clock from Stageshow's kit/clock.ts (MIT License, Copyright (c) 2026 Benji Taylor), bundled with
// esbuild as an init script. One change: animations on scroll or view timelines are left alone (they follow the
// scroll, not time, and can't be given a time).
var __vc = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // kit/clock.ts
  var clock_exports = {};
  __export(clock_exports, {
    clock: () => clock,
    installVirtualClock: () => installVirtualClock
  });
  var clock = {
    now: () => performance.now(),
    raf: (fn) => requestAnimationFrame(fn),
    cancelRaf: (id) => cancelAnimationFrame(id),
    // Layout must finish even when a preview is paused. Keep these callbacks
    // separate: running arbitrary motion RAFs at a frozen timestamp can still
    // advance a spring that integrates once per callback.
    layoutRaf: (fn) => clock.recording?.requestLayoutFrame(fn) ?? requestAnimationFrame(fn),
    cancelLayoutRaf: (id) => {
      const recording = clock.recording;
      if (recording) recording.cancelLayoutFrame(id);
      else cancelAnimationFrame(id);
    },
    timeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    /** The recorder's control while one drives the page, else null. */
    get recording() {
      return typeof window === "undefined" ? null : window.__stageshow?.clock ?? null;
    }
  };
  function installVirtualClock(opts = {}) {
    const w = window;
    if (w.__stageshow?.clock) return w.__stageshow.clock;
    const fps = opts.fps ?? 60;
    const RealDate = Date;
    const epoch = opts.epoch ?? RealDate.now();
    const BASE = 1e3;
    let vt = BASE;
    let frame = 0;
    let fixedAnchor = BASE;
    let fixedFrame = 0;
    const timers = /* @__PURE__ */ new Map();
    let nextId = 1;
    let seq = 0;
    let frameCbs = /* @__PURE__ */ new Map();
    let layoutCbs = /* @__PURE__ */ new Map();
    const arm = (fn, ms, args, every) => {
      const d = Math.max(0, Number(ms) || 0);
      const id = nextId++;
      timers.set(id, { id, at: vt + d, seq: seq++, fn, args, every: every ? Math.max(1, d) : null });
      return id;
    };
    w.setTimeout = (fn, ms, ...args) => arm(fn, ms, args, false);
    w.setInterval = (fn, ms, ...args) => arm(fn, ms, args, true);
    w.clearTimeout = w.clearInterval = (id) => void timers.delete(id);
    w.requestAnimationFrame = (fn) => {
      const id = nextId++;
      frameCbs.set(id, fn);
      return id;
    };
    w.cancelAnimationFrame = (id) => void frameCbs.delete(id);
    performance.now = () => vt;
    const dateNow = () => Math.floor(epoch + (vt - BASE));
    const VDate = function(...a) {
      if (!new.target) return new RealDate(dateNow()).toString();
      return a.length ? new RealDate(...a) : new RealDate(dateNow());
    };
    Object.assign(VDate, { prototype: RealDate.prototype, now: dateNow, parse: RealDate.parse, UTC: RealDate.UTC });
    w.Date = VDate;
    const tick = () => new Promise((r) => {
      const c = new MessageChannel();
      c.port1.onmessage = () => {
        c.port1.close();
        c.port2.close();
        r();
      };
      c.port2.postMessage(0);
    });
    const settle = async () => {
      for (let i = 0; i < 4; i++) await tick();
      scan();
    };
    const run = (fn, args) => {
      try {
        if (typeof fn === "function") fn(...args);
      } catch (e) {
        console.error(e);
      }
    };
    const held = /* @__PURE__ */ new WeakMap();
    const live = /* @__PURE__ */ new Set();
    const scan = () => {
      for (const a of document.getAnimations()) {
        if (a.timeline && !(a.timeline instanceof DocumentTimeline)) continue;
        if (held.has(a) || a.playState === "finished" || a.playState === "idle") continue;
        held.set(a, { local: 0, rate: a.playbackRate || 1, born: vt });
        a.playbackRate = 0;
        a.currentTime = 0;
        live.add(a);
      }
    };
    const moveAnimations = (from) => {
      scan();
      for (const a of Array.from(live)) {
        const h = held.get(a);
        if (a.playState === "idle" || a.playState === "finished") {
          live.delete(a);
          continue;
        }
        if (a.playState !== "paused") h.local += (vt - Math.max(from, h.born)) * h.rate;
        const end = a.effect?.getComputedTiming().endTime;
        if (typeof end === "number" && Number.isFinite(end) && h.local >= end) {
          a.pause();
          a.playbackRate = h.rate;
          a.finish();
          live.delete(a);
        } else {
          a.currentTime = h.local;
        }
      }
    };
    const stepTo = async (to) => {
      const from = vt;
      await settle();
      for (let guard = 0; guard < 1e4; guard++) {
        let next = null;
        for (const t of Array.from(timers.values())) if (t.at <= to + 1e-6 && (!next || t.at < next.at || t.at === next.at && t.seq < next.seq)) next = t;
        if (!next) break;
        vt = next.at;
        if (next.every === null) timers.delete(next.id);
        else {
          next.at += next.every;
          next.seq = seq++;
        }
        run(next.fn, next.args);
        await settle();
      }
      vt = to;
      frame++;
      const cbs = frameCbs;
      const layout = layoutCbs;
      frameCbs = /* @__PURE__ */ new Map();
      layoutCbs = /* @__PURE__ */ new Map();
      for (const fn of Array.from(layout.values())) run(fn, [vt]);
      for (const fn of Array.from(cbs.values())) run(fn, [vt]);
      await settle();
      moveAnimations(from);
    };
    const control = {
      fps,
      get frame() {
        return frame;
      },
      now: () => vt,
      async step(n = 1) {
        for (let i = 0; i < n; i++) await stepTo(fixedAnchor + ++fixedFrame * 1e3 / fps);
      },
      async advance(milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("Clock advance must be a finite, non-negative duration");
        if (milliseconds === 0) return;
        await stepTo(vt + milliseconds);
        fixedAnchor = vt;
        fixedFrame = 0;
      },
      settle,
      requestLayoutFrame(callback) {
        const empty = layoutCbs.size === 0;
        const id = nextId++;
        layoutCbs.set(id, callback);
        if (empty) opts.onLayout?.();
        return id;
      },
      cancelLayoutFrame: (id) => void layoutCbs.delete(id),
      get layoutPending() {
        return layoutCbs.size > 0;
      },
      async flushLayout() {
        await settle();
        const callbacks = layoutCbs;
        layoutCbs = /* @__PURE__ */ new Map();
        for (const fn of Array.from(callbacks.values())) run(fn, [vt]);
        await settle();
      }
    };
    w.__stageshow = { ...w.__stageshow ?? {}, clock: control };
    return control;
  }
  return __toCommonJS(clock_exports);
})();
