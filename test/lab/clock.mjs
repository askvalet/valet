// A moved clock, for checking tests don't depend on when they run: FAKE_NOW=<ISO time> starts Date there and lets it run
// at real speed (timers are untouched). Child processes inherit it through NODE_OPTIONS. For example:
//   FAKE_NOW=2026-12-31T23:59:50-05:00 TZ=America/Toronto NODE_OPTIONS=--import=./test/lab/clock.mjs node --test .test/*.test.mjs
const target = process.env.FAKE_NOW ? Date.parse(process.env.FAKE_NOW) : NaN;
if (!Number.isNaN(target)) {
  const Real = Date, off = target - Real.now();
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
    static now() { return Real.now() + off; }
  };
}
