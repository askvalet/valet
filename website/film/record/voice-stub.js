// Film only: the public demo's mic never listens (there's no server), so for the film the browser is given a microphone
// that hears a set sentence. Nothing in Valet changes: the page gets a stream, a recorder and a speech server's answer,
// all made up here, and the real mic button, level, timer and read-aloud button do the rest. `__heard` is what was "said".
;(() => {
  const real = window.fetch.bind(window);
  // the demo's page says its mic is a stand-in; the film's isn't
  window.fetch = async (u, i) => { const r = await real(u, i); if (!String(u?.url ?? u).includes('/snapshot/page.json')) return r; const j = await r.json(); if (j.voice) delete j.voice.demo; return new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } }) };
  window.__heard = '';
  window.__ears = () => { const page = window.fetch; window.fetch = (u, i) => String(u?.url ?? u).includes('/api/voice/transcribe') ? new Promise(ok => setTimeout(() => ok(new Response(JSON.stringify({ text: window.__heard }), { headers: { 'Content-Type': 'application/json' } })), 700)) : page(u, i) };
  const media = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
  try { Object.defineProperty(navigator, 'mediaDevices', { get: () => media }) } catch {}
  window.MediaRecorder = class { static isTypeSupported() { return true } constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm' }
    start() { this.state = 'recording' } stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['speech']) }); this.onstop?.() } };
  // a level that moves like someone talking: syllables, with a breath now and then
  window.AudioContext = class { close() { return Promise.resolve() } createMediaStreamSource() { return { connect() {} } }
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData(b) { const t = performance.now() / 1000, a = .04 + .3 * Math.abs(Math.sin(t * 9.1)) * (.35 + .65 * Math.abs(Math.sin(t * 2.7 + 1))) * (Math.sin(t * 1.3) > -.75 ? 1 : .1); for (let k = 0; k < b.length; k++) b[k] = 128 + 127 * a * Math.sin(k * .37) } } } };
  // read aloud, without sound: the film is silent, so an answer "plays" for as long as it would take to say
  HTMLMediaElement.prototype.play = function () { clearTimeout(this.__end); if (!/^data:|wav/.test(this.src) && this.onended) this.__end = setTimeout(() => this.onended?.(), 9000); return Promise.resolve() };
})();
