// The dollhouse: a small WebGL2 renderer written for this one model (no dependencies). What makes it cheap is that the
// house doesn't move. Each light's shadows are baked once into an atlas, and ambient occlusion comes from a blurred
// top-down height map, so a frame is one mesh with a few texture reads per pixel, however much furniture there is.
// Walls facing the camera sink as you orbit; light fades spread outward from the bulb, reds first, like a filament.
// It draws only when something changes, pauses off screen and hidden, and sheds resolution if a machine can't keep up.
import './home.css';
import type { PlanData, PlanLight } from './home-model.ts';
import { buildHouse, buildRobot } from './home-mesh.ts';
import { plan, roomAt, WALL, type Layout } from './home-plan.ts';
import { createRobot, type Pose } from './home-robot.ts';

export interface HomeOptions { onLost?: () => void; turn?: number; tilt?: number; draggable?: boolean; remember?: string; hour?: number; fill?: boolean
  onPick?: (id: string | null) => void; onToggle?: (room: number) => void; onLight?: (id: string) => void }
export interface HomeStage { update(d: PlanData): void; select(id: string | null): void; destroy(): void }

const MAX_L = 32, MAX_R = 33, MAX_S = 48, SLOTS = 8, ATLAS = 2048, KEY = 1536, AO = 1024, SPREAD = 5.5, NEAR = 5, FAR = 900;
const LOW = 13, TAN = Math.tan(13 * Math.PI / 180);   // how low the near walls sink; a long lens, so it reads as a model
const COMMON = /* glsl */`#version 300 es
precision highp float; precision highp int; precision highp sampler2DShadow;
#define H ${WALL.toFixed(1)}
`;
const LAYOUT = `layout(location=0) in vec3 aP; layout(location=1) in vec4 aN; layout(location=2) in vec4 aC; layout(location=3) in uvec4 aI;`;

const VS = COMMON + LAYOUT + /* glsl */`
uniform mat4 uVP, uModel; uniform vec4 uCut, uBounds; uniform vec3 uCutC; uniform float uRise;
float cut(vec2 p) { return mix(H, uCut.z, clamp((dot(p - uCutC.xy, uCut.xy) / uCutC.z + .42) / .86, 0., 1.)) * uRise; }
out vec3 vP, vN, vC; out float vCap; flat out uvec4 vI;
void main() {
  vec4 w = uModel * vec4(aP, 1.); vec3 p = w.xyz; bool gone = false; vCap = 0.;
  if (aI.w > 0u) {                                         // a wall: the side nearest the camera is cut away, on a slope
    gone = aI.w > 1u && cut(uBounds.xy + vec2(aN.w * .5 + .5, aC.w) * uBounds.zw) < float(aI.w);   // a piece over a gap goes whole
    float t = cut(p.xz); vCap = p.y > t ? 1. : 0.; p.y = min(p.y, t);
  }
  vP = p; vN = mat3(uModel) * aN.xyz; vC = pow(aC.rgb, vec3(2.2)); vI = aI;
  gl_Position = gone ? vec4(2., 2., 2., 1.) : uVP * vec4(p, 1.);
}`;

const FS = COMMON + /* glsl */`
in vec3 vP, vN, vC; in float vCap; flat in uvec4 vI; out vec4 O;
uniform vec3 uEye, uKeyDir, uKeyCol, uSky, uGnd, uBot, uBotC; uniform vec4 uLP[${MAX_L}], uLC[${MAX_L}], uFill[${MAX_R}], uMap, uAtlasInfo; uniform ivec4 uList[${MAX_R * 2}];
uniform mat4 uKeyM; uniform sampler2DShadow uAtlas, uKey; uniform sampler2D uAO, uClean; uniform float uTime, uExpo, uStill;
float sat(float x) { return clamp(x, 0., 1.); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
const vec2 TAP[4] = vec2[4](vec2(-.33, -.94), vec2(.94, -.33), vec2(.33, .94), vec2(-.94, .33));
mat2 turn;
float lampShadow(int i, vec3 p, vec3 lp, float past) {
  float w = lp.y - p.y; vec2 s = (p.xz - lp.xz) / (w * ${SPREAD.toFixed(1)});
  float e = max(abs(s.x), abs(s.y)); if (e >= 1.) return past;   // beyond the map: nothing to go on but whose room it is
  float z = .5 + .5 * (uAtlasInfo.y + uAtlasInfo.z / w), n = uAtlasInfo.x, t = 1. / n;
  vec2 uv = (vec2(mod(float(i), n), floor(float(i) / n)) + .5 + .485 * s) * t;
  float r = t * (1.2 + .012 * length(p.xz - lp.xz)) / ${(ATLAS / 4).toFixed(1)}, v = 0.;
  for (int k = 0; k < 4; k++) v += texture(uAtlas, vec3(uv + turn * TAP[k] * r, z - .00012));
  return mix(past, v * .25, smoothstep(1., .86, e));
}
float keyShadow(vec3 p) {
  vec4 c = uKeyM * vec4(p, 1.); vec3 q = c.xyz * .5 + .5; float v = 0.;
  for (int k = 0; k < 4; k++) v += texture(uKey, vec3(q.xy + turn * TAP[k] * .0016, q.z - .0009));
  return v * .25;
}
void main() {
  uint kind = vI.x; int room = int(vI.y), link = int(vI.z);
  vec3 N = normalize(vN), V = normalize(uEye - vP), alb = vC; float rough = .75, f0 = .04; vec3 emit = vec3(0.);
  float g = hash(gl_FragCoord.xy * .0173); g = 6.283 * g; turn = mat2(cos(g), -sin(g), sin(g), cos(g));
  if (dot(N, V) < 0. && (kind == 10u || kind == 6u)) N = -N;
  vec2 q = vP.xz; bool floorish = false;
  if (vCap > .995) {                                       // a cut face has no shadows of its own: it's inside what was baked
    vec3 c = vC * (uSky * 1.3 + uKeyCol * .34 + uFill[room].rgb * 1.5 + .012) * uFill[room].a * uExpo;
    O = vec4(pow(c / (1. + c), vec3(1. / 2.2)), 1.); return;
  }
  if (kind == 1u || kind == 2u) {                          // oak boards: staggered, each its own tone, a grain, a seam
    if (kind == 2u) q = q.yx;
    float w = 13., row = floor(q.y / w), run = (q.x + hash(vec2(row, 3.)) * 300.) / 170., b = floor(run), id = hash(vec2(row, b) * .37);
    float fade = sat(1. - fwidth(q.y) * .25);
    float grain = noise(vec2(q.x * .035 + id * 40., q.y * .9 + id * 9.)) * .6 + noise(vec2(q.x * .012, q.y * .35 + id * 20.)) * .4;
    float seam = min(smoothstep(0., .9, min(fract(q.y / w), 1. - fract(q.y / w)) * w), smoothstep(0., .9, min(fract(run), 1. - fract(run)) * 170.));
    alb *= mix(1., (.62 + id * .62) * (.78 + grain * .44), fade) * mix(1., .35 + .65 * seam, fade);
    rough = .42 + .2 * grain; f0 = .05; floorish = true;
  } else if (kind == 3u) {                                 // tile: a little off from each other, in pale grout
    float w = 20.; vec2 c = floor(q / w), f = abs(fract(q / w) - .5) * w * 2.;
    float e = smoothstep(w - 1.4, w - .5, max(f.x, f.y)), fade = sat(1. - fwidth(q.x) * .5);
    alb = mix(alb * (.86 + .2 * hash(c * .71)), alb * .55, e * fade); rough = mix(.18, .8, e); f0 = .06; floorish = true;
  } else if (kind == 4u || kind == 14u) {                  // cloth: a soft weave
    float w = noise(q * 2.4 + vP.y * 2.1) * .5 + noise(q * .7 + vP.y) * .5; alb *= .84 + .3 * w; rough = 1.; f0 = .02; floorish = kind == 14u;
    
  } else if (kind == 5u) { alb *= .97 + .06 * noise(vec2(vP.x + vP.z, vP.y) * .22); rough = .9; f0 = .03;
  } else if (kind == 6u) { rough = .24; f0 = .05;
  } else if (kind == 7u) { rough = .3; f0 = .55; alb *= .6;
  } else if (kind == 10u) { float v = sin(length(vP.xz) * 1.1) * .08; alb *= 1. + v; rough = .5; f0 = .05;
  } else if (kind == 11u) { float d = abs(N.y) > .5 ? q.x : vP.y; alb *= .82 + .3 * noise(vec2(d * .04, (q.y + vP.y) * .8)); rough = .46; f0 = .04;
  } else if (kind == 13u) { rough = .12; f0 = .1; }

  vec3 a = texture(uAO, (vP.xz - uMap.xy) * uMap.zw).rgb * H; float y = vP.y;
  float ao = (1. - .55 * sat((a.r - y - .4) / 8.)) * (1. - .5 * sat((a.g - y - .4) / 15.)) * (1. - .5 * sat((a.b - y - .2) / 24.));
  if (uBot.z > 0. && y < 7.) ao *= 1. - .7 * smoothstep(uBot.z * 1.5, uBot.z * .7, distance(vP.xz, uBot.xy));   // the robot's contact shadow
  vec4 fill = uFill[room];
  if (floorish) { float c = texture(uClean, (vP.xz - uMap.xy) * uMap.zw).r; rough *= 1. - c * .34; alb *= 1. + c * .05 * sin((q.x + q.y) * .62); }

  float spow = 2. / max(rough * rough * rough, .002), sk = (spow + 8.) / 40.;
  vec3 light = mix(uGnd, uSky, N.y * .5 + .5) * ao + fill.rgb * ao * (.55 + .45 * max(N.y, .35)), spec = vec3(0.);
  float nk = dot(N, uKeyDir);
  if (nk > 0.) {
    float s = keyShadow(vP + N * 1.1); vec3 c = uKeyCol * nk * s * mix(.75, 1., ao); light += c;
    vec3 h = normalize(uKeyDir + V); spec += uKeyCol * s * pow(max(dot(N, h), 0.), spow) * sk * f0 * 2.;
  }
  for (int k = 0; k < ${SLOTS}; k++) {
    int id = uList[room * 2 + k / 4][k % 4]; if (id == 0) break;
    int i = (id < 0 ? -id : id) - 1;
    vec4 c = uLC[i], lp = uLP[i]; if (c.r + c.g + c.b < .004) continue;
    vec3 d = lp.xyz - vP; float r2 = dot(d, d); if (r2 > lp.w * lp.w) continue;
    float r = sqrt(r2); vec3 L = d / r; float nl = dot(N, L); if (nl <= -.05) continue;
    float t = r2 / (lp.w * lp.w), fall = (1. - t) * (1. - t) / (1. + r2 / (c.w * c.w));
    float own = id > 0 ? 1. : 0., sh = d.y > 3. ? lampShadow(i, vP + N * 1.3, lp.xyz, own) : own; if (sh <= .002) continue;
    vec3 e = c.rgb * fall * sh; light += e * sat(nl * .92 + .08) * mix(.65, 1., ao);
    vec3 h = normalize(L + V); spec += e * pow(max(dot(N, h), 0.), spow) * sk * f0 * sat(nl * 2.);
  }
  float fres = pow(1. - sat(dot(N, V)), 5.); spec += mix(uGnd, uSky, sat(reflect(-V, N).y * .5 + .5)) * (f0 + (1. - f0) * fres) * (1. - rough) * ao * .7;
  if (kind == 8u) { vec3 c = link > 0 ? uLC[link - 1].rgb : vec3(0.); alb *= .55; emit = c * vC * .32 * (1. + .4 * sat(1. - abs(N.y))); }
  if (kind == 9u) {
    alb = vec3(.01); rough = .15;
    if (link > 0) { vec3 c = uLC[link - 1].rgb; float sum = c.r + c.g + c.b; vec2 s = vec2(vP.x + vP.z, vP.y) * .03; float m = noise(s + uTime * .05); float n = noise(s * 1.7 - uTime * .08);
      emit = sum > .01 ? mix(vec3(.05, .07, .17), vec3(.5, .3, .22), m) * (.45 + n) * sat(sum * 1.5) : vec3(0.); }
  }
  if (kind == 12u) {                                       // glass: sky by day, the room's light by night
    float f = .08 + .92 * pow(1. - sat(abs(dot(N, V))), 4.), lit = dot(fill.rgb, vec3(.33));
    vec3 r = reflect(-V, N); float up = sat(r.y * .7 + .35), day = sat(dot(uSky, vec3(2.)));
    vec3 c = mix(uGnd * 3., uSky * vec3(2., 2.5, 3.2), up) * (.6 + f) + vec3(.8, .9, 1.) * smoothstep(.62, .66, fract((vP.x + vP.z) * .008 + vP.y * .012)) * .12 * day + fill.rgb * 3.2;
    float al = sat(.42 + f + lit * 1.6);
    c *= fill.a; c = c * uExpo; c = c / (1. + c * .6);
    O = vec4(pow(c, vec3(1. / 2.2)) * al, al); return;
  }
  vec3 c = alb * light + spec + emit;
  c *= fill.a * uExpo;
  // filmic, on the brightest channel as well as each: a warm lamp rolls off to warm, not to yellow
  float top = max(max(c.r, c.g), max(c.b, 1e-4)), t = (top * (2.51 * top + .03)) / (top * (2.43 * top + .59) + .14);
  vec3 f = (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14);
  c = pow(clamp(mix(c * t / top, f, .4), 0., 1.), vec3(1. / 2.2));
  O = vec4(c + (hash(gl_FragCoord.xy * .0037) - .5) / 200., 1.);   // dithered: dark gradients don't band
}`;

const SHADOW_VS = COMMON + LAYOUT + /* glsl */`
uniform vec4 uL; uniform vec2 uZ; uniform mat4 uM;
void main() {
  if (uL.w > 0.) { float w = uL.y - aP.y; gl_Position = vec4((aP.x - uL.x) / ${SPREAD.toFixed(1)}, (aP.z - uL.z) / ${SPREAD.toFixed(1)}, uZ.x * w + uZ.y, w); }
  else gl_Position = uM * vec4(aP, 1.);
}`;
const SHADOW_FS = COMMON + `void main() {}`;
const TOP_VS = COMMON + LAYOUT + /* glsl */`
uniform vec4 uMap; out float vY;
void main() { vec2 p = (aP.xz - uMap.xy) * uMap.zw; vY = aP.y; gl_Position = vec4(p * 2. - 1., -aP.y / (H * 1.3), 1.); }`;
const TOP_FS = COMMON + `in float vY; out vec4 O; void main() { O = vec4(clamp(vY / H, 0., 1.)); }`;
const BLUR_VS = COMMON + `out vec2 vU; void main() { vU = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.; gl_Position = vec4(vU * 2. - 1., 0., 1.); }`;
const BLUR_FS = COMMON + /* glsl */`
in vec2 vU; out vec4 O; uniform sampler2D uT; uniform vec2 uD; uniform float uFrom;
void main() { float v = 0., t = 0.; for (int i = -8; i <= 8; i++) { float f = float(i) / 8., w = exp(-f * f * 3.); v += texture(uT, vU + uD * f)[int(uFrom)] * w; t += w; } O = vec4(v / t); }`;
const GLOW_VS = COMMON + /* glsl */`
uniform mat4 uVP; uniform vec3 uRight, uUp, uFwd; uniform vec4 uP[${MAX_S}], uC[${MAX_S}]; out vec2 vU; out vec4 vC;
void main() { vU = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2. - 1.; vec4 p = uP[gl_InstanceID]; vC = uC[gl_InstanceID];
  vec3 w = vC.a < 0. ? p.xyz + vec3(vU.x, 0., vU.y) * p.w : p.xyz + (uRight * vU.x + uUp * vU.y) * p.w - uFwd * p.w * .5; gl_Position = uVP * vec4(w, 1.); }`;
const GLOW_FS = COMMON + /* glsl */`
in vec2 vU; in vec4 vC; out vec4 O;
void main() { float r = length(vU); if (r >= 1.) discard; float k = 1. - r; k *= k; vec3 c = vC.rgb * (k + k * k * 1.6); O = vec4(c, 0.); }`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation> };
const linear = (hex: string) => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2);
const norm = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mul = (a: Float32Array, b: Float32Array) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const look = (eye: number[], r: number[], u: number[], f: number[]) => new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1]);
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The light outside through the day: [hour, key colour × strength, sky, ground, exposure]
const MOODS: [number, number[], number[], number[], number][] = [
  [0, [.1, .14, .27], [.036, .05, .09], [.012, .014, .022], 1.15],
  [5.5, [.1, .14, .25], [.04, .052, .09], [.014, .015, .024], 1.15],
  [7, [1.1, .62, .34], [.17, .17, .22], [.06, .05, .05], 1],
  [10, [1.45, 1.3, 1.08], [.34, .39, .47], [.11, .1, .09], .92],
  [14, [1.5, 1.4, 1.22], [.36, .41, .49], [.12, .11, .1], .9],
  [17.5, [1.35, .8, .42], [.2, .2, .27], [.07, .055, .05], 1],
  [19, [.42, .22, .2], [.07, .065, .11], [.02, .018, .022], 1.1],
  [20.5, [.1, .14, .27], [.036, .05, .09], [.012, .014, .022], 1.15],
  [24, [.1, .14, .27], [.036, .05, .09], [.012, .014, .022], 1.15],
];
function moodAt(h: number) {
  const i = Math.max(0, MOODS.findIndex(m => m[0] > h) - 1), [a, b] = [MOODS[i], MOODS[i + 1] ?? MOODS[i]], t = smooth(a[0], b[0], h);
  const mix = (x: number[], y: number[]) => x.map((v, n) => v + (y[n] - v) * t);
  const day = (h - 6) / 13.5, up = day > 0 && day < 1, az = up ? -2 + day * 4 : 1.1, el = up ? .16 + Math.sin(day * Math.PI) * .85 : .95;
  return { key: mix(a[1], b[1]), sky: mix(a[2], b[2]), gnd: mix(a[3], b[3]), expo: a[4] + (b[4] - a[4]) * t, dir: norm([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el) * .9 + .3]) };
}

export const glReady = () => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } };

export function createDollhouse(box: HTMLElement, opts: HomeOptions = {}): HomeStage {
  const { turn = -36, tilt = -46, draggable = true, remember, hour, fill = false, onPick, onToggle, onLight, onLost } = opts;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saved = (() => { try { return remember ? JSON.parse(localStorage.getItem(`valet-view:${remember}`) ?? 'null') : null; } catch { return null; } })();
  box.classList.add('homex', 'gl');
  const canvas = document.createElement('canvas'), tag = document.createElement('div');
  canvas.setAttribute('aria-hidden', 'true'); tag.className = 'tag'; box.append(canvas, tag);
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'default' })!;

  const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) console.error(gl.getShaderInfoLog(s)); return s; };
  const program = (vs: string, fs: string): Prog => {
    const p = gl.createProgram()!; gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) console.error(gl.getProgramInfoLog(p));
    const u: Prog['u'] = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i)!.name; u[name.replace('[0]', '')] = gl.getUniformLocation(p, name)!; }
    return { p, u };
  };
  const main = program(VS, FS), shadow = program(SHADOW_VS, SHADOW_FS), top = program(TOP_VS, TOP_FS), blur = program(BLUR_VS, BLUR_FS), glow = program(GLOW_VS, GLOW_FS);
  const empty = gl.createVertexArray();
  const mesh = (d: { verts: Uint8Array; index: Uint32Array }) => {
    const vao = gl.createVertexArray()!, vb = gl.createBuffer()!, ib = gl.createBuffer()!;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, d.verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.index, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.BYTE, true, 24, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 24, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, 24, 20);
    gl.bindVertexArray(null);
    return { vao, vb, ib };
  };
  const tex = (w: number, h: number, depth: boolean, filter: number) => {
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    if (depth) { gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL); }
    else gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const target = (color: WebGLTexture | null, depth: WebGLTexture | null, size = 0) => {
    const f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0); else { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    else if (size) { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, r); }
    return f;
  };
  const atlasTex = tex(ATLAS, ATLAS, true, gl.LINEAR), keyTex = tex(KEY, KEY, true, gl.LINEAR), aoTex = tex(AO, AO, false, gl.LINEAR), rawTex = tex(AO, AO, false, gl.LINEAR), tmpTex = tex(AO, AO, false, gl.LINEAR);
  const atlasFB = target(null, atlasTex), keyFB = target(null, keyTex), aoFB = target(aoTex, null), rawFB = target(rawTex, null, AO), tmpFB = target(tmpTex, null);
  const CLEAN = 256, cleanData = new Uint8Array(CLEAN * CLEAN), cleanTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, cleanTex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, CLEAN, CLEAN);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, CLEAN, CLEAN, gl.RED, gl.UNSIGNED_BYTE, cleanData);
  const botData = buildRobot(), botMesh = mesh(botData);

  let data: PlanData | null = null, shape = '', layout: Layout | null = null;
  let house: ReturnType<typeof mesh> | null = null, counts = { cast: 0, solid: 0, total: 0 };
  let sim: ReturnType<typeof createRobot> | null = null, map = [0, 0, 1, 1], keyM = IDENT, mood = moodAt(0), bakedHour = -1;
  // what each emitter is doing now, and where it's headed: [r, g, b, reach 0..1, then the targets]
  let glowing: { cur: number[]; to: number[]; reach: number; wait: number }[] = [], fills = new Float32Array(MAX_R * 4), list = new Int32Array(MAX_R * 8);
  const LP = new Float32Array(MAX_L * 4), LC = new Float32Array(MAX_L * 4), SP = new Float32Array(MAX_S * 4), SC = new Float32Array(MAX_S * 4);
  const gains = new Float32Array(MAX_R).fill(1);
  let sel: string | null = null, hover = 0;

  // ─ the camera: a turn and a tilt with momentum, framed so the model always fills the box, flown to what's picked
  const cam = { ry: saved?.ry ?? turn, rx: saved?.rx ?? tilt, vy: 0, vx: 0, k: 0, k1: 0, drift: 0, idle: 0, x: 0, y: 0, z: 0, zoom: 1, tx: 0, ty: 0, tz: 0, tzoom: 1 };
  let eye = [0, 0, 1], right = [1, 0, 0], up = [0, 1, 0], fwd = [0, 0, -1], dist = 1000, aspect = 1, vp = IDENT;
  const orbit = () => {
    const sway = cam.drift, ry = cam.ry + Math.sin(clock * .13) * 6 * sway, rx = cam.rx + Math.sin(clock * .09) * 1.4 * sway;
    const t = ry * Math.PI / 180, e = -rx * Math.PI / 180, out = [-Math.sin(t) * Math.cos(e), Math.sin(e), Math.cos(t) * Math.cos(e)];
    fwd = out.map(v => -v); right = norm(cross(fwd, [0, 1, 0])); up = cross(right, fwd);
    // the framing: the distance and offset that fit the model's corners into the box at this angle
    const b = layout?.bounds ?? { x: -100, z: -80, w: 200, d: 160 }, pad = 18, cx = b.x + b.w / 2, cz = b.z + b.d / 2, xs = [b.x - pad, b.x + b.w + pad], zs = [b.z - pad, b.z + b.d + pad];
    const pts: number[][] = []; for (const x of xs) for (const z of zs) for (const y of [-16, WALL * .62]) { const p = [x - cx, y - WALL * .2, z - cz]; pts.push([dot(p, right), dot(p, up), dot(p, out)]); }
    const tx = TAN * Math.max(aspect, .01), ty = TAN; let D = 400, ca = 0, cb = 0;
    for (let i = 0; i < 3; i++) {
      D = 0; for (const [a, c, w] of pts) D = Math.max(D, w + Math.abs(a - ca) / tx, w + Math.abs(c - cb) / ty);
      let lo = Infinity, hi = -Infinity, l2 = Infinity, h2 = -Infinity;
      for (const [a, c, w] of pts) { const s = D / (D - w), sa = a * s, sc = c * s; lo = Math.min(lo, sa); hi = Math.max(hi, sa); l2 = Math.min(l2, sc); h2 = Math.max(h2, sc); }
      ca = (lo + hi) / 2; cb = (l2 + h2) / 2;
    }
    D *= fill ? 1.02 : 1.07;
    const hx = cx + right[0] * ca + up[0] * cb, hy = WALL * .2 + right[1] * ca + up[1] * cb, hz = cz + right[2] * ca + up[2] * cb;
    const k = cam.k, D2 = D / cam.zoom, at = [hx + (cam.x - hx) * k, hy + (cam.y - hy) * k, hz + (cam.z - hz) * k], d = D + (D2 - D) * k;
    dist = d; eye = at.map((v, i) => v + out[i] * d);
    const f = 1 / TAN, near = Math.max(30, d - 900), far = d + 900;
    const proj = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0]);
    vp = mul(proj, look(eye, right, up, fwd));
  };
  const project = (x: number, y: number, z: number) => {
    const c = [x - eye[0], y - eye[1], z - eye[2]], w = dot(c, fwd), s = 1 / (TAN * w);
    return [(dot(c, right) * s / aspect * .5 + .5) * box.clientWidth, (.5 - dot(c, up) * s * .5) * box.clientHeight];
  };
  /** The room under a place on the screen: at floor level, or failing that on a wall that stands in front of it. */
  const roomUnder = (px: number, py: number) => {
    const sx = (px / box.clientWidth * 2 - 1) * TAN * aspect, sy = (1 - py / box.clientHeight * 2) * TAN, ray = fwd.map((v, i) => v + right[i] * sx + up[i] * sy);
    for (const y of [0, WALL * .3, WALL * .6]) { const t = (y - eye[1]) / ray[1], k = t > 0 ? roomAt(layout!, eye[0] + ray[0] * t, eye[2] + ray[2] * t) : 0; if (k) return k; }
    return 0;
  };
  const pickAt = (px: number, py: number) => {
    if (!layout) return null;
    if (sim && data?.robot) { const [a, b] = project(sim.pose.x, 4, sim.pose.z); if (Math.hypot(a - px, b - py) < 20 * Math.max(1, cam.zoom * cam.k)) return 'robot'; }
    const k = roomUnder(px, py);
    return k ? `room:${layout.rooms[k - 1].src.id}` : null;
  };
  const lampAt = (px: number, py: number) => {
    let best = '', far = 22;
    for (const f of layout?.fixtures ?? []) { if (`room:${layout!.rooms[f.room - 1].src.id}` !== sel) continue; const [a, b] = project(f.x, f.y, f.z), d = Math.hypot(a - px, b - py); if (d < far) { far = d; best = f.id; } }
    return best;
  };

  // ─ what's baked: a shadow map for each light, the top-down height map for ambient occlusion
  const bakeKey = () => {
    if (!house || !layout) return;
    const b = layout.bounds, c = [b.x + b.w / 2, WALL / 2, b.z + b.d / 2], R = Math.hypot(b.w, b.d) / 2 + 60, f = mood.dir.map(v => -v), r = norm(cross(f, [.01, 1, .02])), u = cross(r, f);
    const e = c.map((v, i) => v - f[i] * R * 1.5), s = 1 / R, n = R * .3, x = R * 3;
    keyM = mul(new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, -2 / (x - n), 0, 0, 0, -(x + n) / (x - n), 1]), look(e, r, u, f));
    gl.bindFramebuffer(gl.FRAMEBUFFER, keyFB); gl.viewport(0, 0, KEY, KEY); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(shadow.p); gl.uniform4f(shadow.u.uL, 0, 0, 0, 0); gl.uniformMatrix4fv(shadow.u.uM, false, keyM);
    gl.bindVertexArray(house.vao); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
    gl.drawElements(gl.TRIANGLES, counts.cast, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  };
  const bake = () => {
    if (!house || !layout) return;
    const b = layout.bounds, m = 40; map = [b.x - m, b.z - m, 1 / (b.w + m * 2), 1 / (b.d + m * 2)];
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, atlasFB); gl.clear(gl.DEPTH_BUFFER_BIT);
    const n = Math.max(1, Math.ceil(Math.sqrt(layout.emitters.length))), size = Math.floor(ATLAS / n), A = (FAR + NEAR) / (FAR - NEAR), B = -2 * FAR * NEAR / (FAR - NEAR);
    gl.useProgram(shadow.p); gl.bindVertexArray(house.vao); gl.uniform2f(shadow.u.uZ, A, B);
    gl.enable(gl.SCISSOR_TEST); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    layout.emitters.forEach((e, i) => {
      gl.viewport((i % n) * size, Math.floor(i / n) * size, size, size); gl.scissor((i % n) * size, Math.floor(i / n) * size, size, size);
      gl.uniform4f(shadow.u.uL, e.x, e.y, e.z, 1); gl.drawElements(gl.TRIANGLES, counts.cast, gl.UNSIGNED_INT, 0);
    });
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.POLYGON_OFFSET_FILL);
    atlasInfo = [n, A, B];
    bakeKey();
    // height from above, then blurred at three scales into the texture's three channels
    gl.bindFramebuffer(gl.FRAMEBUFFER, rawFB); gl.viewport(0, 0, AO, AO); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(top.p); gl.uniform4f(top.u.uMap, map[0], map[1], map[2], map[3]); gl.drawElements(gl.TRIANGLES, counts.cast, gl.UNSIGNED_INT, 0);
    gl.disable(gl.DEPTH_TEST); gl.useProgram(blur.p); gl.bindVertexArray(empty); gl.uniform1i(blur.u.uT, 0); gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, aoFB); gl.clear(gl.COLOR_BUFFER_BIT);
    [10, 22, 42].forEach((radius, c) => {
      const du = radius * map[2], dv = radius * map[3];
      gl.colorMask(true, true, true, true); gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFB); gl.bindTexture(gl.TEXTURE_2D, rawTex); gl.uniform1f(blur.u.uFrom, 0); gl.uniform2f(blur.u.uD, du, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.colorMask(c === 0, c === 1, c === 2, false); gl.bindFramebuffer(gl.FRAMEBUFFER, aoFB); gl.bindTexture(gl.TEXTURE_2D, tmpTex); gl.uniform2f(blur.u.uD, 0, dv); gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    gl.colorMask(true, true, true, true); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  let atlasInfo = [1, 1, 0];

  const rebuild = (d: PlanData) => {
    const p = layout = plan(d), built = buildHouse(p, d.dock);
    if (house) { gl.deleteVertexArray(house.vao); gl.deleteBuffer(house.vb); gl.deleteBuffer(house.ib); }
    house = mesh(built); counts = { cast: built.cast, solid: built.solid, total: built.index.length };
    glowing = p.emitters.map((_, i) => ({ cur: [0, 0, 0], to: [0, 0, 0], reach: 0, wait: calm ? 0 : .5 + i * .07 }));
    LP.fill(0); p.emitters.slice(0, MAX_L).forEach((e, i) => LP.set([e.x, e.y, e.z, e.reach], i * 4));
    list.fill(0); p.rooms.slice(0, MAX_R - 1).forEach(r => r.list.forEach((e, k) => { if (e < MAX_L && ~e < MAX_L) list[r.i * 8 + k] = e >= 0 ? e + 1 : e; }));
    sim = createRobot(p, d.dock); bake(); rise = calm ? 1 : 0;
  };
  const shapeOf = (d: PlanData) => JSON.stringify([(d.rooms ?? []).map(r => [r.id, Math.round(r.x), Math.round(r.z), Math.round(r.w), r.lights.map(l => [l.id, l.kind, l.at?.x])]), d.furniture?.length, !!d.dock, !!d.robot]);
  const lightOf = (l?: PlanLight) => { if (!l?.on) return [0, 0, 0]; const c = linear(l.color ?? '#ffcf9f'), p = Math.max(.12, (l.level / 100) ** 1.3); return c.map(v => v * p); };
  const retarget = () => {
    if (!data || !layout) return;
    const all = new Map(data.rooms.flatMap(r => r.lights.map(l => [l.id, l] as const)));
    layout.emitters.forEach((e, i) => {
      if (e.screen) { const on = layout!.rooms[e.room - 1].src.lights.length === 0 ? false : data!.rooms[e.room - 1].lights.some(l => l.on); glowing[i].to = on ? [.1, .15, .34] : [0, 0, 0]; return; }
      const sum = [0, 0, 0]; for (const id of e.ids) lightOf(all.get(id)).forEach((v, n) => { sum[n] += v / Math.max(1, e.ids.length) * (1 + (e.ids.length - 1) * .5); });
      glowing[i].to = sum;
    });
  };

  // ─ the frame
  let raf = 0, last = 0, clock = 0, rise = 1, onScreen = true, lastDraw = 0, slow = 0, frames = 0, scale = 1, cleanDirty = 0, cleanT = 0, tagKey = '', hint = 0, down: { x: number; y: number; ry: number; rx: number; t: number } | null = null, dragged = false;
  const settled = () => Math.abs(cam.vy) + Math.abs(cam.vx) < .02 && Math.abs(cam.k - (sel ? 1 : 0)) < .002 && rise >= 1 && glowing.every(g => g.wait <= 0 && g.cur.every((v, i) => Math.abs(v - g.to[i]) < .002) && g.reach > .995 || g.to.every(v => v === 0) && g.cur.every(v => v < .002));
  const kick = () => { if (!raf && onScreen && !document.hidden && layout) { last = 0; raf = requestAnimationFrame(frame); } };

  const step = (dt: number) => {
    clock += dt;
    if (!down) {
      cam.ry += cam.vy * dt; cam.rx += cam.vx * dt; const f = Math.exp(-dt * 3.2); cam.vy *= f; cam.vx *= f;
      // the tilt stops softly at its ends
      if (cam.rx > -16) { cam.rx += (-16 - cam.rx) * Math.min(1, dt * 10); cam.vx = 0; } if (cam.rx < -82) { cam.rx += (-82 - cam.rx) * Math.min(1, dt * 10); cam.vx = 0; }
      cam.idle += dt;
    }
    const want = calm || sel ? 0 : smooth(2.5, 5, cam.idle); cam.drift += (want - cam.drift) * Math.min(1, dt * 2);
    // two followers in a row: starts and lands softly
    const s = calm ? 1 : 1 - Math.exp(-dt * 7); cam.k1 += ((sel ? 1 : 0) - cam.k1) * s; cam.k += (cam.k1 - cam.k) * s;
    const z = calm ? 1 : 1 - Math.exp(-dt * 6); cam.x += (cam.tx - cam.x) * z; cam.y += (cam.ty - cam.y) * z; cam.z += (cam.tz - cam.z) * z; cam.zoom += (cam.tzoom - cam.zoom) * z;
    if (rise < 1) rise = Math.min(1, rise + dt / 1.5);
    for (const g of glowing) {
      if (g.wait > 0) { g.wait -= dt; continue; }
      const on = g.to.some(v => v > .001), rising = g.cur[0] < g.to[0];
      // a filament: red warms first and leaves last
      [.16, .24, .34].forEach((tau, i) => { const t = calm ? .001 : on && rising ? tau : [.34, .24, .16][i]; g.cur[i] += (g.to[i] - g.cur[i]) * (1 - Math.exp(-dt / t)); });
      g.reach = on ? g.reach + (1 - g.reach) * (1 - Math.exp(-dt / (calm ? .001 : .42))) : g.reach < .01 ? 0 : g.reach * Math.exp(-dt * .4);
      if (!on && g.cur[0] < .002) g.reach = 0;
    }
    if (data?.robot && sim) {
      const r = data.robot, dock = r.state === 'docked' ? data.dock : undefined;
      if (calm) { sim.pose.x = dock?.x ?? r.x ?? sim.pose.x; sim.pose.z = dock?.z ?? r.z ?? sim.pose.z; sim.pose.a = dock?.a ?? r.a ?? sim.pose.a; }   // no driving about: it's simply where it is
      else if (sim.step(dt, r).moving) stamp(sim.pose);
    }
  };
  const stamp = (p: Pose) => {
    const u = Math.round((p.x - map[0]) * map[2] * CLEAN), v = Math.round((p.z - map[1]) * map[3] * CLEAN), r = Math.ceil(11 * map[2] * CLEAN);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const k = (v + j) * CLEAN + u + i; if (k >= 0 && k < cleanData.length && i * i + j * j <= r * r) cleanData[k] = 255; }
    cleanDirty = 1;
  };

  const draw = () => {
    if (!layout || !house || !data) return;
    orbit();
    const w = canvas.width, h = canvas.height, m = mood, lit = layout.emitters;
    // lights: their colour now, spreading out from the bulb as they come on
    for (let i = 0; i < lit.length && i < MAX_L; i++) {
      const g = glowing[i], e = lit[i], shimmer = e.screen ? .78 + .22 * Math.sin(clock * 1.7 + Math.sin(clock * .6) * 2) : 1, power = e.screen ? 5 : e.y > 60 ? 8 : 5;
      LC.set([g.cur[0] * power * shimmer, g.cur[1] * power * shimmer, g.cur[2] * power * shimmer, e.y > 60 ? 95 : e.screen ? 40 : 58], i * 4);
      LP[i * 4 + 3] = Math.max(1, e.reach * (.18 + .82 * g.reach));
    }
    // each room is also filled by its own light, bounced off everything in it
    fills.fill(0);
    const pick = sel?.startsWith('room:') ? Number(sel.slice(5)) : null;
    fills[3] = pick != null ? 1 - cam.k * .34 : 1;
    for (const r of layout.rooms.slice(0, MAX_R - 1)) {
      const sum = [0, 0, 0];
      for (const e of r.list) if (e >= 0) for (let n = 0; n < 3; n++) sum[n] += glowing[e].cur[n] * glowing[e].reach * (lit[e].screen ? .3 : 1);
      const mine = pick == null || r.src.id === pick, goal = (mine ? 1 : 1 - cam.k * .62) * (hover === r.i && !sel ? 1.2 : 1);
      gains[r.i] += (goal - gains[r.i]) * (calm ? 1 : .2);
      fills.set([sum[0] * .1, sum[1] * .1, sum[2] * .1, gains[r.i]], r.i * 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.depthMask(true);
    const u = main.u; gl.useProgram(main.p);
    gl.uniformMatrix4fv(u.uVP, false, vp); gl.uniformMatrix4fv(u.uModel, false, IDENT); gl.uniformMatrix4fv(u.uKeyM, false, keyM);
    gl.uniform3fv(u.uEye, eye); gl.uniform3fv(u.uKeyDir, m.dir); gl.uniform3fv(u.uKeyCol, m.key); gl.uniform3fv(u.uSky, m.sky); gl.uniform3fv(u.uGnd, m.gnd);
    gl.uniform4fv(u.uLP, LP); gl.uniform4fv(u.uLC, LC); gl.uniform4fv(u.uFill, fills); gl.uniform4iv(u.uList, list);
    gl.uniform4fv(u.uMap, map); gl.uniform4f(u.uAtlasInfo, atlasInfo[0], atlasInfo[1], atlasInfo[2], 0);
    gl.uniform1f(u.uTime, clock); gl.uniform1f(u.uExpo, m.expo);
    // the cutaway slopes down towards the camera, about the room you're looking at if there is one
    const b = layout.bounds, len = Math.hypot(eye[0] - (b.x + b.w / 2), eye[2] - (b.z + b.d / 2)) || 1, cd = [(eye[0] - (b.x + b.w / 2)) / len, (eye[2] - (b.z + b.d / 2)) / len];
    const el = Math.asin(Math.min(1, -fwd[1])) * 180 / Math.PI, R = Math.hypot(b.w, b.d) / 2, fx = b.x + b.w / 2, fz = b.z + b.d / 2, k = cam.k;
    gl.uniform4f(u.uCut, cd[0], cd[1], LOW + (WALL - LOW) * smooth(62, 84, el), 0); gl.uniform3f(u.uCutC, fx + (cam.x - fx) * k, fz + (cam.z - fz) * k, R * (1 - k * .55));
    gl.uniform1f(u.uRise, rise * rise * (3 - 2 * rise)); gl.uniform4f(u.uBounds, b.x, b.z, b.w, b.d);
    if (cleanDirty && clock - cleanT > .3) { cleanDirty = 0; cleanT = clock; gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, cleanTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, CLEAN, CLEAN, gl.RED, gl.UNSIGNED_BYTE, cleanData); }
    [[atlasTex, 'uAtlas'], [keyTex, 'uKey'], [aoTex, 'uAO'], [cleanTex, 'uClean']].forEach(([t, name], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t as WebGLTexture); gl.uniform1i(u[name as string], i); });
    const pose = data.robot && sim?.pose, bot = pose && data.robot?.x != null || (pose && data.dock);
    gl.uniform3f(u.uBot, pose?.x ?? 0, pose?.z ?? 0, bot ? 12 : 0);
    gl.bindVertexArray(house.vao); gl.drawElements(gl.TRIANGLES, counts.solid, gl.UNSIGNED_INT, 0);
    if (pose && bot) {
      const a = pose.a * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      gl.uniformMatrix4fv(u.uModel, false, new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, pose.x, .2, pose.z, 1]));
      gl.uniform3f(u.uBot, 0, 0, 0);
      gl.bindVertexArray(botMesh.vao); gl.drawElements(gl.TRIANGLES, botData.index.length, gl.UNSIGNED_INT, 0);
      gl.uniformMatrix4fv(u.uModel, false, IDENT);
    }
    // glass and glow, last and without writing depth
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(house.vao); if (counts.total > counts.solid) gl.drawElements(gl.TRIANGLES, counts.total - counts.solid, gl.UNSIGNED_INT, counts.solid * 4);
    let n = 0;
    const sprite = (x: number, y: number, z: number, size: number, c: number[], flat = false) => { if (n >= MAX_S) return; SP.set([x, y, z, size], n * 4); SC.set([c[0], c[1], c[2], flat ? -1 : 1], n * 4); n++; };
    for (const f of layout.fixtures) {
      const g = glowing[f.emit]; if (!g || g.cur[0] + g.cur[1] + g.cur[2] < .01) continue;
      const big = f.kind === 'strip' ? 30 : f.kind === 'lamp' ? 26 : 30, gain = gains[f.room] * .2;
      sprite(f.x, f.y + 1, f.z, big, g.cur.map(v => Math.min(1, v) * gain));
    }
    // light falling out through the windows at night, onto the plinth
    const dark = 1 - smooth(.2, .7, m.key[1]);
    if (dark > .01) for (const g of layout.gaps) if (g.kind === 'window' && n < MAX_S - 2) {
      const w = layout.walls[g.wall], room = w.a || w.b, out = w.a ? 1 : -1, s = (g.from + g.to) / 2, f = [fills[room * 4], fills[room * 4 + 1], fills[room * 4 + 2]], o = out * 14;
      if (f[0] + f[1] + f[2] > .004) sprite(w.along === 'x' ? s : w.at + o, -.2, w.along === 'x' ? w.at + o : s, 40, f.map(v => v * .5 * dark), true);
    }
    if (pose && bot && data.robot) {
      const r = data.robot, state = r.error ? [1, .16, .12] : /clean|return|mop/i.test(r.state) ? [.18, .62, 1] : r.state === 'docked' ? [.12, .9, .36] : [.5, .5, .5];
      const beat = /clean|return|mop/i.test(r.state) ? .7 + .3 * Math.sin(clock * 4) : 1, a = pose.a * Math.PI / 180;
      sprite(pose.x + Math.cos(a) * 7, 8, pose.z + Math.sin(a) * 7, 6, state.map(v => v * .7 * beat));
    }
    if (n) {
      gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(glow.p); gl.bindVertexArray(empty);
      gl.uniformMatrix4fv(glow.u.uVP, false, vp); gl.uniform3fv(glow.u.uRight, right); gl.uniform3fv(glow.u.uUp, up); gl.uniform3fv(glow.u.uFwd, fwd);
      gl.uniform4fv(glow.u.uP, SP); gl.uniform4fv(glow.u.uC, SC); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.depthMask(true);
    placeTag();
  };

  const roomTag = () => {
    const id = sel?.startsWith('room:') ? Number(sel.slice(5)) : !sel && hover ? layout?.rooms[hover - 1]?.src.id : null;
    return data?.rooms.find(r => r.id === id) ?? null;
  };
  const placeTag = () => {
    const r = roomTag(), info = r && layout?.rooms.find(x => x.src.id === r.id);
    if (!r || !info) { if (tagKey) { tagKey = ''; tag.classList.remove('on'); } return; }
    const on = r.lights.filter(l => l.on).length, n = r.lights.length, picked = !!sel;
    // the room's own controls are under the model, so once it's picked all that's left to say is the hint
    const name = picked ? '' : r.name, sub = picked ? (n && clock < hint ? `Tap again to turn ${on ? 'off' : 'on'}` : '') : n ? (on ? `${on} of ${n} on` : 'Off') : '', key = name + sub;
    if (key !== tagKey) {
      tagKey = key; tag.textContent = ''; tag.classList.toggle('on', !!key);
      if (name) tag.append(Object.assign(document.createElement('b'), { textContent: name }));
      if (sub) tag.append(Object.assign(document.createElement('span'), { textContent: sub }));
    }
    const [x, y] = picked ? [box.clientWidth / 2, box.clientHeight - 24] : project(info.cx, 2, info.cz);
    tag.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -50%)`;
  };

  function frame(t: number) {
    raf = 0;
    const dt = last ? Math.min(.05, (t - last) / 1000) : .016;
    // nothing but the slow drift doesn't need every frame
    const idle = settled() && !sim?.pose.moving, asleep = idle && cam.idle > 40;   // an open tab left alone costs nothing
    if (idle && t - lastDraw < 30) { raf = requestAnimationFrame(frame); return; }
    if (last && !idle) { frames++; slow += t - last; if (frames >= 45) { if (slow / frames > 26 && scale > .55) { scale *= .8; size(); } frames = 0; slow = 0; } }
    const gap = lastDraw ? Math.min(.05, (t - lastDraw) / 1000) : dt; last = t; lastDraw = t;
    step(gap); draw();
    if (onScreen && !document.hidden && (!idle || (!calm && !asleep))) raf = requestAnimationFrame(frame);
  }
  const size = () => {
    const w = box.clientWidth; if (!w) return;
    if (!fill) box.style.height = !layout || layout.rooms.length ? Math.round(Math.max(w * .6, Math.min(w * .92, 300))) + 'px' : '0';
    const h = box.clientHeight; if (!h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2) * scale, cap = Math.min(1, Math.sqrt(2_400_000 / (w * h * dpr * dpr)));
    canvas.width = Math.round(w * dpr * cap); canvas.height = Math.round(h * dpr * cap); aspect = w / Math.max(1, h);
    draw(); kick();
  };
  const ro = new ResizeObserver(size); ro.observe(box);
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) { cam.idle = Math.min(cam.idle, 30); kick(); } }, { rootMargin: '80px' }); io.observe(box);
  const vis = () => { if (!document.hidden) { cam.idle = Math.min(cam.idle, 30); kick(); } };
  document.addEventListener('visibilitychange', vis);
  const hours = setInterval(() => { const h = hour ?? new Date().getHours() + new Date().getMinutes() / 60; if (Math.abs(h - bakedHour) > .08) { bakedHour = h; mood = moodAt(h); bakeKey(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); kick(); } }, 60_000);

  // ─ touch and mouse
  const at = (e: PointerEvent) => { const b = box.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  let pv = { x: 0, y: 0, t: 0 };
  const pdown = (e: PointerEvent) => {
    cam.ry += Math.sin(clock * .13) * 6 * cam.drift; cam.rx += Math.sin(clock * .09) * 1.4 * cam.drift; cam.drift = 0; cam.idle = 0; cam.vx = cam.vy = 0;
    down = { x: e.clientX, y: e.clientY, ry: cam.ry, rx: cam.rx, t: e.timeStamp }; dragged = false; pv = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const pmove = (e: PointerEvent) => {
    if (!down) {
      if (e.pointerType !== 'mouse') return;
      if (cam.idle > 30) { cam.idle = 30; kick(); }
      const [x, y] = at(e), p = pickAt(x, y), id = p?.startsWith('room:') ? layout?.rooms.find(r => `room:${r.src.id}` === p)?.i ?? 0 : 0;
      box.classList.toggle('over', !!p);
      if (id !== hover) { hover = id; kick(); }
      return;
    }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return;
    if (!dragged) { dragged = true; box.setPointerCapture(e.pointerId); box.classList.add('dragging'); hover = 0; }
    const dt = Math.max(1, e.timeStamp - pv.t) / 1000, ry = down.ry + dx * .35, rx = Math.max(-84, Math.min(-14, down.rx - dy * .25));
    cam.vy = cam.vy * .6 + (ry - cam.ry) / dt * .4; cam.vx = cam.vx * .6 + (rx - cam.rx) / dt * .4; cam.ry = ry; cam.rx = rx; pv = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (!raf) kick();
  };
  const pup = (e: PointerEvent) => {
    if (down && dragged) {
      if (e.timeStamp - pv.t > 90) cam.vx = cam.vy = 0;
      cam.vy = Math.max(-260, Math.min(260, cam.vy)); cam.vx = Math.max(-120, Math.min(120, cam.vx));
      if (calm) cam.vx = cam.vy = 0;
      try { if (remember) localStorage.setItem(`valet-view:${remember}`, JSON.stringify({ rx: cam.rx, ry: cam.ry })); } catch {}
    }
    down = null; box.classList.remove('dragging'); cam.idle = 0; kick();
  };
  const click = (e: MouseEvent) => {
    if (dragged) return;
    const b = box.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, lamp = sel?.startsWith('room:') ? lampAt(x, y) : '', hit = pickAt(x, y);
    if (lamp) return onLight?.(lamp);
    if (hit && hit === sel) { if (sel.startsWith('room:')) { hint = 0; onToggle?.(Number(sel.slice(5))); } return; }   // the room you're in: flick its lights
    api.select(hit); onPick?.(hit);
  };
  const leave = () => { hover = 0; box.classList.remove('over'); kick(); };
  if (draggable) {
    box.classList.add('draggable'); box.addEventListener('pointerdown', pdown); box.addEventListener('pointermove', pmove); box.addEventListener('pointerup', pup);
    box.addEventListener('pointercancel', pup); box.addEventListener('pointerleave', leave); box.addEventListener('click', click);
  }

  const lost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; };
  canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', () => onLost?.());
  const api: HomeStage = {
    update(d) {
      data = d;
      const s = shapeOf(d);
      const first = !layout;
      if (s !== shape) { shape = s; const h = hour ?? new Date().getHours() + new Date().getMinutes() / 60; bakedHour = h; mood = moodAt(h); rebuild(d); if (!first) rise = 1; if (first) size(); }
      retarget();
      kick();
    },
    select(id) {
      sel = id; hint = clock + 3.2;
      const r = id?.startsWith('room:') ? layout?.rooms.find(x => `room:${x.src.id}` === id) : undefined;
      if (r) { cam.tx = r.cx; cam.ty = 8; cam.tz = r.cz; cam.tzoom = Math.max(1.3, Math.min(2.6, 290 / Math.max(r.box.w, r.box.d))); }
      else if (id === 'robot' && sim) { cam.tx = sim.pose.x; cam.ty = 4; cam.tz = sim.pose.z; cam.tzoom = 2.4; }
      if (cam.k < .02 && id) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; cam.zoom = cam.tzoom; }
      kick();
    },
    destroy() {
      cancelAnimationFrame(raf); clearInterval(hours); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', vis);
      box.removeEventListener('pointerdown', pdown); box.removeEventListener('pointermove', pmove); box.removeEventListener('pointerup', pup);
      box.removeEventListener('pointercancel', pup); box.removeEventListener('pointerleave', leave); box.removeEventListener('click', click);
      canvas.removeEventListener('webglcontextlost', lost);
      gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.remove(); tag.remove(); box.classList.remove('gl', 'draggable', 'over');
    },
  };
  return api;
}
