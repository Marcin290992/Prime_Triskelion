// Frame border: a ribbon of light running round an element's edge, with a soft glow along the inside, slow
// drifting noise, and pulses that travel round from a point. A faithful port of the "FrameBorder" component
// (React + three.js) to plain TypeScript and raw WebGL2: the same shader, the same maths, no dependencies.
//
//   const fb = createFrameBorder(card, { colors: ['#FF3E1E', '#FFA37A'], radius: 14, glow: 0.4 });
//   fb.pulse(x, y)       a pulse from a point (px, from the element's top-left); no argument = a random point
//   fb.replay()          the draw-in again
//   fb.update({ ... })   change any option
//   fb.setOpacity(0..1)  fade the whole canvas (the page uses it to hold it back until it is wanted)
//   fb.destroy()
//
// `bleed` (px) lets the canvas spill past the element on every side, so the outer halo is not clipped (the
// element itself keeps its size). The canvas is positioned absolutely inside the element: give the element
// `position: relative` (or any positioned) and, if it lives in a 3D scene, lift `.frame-border-canvas` yourself.
// Draws only while on screen and visible; once, still, with reduced motion.

export interface FrameBorderOptions {
	colors?: [string, string];
	color?: string;
	/** the colour of the page behind it (for the glow to blend into); read from the parents when not given */
	backgroundColor?: string;
	radius?: number;
	lineWidth?: number;
	inset?: number;
	bleed?: number;
	glow?: number;
	glowWidth?: number;
	borderWidth?: number;
	falloff?: number;
	noise?: number;
	noiseStrength?: number;
	noiseScale?: number;
	noiseOctaves?: number;
	flowSpeed?: number;
	speed?: number;
	pulseSpeed?: number;
	idlePulses?: number;
	idleSpeed?: number;
	idleStrength?: number;
	intensity?: number;
	opacity?: number;
	gamma?: number;
	grain?: number;
	interactive?: boolean;
	intro?: boolean;
	paused?: boolean;
	dpr?: number;
}

export interface FrameBorderControl {
	pulse: (x?: number, y?: number) => void;
	replay: () => void;
	update: (opts: FrameBorderOptions) => void;
	setOpacity: (v: number) => void;
	destroy: () => void;
}

interface Path { line: number; outer: number; halfX: number; halfY: number; radius: number; reach: number; bend: number; hx: number; hy: number; perimeter: number }
interface Pulse { at: number; born: number }
interface Swell { at: number; rate: number; born: number; life: number; gain: number; fade: number }
type Triple = [number, number, number];

const MAX_PULSES = 8;
const MAX_IDLE = 6;
const INTRO_TIME = 2.6;
const FLOW_RATE = 34;
const DEFAULT_COLORS: [string, string] = ['#5227FF', '#FF9FFC'];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const finite = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const smooth = (e0: number, e1: number, v: number) => {
	const t = clamp((v - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap = (v: number) => ((v % 1) + 1) % 1;

const isClear = (v: string | undefined) => {
	const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
	return !t || t === 'transparent' || t === 'none' || t === 'auto';
};
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => {
	const v = clamp(c, 0, 1);
	return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};
const fromOklab = ([L, A, B]: Triple): Triple => {
	const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
	const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
	const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
	return [
		toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	];
};
const toOklab = ([r, g, b]: Triple): Triple => {
	const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
};
const toLch = ([l, a, b]: Triple): Triple => [l, Math.hypot(a, b), Math.atan2(b, a)];
const luminance = ([r, g, b]: Triple) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Any CSS colour string to an rgb() string through a 1px canvas (names, hex, hsl, ...).
let rgbContext: CanvasRenderingContext2D | null = null;
const toRgb = (value: string) => {
	if (!value || /^rgba?\(/i.test(value)) return value;
	if (!rgbContext) rgbContext = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!rgbContext) return value;
	rgbContext.fillStyle = '#010203';
	rgbContext.fillStyle = value;
	if (String(rgbContext.fillStyle) === '#010203' && value.trim().toLowerCase() !== '#010203') return value;
	rgbContext.clearRect(0, 0, 1, 1);
	rgbContext.fillRect(0, 0, 1, 1);
	const px = rgbContext.getImageData(0, 0, 1, 1).data;
	return px[3] === 255
		? `rgb(${px[0]}, ${px[1]}, ${px[2]})`
		: `rgba(${px[0]}, ${px[1]}, ${px[2]}, ${Math.round((px[3] / 255) * 1000) / 1000})`;
};

const parseColor = (value: string | undefined): Triple | null => {
	if (typeof value !== 'string' || isClear(value)) return null;
	const text = value.trim().toLowerCase();
	const hexm = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
	if (hexm) {
		let h = hexm[1];
		if (h.length === 3) h = h.split('').map((c) => c + c).join('');
		const n = parseInt(h, 16);
		return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
	}
	const fn = /^([a-z]+)\(([^)]*)\)$/.exec(text);
	if (fn) {
		const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
		const read = (index: number, scale: number) => {
			const part = parts[index] ?? '0';
			const number = Number.parseFloat(part);
			if (!Number.isFinite(number)) return 0;
			return part.endsWith('%') ? (number / 100) * scale : number;
		};
		const alphaIndex = fn[1] === 'color' ? 4 : 3;
		if (parts.length > alphaIndex && read(alphaIndex, 1) < 0.05) return null;
		if (fn[1] === 'rgb' || fn[1] === 'rgba')
			return [clamp(read(0, 255) / 255, 0, 1), clamp(read(1, 255) / 255, 0, 1), clamp(read(2, 255) / 255, 0, 1)];
		if (fn[1] === 'oklch') {
			const hue = (read(2, 360) * Math.PI) / 180;
			const chroma = read(1, 0.4);
			return fromOklab([read(0, 1), chroma * Math.cos(hue), chroma * Math.sin(hue)]);
		}
		if (fn[1] === 'oklab') return fromOklab([read(0, 1), read(1, 0.4), read(2, 0.4)]);
		if (fn[1] === 'color' && parts[0] === 'srgb')
			return [clamp(read(1, 1), 0, 1), clamp(read(2, 1), 0, 1), clamp(read(3, 1), 0, 1)];
		if (fn[1] === 'hsl' || fn[1] === 'hsla') return parseColor(toRgb(text));
	}
	const viaCanvas = toRgb(text);
	return viaCanvas !== text ? parseColor(viaCanvas) : null;
};

const along = (x: number, y: number, path: Path) => {
	const { hx, hy, bend } = path;
	const quarter = Math.PI / 2;
	const arc = quarter * bend;
	const qx = Math.abs(x) - hx;
	const qy = Math.abs(y) - hy;
	if (qx > 0 && qy > 0) {
		const a = Math.atan2(qy, qx);
		if (x >= 0 && y >= 0) return 2 * hx + (quarter - a) * bend;
		if (x >= 0) return 2 * hx + arc + 2 * hy + a * bend;
		if (y < 0) return 4 * hx + 2 * arc + 2 * hy + (quarter - a) * bend;
		return 4 * hx + 3 * arc + 4 * hy + a * bend;
	}
	if (qy >= qx) return y >= 0 ? x + hx : 3 * hx + 2 * arc + 2 * hy - x;
	return x >= 0 ? 2 * hx + arc + hy - y : 4 * hx + 3 * arc + 3 * hy + y;
};

const vertexSrc = `#version 300 es
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentSrc = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uSize;
uniform float uDpr;
uniform vec2 uHalf;
uniform float uRadius;
uniform vec4 uPath;
uniform float uLine;
uniform float uOuter;
uniform float uGlow;
uniform float uReach;
uniform float uNoise;
uniform float uCells;
uniform float uGrains;
uniform float uOctaves;
uniform vec4 uDrift;
uniform float uPhase;
uniform vec3 uLchA;
uniform vec3 uLchB;
uniform vec3 uBack;
uniform float uInk;
uniform float uExposure;
uniform float uIntensity;
uniform float uOpacity;
uniform float uGrain;
uniform float uSeed;
uniform float uLift;
uniform vec4 uIntro;
uniform vec4 uPulses[${MAX_PULSES}];
uniform vec2 uIdle[${MAX_IDLE}];
out vec4 fragColor;

const float TAU = 6.28318530718;
const float QUARTER = 1.57079632679;

float lattice(ivec2 c) {
  uvec2 q = uvec2(c) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (TAU / 4294967296.0);
}

float ribbon(vec2 p, int period) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  int x0 = (c.x + period * 64) % period;
  int x1 = (x0 + 1) % period;
  float a = lattice(ivec2(x0, c.y));
  float b = lattice(ivec2(x1, c.y));
  float e = lattice(ivec2(x0, c.y + 1));
  float g = lattice(ivec2(x1, c.y + 1));
  float va = dot(vec2(cos(a), sin(a)), f);
  float vb = dot(vec2(cos(b), sin(b)), f - vec2(1.0, 0.0));
  float ve = dot(vec2(cos(e), sin(e)), f - vec2(0.0, 1.0));
  float vg = dot(vec2(cos(g), sin(g)), f - vec2(1.0, 1.0));
  return mix(mix(va, vb, w.x), mix(ve, vg, w.x), w.y) * 1.414;
}

float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float along(vec2 p) {
  vec2 h = uPath.xy;
  float r = uPath.z;
  float arc = QUARTER * r;
  vec2 q = abs(p) - h;
  if (q.x > 0.0 && q.y > 0.0) {
    float a = atan(q.y, q.x);
    if (p.x >= 0.0 && p.y >= 0.0) return 2.0 * h.x + (QUARTER - a) * r;
    if (p.x >= 0.0) return 2.0 * h.x + arc + 2.0 * h.y + a * r;
    if (p.y < 0.0) return 4.0 * h.x + 2.0 * arc + 2.0 * h.y + (QUARTER - a) * r;
    return 4.0 * h.x + 3.0 * arc + 4.0 * h.y + a * r;
  }
  if (q.y >= q.x) return p.y >= 0.0 ? p.x + h.x : 3.0 * h.x + 2.0 * arc + 2.0 * h.y - p.x;
  return p.x >= 0.0 ? 2.0 * h.x + arc + h.y - p.y : 4.0 * h.x + 3.0 * arc + 3.0 * h.y + p.y;
}

float profile(float x, float reach) {
  float t = max(x, 0.0);
  float shape = 0.4 * exp(-t / (0.07 * reach)) + 0.6 * exp(-t / (0.28 * reach));
  return shape * (1.0 - smoothstep(0.35 * reach, reach, t));
}

vec3 fromLch(vec3 lch) {
  vec3 lab = vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
  vec3 lms = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.291485548) * lab;
  lms = lms * lms * lms;
  return max(mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.707614701) * lms, 0.0);
}

vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 p = gl_FragCoord.xy / uDpr - 0.5 * uSize;
  float fw = 1.0 / uDpr;
  float d = roundBox(p, uHalf, uRadius);
  float hw = 0.5 * uLine;
  if (-d - hw > uReach * 1.75 + 2.0) {
    fragColor = vec4(0.0);
    return;
  }

  float perimeter = uPath.w;
  float halfP = 0.5 * perimeter;
  float s = along(p);
  int cells = int(uCells + 0.5);
  float n = ribbon(vec2((s - uDrift.x) / perimeter * uCells, uDrift.z), cells);
  float weight = 1.0;
  if (uOctaves > 1.5) {
    float u2 = (s - uDrift.y) / perimeter * uCells * 2.0 + 3.0;
    n += 0.45 * ribbon(vec2(u2, uDrift.z * 1.7 + 11.0), cells * 2);
    weight += 0.45;
  }
  if (uOctaves > 2.5) {
    float u3 = (s - uDrift.y) / perimeter * uCells * 4.0 + 7.0;
    n += 0.2 * ribbon(vec2(u3, uDrift.z * 2.3 + 23.0), cells * 4);
    weight += 0.2;
  }
  n /= weight;
  float v = smoothstep(-0.55, 0.55, n) * 2.0 - 1.0;

  int grains = int(uGrains + 0.5);
  float depth = max(-roundBox(p, uHalf, uPath.z), 0.0);
  vec2 tp = vec2(s - uDrift.w, depth * 2.4) / perimeter * uGrains + vec2(0.0, uDrift.z * 0.8);
  float warp = ribbon(tp + vec2(0.0, 17.0), grains);
  float tex = ribbon(tp + vec2(0.6 * warp, 0.35 * warp), grains);

  float startDist = abs(mod(s - uIntro.x * perimeter + halfP, perimeter) - halfP);
  float drawn = 1.0 - smoothstep(uIntro.y - 4.0, uIntro.y + 4.0, startDist);
  float reveal = 1.0 - smoothstep(uIntro.z - 0.6 * halfP, uIntro.z, startDist);

  float swell = 0.0;
  float idleW = 0.022 * perimeter;
  for (int i = 0; i < ${MAX_IDLE}; i++) {
    vec2 bump = uIdle[i];
    if (bump.y <= 0.0) continue;
    float dist = abs(mod(s - bump.x * perimeter + halfP, perimeter) - halfP);
    swell += bump.y * exp(-dist * dist / (2.0 * idleW * idleW)) * (1.0 - smoothstep(2.0 * idleW, 3.0 * idleW, dist));
  }
  swell = min(swell, 1.5) * reveal;

  float inner = max(-d - hw, 0.0);
  float lineAmp = 1.0 + uNoise * 0.4 * v;
  float glowAmp = max(1.0 + uNoise * v, 0.0);
  float texture = max(1.0 + uNoise * tex * (0.45 + 0.55 * smoothstep(0.0, 0.4 * uReach, inner)), 0.0);
  float reach = uReach * (1.0 + uNoise * 0.25 * v) * (1.0 + uNoise * 0.15 * tex) * (1.0 + 0.2 * min(swell, 1.0));

  float width = max(uLine, fw);
  float line = clamp((0.5 * width - abs(d)) / fw + 0.5, 0.0, 1.0) * (uLine / width);
  float off = max(abs(d) - hw, 0.0);
  float spread = 1.5 + 1.2 * uLine;
  float halo = exp(-off / spread) * (1.0 - smoothstep(4.0 * spread, 10.0 * spread, off)) * min(uLine, 1.0);
  if (d > 0.0) halo *= 1.0 - smoothstep(0.0, max(uOuter, 0.001), off);

  vec2 edge = uHalf - hw - abs(p);
  float fx = profile(edge.x, reach);
  float fy = profile(edge.y, reach);
  float body = fx + fy - fx * fy;
  float tx = profile(edge.x, reach * 0.32);
  float ty = profile(edge.y, reach * 0.32);
  float tight = tx + ty - tx * ty;
  float inside = clamp(-d / fw + 0.5, 0.0, 1.0);

  float headW = 14.0 + 2.0 * uLine;
  float tailL = 0.16 * halfP;
  float meetW = 0.06 * perimeter;
  float pulseLine = 0.0;
  float pulseGlow = 0.0;
  for (int i = 0; i < ${MAX_PULSES}; i++) {
    vec4 pulse = uPulses[i];
    if (pulse.z <= 0.0 && pulse.w <= 0.0) continue;
    float dist = abs(mod(s - pulse.x * perimeter + halfP, perimeter) - halfP);
    float delta = dist - pulse.y * halfP;
    float head = exp(-delta * delta / (headW * headW));
    float wide = exp(-delta * delta / (25.0 * headW * headW));
    float tail = exp(min(delta, 0.0) / tailL) * (1.0 - smoothstep(-headW, headW, delta));
    pulseLine += pulse.z * (head + 0.55 * tail);
    pulseGlow += pulse.z * (0.9 * wide + 0.35 * tail);
    float meet = halfP - dist;
    pulseGlow += pulse.w * exp(-meet * meet / (meetW * meetW));
  }
  float introDelta = startDist - uIntro.y;
  pulseLine += uIntro.w * exp(-introDelta * introDelta / (headW * headW));
  pulseGlow += uIntro.w * 0.7 * exp(-introDelta * introDelta / (25.0 * headW * headW));

  float hue = 0.5 + 0.5 * cos(TAU * s / perimeter - uPhase + 0.9 * uNoise * v);
  vec3 lch = mix(uLchA, uLchB, hue);
  float lift = 1.0 + 0.12 * uLift;

  float lineLight = line * ((1.25 * lineAmp + 0.9 * swell) * drawn + 2.2 * pulseLine);
  float haloLight = halo * ((0.25 * lineAmp + 0.3 * swell) * drawn + 0.7 * pulseLine);
  float glowLight = inside * (body * uGlow * (glowAmp + 0.8 * swell) * texture * reveal + tight * pulseGlow);

  vec3 color;
  float alpha;
  if (uInk > 0.5) {
    vec3 ink = encode(fromLch(vec3(clamp(lch.x * 0.8, 0.36, 0.6), lch.y * 1.12 + 0.02, lch.z)));
    vec3 tint = encode(fromLch(vec3(clamp(lch.x * 0.92 + 0.06, 0.55, 0.78), lch.y * 1.05 + 0.01, lch.z)));
    float aLine = clamp(line * ((0.55 + 0.35 * lineAmp + 0.35 * swell) * drawn + 0.9 * pulseLine) * min(uIntensity, 1.5), 0.0, 1.0);
    float soft = (glowLight + haloLight * 0.6) * uIntensity * lift;
    float aGlow = clamp(pow(soft, 1.3) * 0.6, 0.0, 0.7);
    alpha = aLine + aGlow * (1.0 - aLine);
    color = alpha > 0.0001 ? (ink * aLine + tint * aGlow * (1.0 - aLine)) / alpha : tint;
  } else {
    vec3 tone = encode(fromLch(lch));
    tone /= max(max(tone.r, max(tone.g, tone.b)), 0.45);
    vec3 deep = encode(fromLch(vec3(lch.x * 0.86, lch.y * 1.3 + 0.02, lch.z)));
    deep /= max(max(deep.r, max(deep.g, deep.b)), 0.45);
    vec3 emission = (tone * (lineLight + haloLight) + deep * glowLight) * uIntensity * lift;
    vec3 shown = 1.0 - exp(-emission * uExposure);
    alpha = max(shown.r, max(shown.g, shown.b));
    color = alpha > 0.0001 ? shown * (1.0 - uBack) / alpha + uBack : uBack;
  }

  if (alpha > 0.002) {
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    color += (ign - 0.5) / 255.0;
    alpha += (fract(ign + 0.618034) - 0.5) / 255.0;
    if (uGrain > 0.0) {
      float g = lattice(ivec2(gl_FragCoord.xy) + ivec2(int(uSeed), 17)) / TAU;
      color += (g - 0.5) * uGrain * 0.12;
    }
  } else {
    alpha = 0.0;
  }
  // Premultiplied on purpose (the original wrote straight alpha): a straight-alpha canvas inside a 3D-transformed layer
  // is composited as if premultiplied on real GPUs, and every faint glow pixel then floods in full colour.
  float outA = clamp(alpha, 0.0, 1.0) * uOpacity;
  fragColor = vec4(clamp(color, 0.0, 1.0) * outA, outA);
}
`;


export function createFrameBorder(root: HTMLElement, options: FrameBorderOptions = {}): FrameBorderControl | null {
	const doc = root.ownerDocument;
	const view = doc.defaultView ?? window;
	const settings: Required<Pick<FrameBorderOptions, 'radius' | 'lineWidth' | 'inset' | 'bleed' | 'glow' | 'noiseScale' | 'flowSpeed' | 'pulseSpeed' | 'idlePulses' | 'idleSpeed' | 'idleStrength' | 'intensity' | 'opacity' | 'grain' | 'interactive' | 'intro' | 'paused' | 'dpr'>> &
		FrameBorderOptions = {
		radius: 16, lineWidth: 1, inset: 0, bleed: 0, glow: 0.5, noiseScale: 3, flowSpeed: 1, pulseSpeed: 1, idlePulses: 3,
		idleSpeed: 1, idleStrength: 1, intensity: 1, opacity: 1, grain: 0, interactive: false, intro: true, paused: false, dpr: 2,
		...options,
	};
	const motionQuery = view.matchMedia('(prefers-reduced-motion: reduce)');
	let reduced = motionQuery.matches;
	const onMotion = () => { reduced = motionQuery.matches; colorKey = ''; kick(); };
	motionQuery.addEventListener('change', onMotion);

	// The shader draws into a hidden WebGL canvas; what is on the page is an ordinary 2D canvas it is copied into. A
	// WebGL canvas composited inside a 3D-transformed layer can come out wrong on real GPUs (the glow floods in full
	// colour, or does not show at all); a plain bitmap layer does not have that problem.
	const glCanvas = doc.createElement('canvas');
	const canvas = doc.createElement('canvas');
	const ctx2d = canvas.getContext('2d');
	if (!ctx2d) return null;
	canvas.setAttribute('aria-hidden', 'true');
	canvas.className = 'frame-border-canvas';
	const bleed = () => Math.max(finite(settings.bleed, 0), 0);
	const placeCanvas = () => {
		const b = bleed();
		canvas.style.cssText = `position:absolute;left:${-b}px;top:${-b}px;width:calc(100% + ${b * 2}px);height:calc(100% + ${b * 2}px);display:block;pointer-events:none;opacity:${canvasOpacity};transition:opacity .35s ease;`;
	};
	let canvasOpacity = 1;
	placeCanvas();

	let gl: WebGL2RenderingContext | null = null;
	let prog: WebGLProgram | null = null;
	const loc: Record<string, WebGLUniformLocation | null> = {};
	const UNIFORMS = ['uSize', 'uDpr', 'uHalf', 'uRadius', 'uPath', 'uLine', 'uOuter', 'uGlow', 'uReach', 'uNoise', 'uCells', 'uGrains', 'uOctaves', 'uDrift', 'uPhase', 'uLchA', 'uLchB', 'uBack', 'uInk', 'uExposure', 'uIntensity', 'uOpacity', 'uGrain', 'uSeed', 'uLift', 'uIntro', 'uPulses', 'uIdle'];

	const initGL = () => {
		gl = glCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
		if (!gl) return false;
		const compile = (type: number, src: string) => {
			const sh = gl!.createShader(type)!;
			gl!.shaderSource(sh, src);
			gl!.compileShader(sh);
			if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) { console.warn('frameBorder shader:', gl!.getShaderInfoLog(sh)); return null; }
			return sh;
		};
		const vs = compile(gl.VERTEX_SHADER, vertexSrc);
		const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
		if (!vs || !fs) return false;
		prog = gl.createProgram()!;
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
		gl.useProgram(prog);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
		const aPos = gl.getAttribLocation(prog, 'position');
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
		gl.disable(gl.BLEND);
		gl.clearColor(0, 0, 0, 0);
		for (const n of UNIFORMS) loc[n] = gl.getUniformLocation(prog, n);
		return true;
	};
	if (!initGL()) return null;
	root.appendChild(canvas);

	let width = 0;
	let height = 0;
	let sized = false;
	let colorKey = '';
	let backgroundAt = -10;
	let flowTime = 0;
	let clock = 0;
	let idleClock = 0;
	let nextSwell = 0;
	let introTime = INTRO_TIME;
	let hover = 0;
	let hoverVelocity = 0;
	let hoverTarget = 0;
	let raf = 0;
	let last = 0;
	let visible = false;
	let destroyed = false;
	let lost = false;
	let press: { id: number; x: number; y: number; time: number } | null = null;
	let path: Path = { line: 1, outer: 0, halfX: 1, halfY: 1, radius: 0, reach: 1, bend: 0, hx: 1, hy: 1, perimeter: 4 };
	const pulses: Pulse[] = [];
	const swells: Swell[] = [];
	const pulseData = new Float32Array(MAX_PULSES * 4);
	const idleData = new Float32Array(MAX_IDLE * 2);
	// the values that were three.js uniforms
	const U = {
		back: [0.04, 0.04, 0.04] as Triple,
		ink: 0,
		lchA: [0, 0, 0] as Triple,
		lchB: [0, 0, 0] as Triple,
	};

	const readPage = (): Triple => {
		let node: HTMLElement | null = root;
		while (node) {
			const fill = parseColor(toRgb(view.getComputedStyle(node).backgroundColor));
			if (fill) return fill;
			node = node.parentElement;
		}
		const text = parseColor(toRgb(view.getComputedStyle(root).color));
		if (text) return luminance(text) > 0.5 ? [0.04, 0.04, 0.04] : [1, 1, 1];
		return view.matchMedia('(prefers-color-scheme: dark)').matches ? [0.04, 0.04, 0.04] : [1, 1, 1];
	};

	const syncColors = () => {
		const s = settings;
		const page = parseColor(s.backgroundColor) ?? readPage();
		const pair = Array.isArray(s.colors) && s.colors.length >= 2 ? s.colors : null;
		const key = [page.join(','), pair ? pair.join(',') : '', s.color ?? ''].join('|');
		if (key === colorKey) return;
		colorKey = key;
		U.back = page;
		U.ink = luminance(page) > 0.55 ? 1 : 0;
		let first: Triple;
		let second: Triple;
		if (pair) {
			first = toLch(toOklab(parseColor(pair[0]) ?? (parseColor(DEFAULT_COLORS[0]) as Triple)));
			second = toLch(toOklab(parseColor(pair[1]) ?? (parseColor(DEFAULT_COLORS[1]) as Triple)));
		} else if (parseColor(s.color)) {
			first = toLch(toOklab(parseColor(s.color) as Triple));
			second = [Math.min(first[0] + 0.05, 0.95), first[1], first[2] + 0.5];
		} else {
			first = toLch(toOklab(parseColor(DEFAULT_COLORS[0]) as Triple));
			second = toLch(toOklab(parseColor(DEFAULT_COLORS[1]) as Triple));
		}
		if (first[1] < 0.02) first[2] = second[2];
		if (second[1] < 0.02) second[2] = first[2];
		let turn = second[2] - first[2];
		turn = ((((turn + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
		U.lchA = [first[0], first[1], first[2]];
		U.lchB = [second[0], second[1], first[2] + turn];
	};

	const measure = (): Path => {
		const s = settings;
		const line = clamp(finite(s.lineWidth, 1), 0, 12);
		const short = Math.min(width, height);
		const outer = clamp(finite(s.inset, 0) + bleed(), 0, Math.max(short / 2 - line - 4, 0));
		const halfX = Math.max(width / 2 - outer - line / 2, 1);
		const halfY = Math.max(height / 2 - outer - line / 2, 1);
		const limit = Math.min(halfX, halfY);
		const radius = clamp(finite(s.radius, 16) - line / 2, 0, limit);
		let reach =
			s.glowWidth !== undefined ? finite(s.glowWidth, 110) : s.borderWidth !== undefined ? finite(s.borderWidth, 0.22) * width * 0.7 : 110;
		if (s.falloff !== undefined) reach *= Math.sqrt(6 / clamp(finite(s.falloff, 6), 1, 20));
		reach = clamp(reach, 4, limit * 0.5);
		const bend = Math.min(Math.max(radius, reach * 1.75), limit);
		const hx = Math.max(halfX - bend, 0);
		const hy = Math.max(halfY - bend, 0);
		return { line, outer, halfX, halfY, radius, reach, bend, hx, hy, perimeter: Math.max(4 * (hx + hy) + 2 * Math.PI * bend, 1) };
	};

	const readSize = () => {
		const w = Math.round(canvas.clientWidth);
		const h = Math.round(canvas.clientHeight);
		if (w < 2 || h < 2) { sized = false; return false; }
		const ratio = Math.min(view.devicePixelRatio || 1, clamp(finite(settings.dpr, 2), 0.5, 3));
		const bw = Math.round(w * ratio);
		if (sized && w === width && h === height && canvas.width === bw) return false;
		sized = true;
		width = w;
		height = h;
		canvas.width = glCanvas.width = bw;
		canvas.height = glCanvas.height = Math.round(h * ratio);
		gl!.viewport(0, 0, canvas.width, canvas.height);
		return true;
	};

	const travelTime = () => 1.5 / clamp(finite(settings.pulseSpeed, 1), 0.2, 4);

	const applyUniforms = () => {
		const s = settings;
		const g = gl!;
		path = measure();
		const p = path.perimeter;
		const scale = clamp(finite(s.noiseScale, 3), 0.2, 12);
		g.uniform2f(loc.uSize, width, height);
		g.uniform1f(loc.uDpr, canvas.width / Math.max(width, 1));
		g.uniform2f(loc.uHalf, path.halfX, path.halfY);
		g.uniform1f(loc.uRadius, path.radius);
		g.uniform4f(loc.uPath, path.hx, path.hy, path.bend, p);
		g.uniform1f(loc.uLine, path.line);
		g.uniform1f(loc.uOuter, path.outer);
		g.uniform1f(loc.uGlow, clamp(finite(s.glow, 0.5), 0, 3) * 0.6);
		g.uniform1f(loc.uReach, path.reach);
		g.uniform1f(loc.uNoise, clamp(finite(s.noise ?? s.noiseStrength, 0.6), 0, 1));
		g.uniform1f(loc.uCells, Math.max(2, Math.round((p * scale) / 1800)));
		g.uniform1f(loc.uGrains, Math.max(3, Math.round((p * scale) / (3 * 1.3 * path.reach))));
		g.uniform1f(loc.uOctaves, s.noiseOctaves !== undefined ? clamp(Math.round(finite(s.noiseOctaves, 2)), 1, 3) : 2);
		const travel = flowTime * FLOW_RATE;
		g.uniform4f(loc.uDrift, travel % p, (travel * 1.6) % p, flowTime * 0.09, (travel * 1.3) % p);
		g.uniform1f(loc.uPhase, ((flowTime * Math.PI * 2) / 70) % (Math.PI * 2));
		g.uniform3f(loc.uLchA, U.lchA[0], U.lchA[1], U.lchA[2]);
		g.uniform3f(loc.uLchB, U.lchB[0], U.lchB[1], U.lchB[2]);
		g.uniform3f(loc.uBack, U.back[0], U.back[1], U.back[2]);
		g.uniform1f(loc.uInk, U.ink);
		g.uniform1f(loc.uExposure, 1.5 * (s.gamma !== undefined ? Math.sqrt(clamp(finite(s.gamma, 2), 0.5, 5) / 2) : 1));
		g.uniform1f(loc.uIntensity, clamp(finite(s.intensity, 1), 0, 4));
		g.uniform1f(loc.uOpacity, clamp(finite(s.opacity, 1), 0, 1));
		g.uniform1f(loc.uGrain, clamp(finite(s.grain, 0), 0, 1));
		g.uniform1f(loc.uSeed, Math.floor(clock * 60) % 997);
		g.uniform1f(loc.uLift, clamp(hover, 0, 1.2));
		const halfP = p / 2;
		if (introTime < INTRO_TIME) {
			const lineK = easeInOut(clamp(introTime / 1.8, 0, 1));
			const glowK = easeInOut(clamp((introTime - 0.35) / 2.1, 0, 1));
			g.uniform4f(loc.uIntro, path.hx / p, lineK * (halfP + 60), glowK * (halfP * 1.6), smooth(0, 0.12, introTime) * (1 - smooth(1.3, 2.1, introTime)) * 0.9);
		} else {
			g.uniform4f(loc.uIntro, 0, 1e6, 1e6, 0);
		}
		const duration = travelTime();
		pulseData.fill(0);
		for (let i = 0; i < MAX_PULSES; i++) {
			const pulse = pulses[i];
			if (!pulse) continue;
			const age = clock - pulse.born;
			const progress = Math.min(age / duration, 1);
			const front = 1 - Math.pow(1 - progress, 1.7);
			const amp = smooth(0, 0.05, age) * (1 - 0.3 * progress) * (1 - smooth(duration, duration + 0.8, age));
			const meet = 0.9 * smooth(0.7 * duration, duration, age) * (1 - smooth(duration, duration + 1.2, age));
			pulseData.set([pulse.at, front, amp, meet], i * 4);
		}
		g.uniform4fv(loc.uPulses, pulseData);
		const strength = clamp(finite(s.idleStrength, 1), 0, 3);
		idleData.fill(0);
		for (let i = 0; i < MAX_IDLE; i++) {
			const swell = swells[i];
			if (!swell) continue;
			const envelope = Math.pow(Math.sin(Math.PI * clamp((idleClock - swell.born) / swell.life, 0, 1)), 2);
			idleData.set([swell.at, envelope * swell.gain * swell.fade * strength], i * 2);
		}
		g.uniform2fv(loc.uIdle, idleData);
	};

	const render = () => {
		if (!sized || !gl || lost) return;
		if (performance.now() - backgroundAt > 1000) {
			backgroundAt = performance.now();
			syncColors();
		}
		applyUniforms();
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		ctx2d.clearRect(0, 0, canvas.width, canvas.height);
		ctx2d.drawImage(glCanvas, 0, 0);
	};

	const spawnSwell = () => {
		const offset = Math.random();
		let best = offset;
		let bestGap = -1;
		for (let i = 0; i < 16; i++) {
			const candidate = wrap(offset + i / 16);
			let gap = 1;
			for (const other of swells) {
				const apart = Math.abs(candidate - other.at);
				gap = Math.min(gap, apart, 1 - apart);
			}
			if (gap > bestGap) { bestGap = gap; best = candidate; }
		}
		swells.push({ at: best, rate: 0.7 + Math.random() * 0.6, born: idleClock, life: 8 + Math.random() * 4, gain: 0.75 + Math.random() * 0.25, fade: 1 });
	};

	const wanted = () => !destroyed && !lost && visible && canvasOpacity > 0.001;
	const schedule = () => {
		if (!wanted() || raf) return;
		raf = requestAnimationFrame(frame);
	};
	function kick() { last = 0; schedule(); }

	const frame = (now: number) => {
		raf = 0;
		if (!wanted()) return;
		const s = settings;
		const dt = last && now - last < 100 ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60;
		last = now;
		const moving = !reduced && !s.paused;
		if (reduced || !s.interactive) hoverTarget = 0;
		const stiffness = 3.2;
		hoverVelocity += (-stiffness * stiffness * (hover - hoverTarget) - 2 * stiffness * hoverVelocity) * dt;
		hover += hoverVelocity * dt;
		if (moving) {
			const legacy = clamp(finite(s.speed, 0.1) / 0.1, 0, 20);
			flowTime += dt * clamp(finite(s.flowSpeed, 1), 0, 6) * legacy * (1 + 1.1 * hover);
		}
		clock += dt;
		if (introTime < INTRO_TIME) introTime = reduced ? INTRO_TIME : introTime + dt;
		const idleCount = reduced ? 0 : clamp(Math.round(finite(s.idlePulses, 3)), 0, MAX_IDLE);
		if (moving) {
			const step = dt * (1 + 0.6 * hover);
			const drift = step * clamp(finite(s.idleSpeed, 1), 0, 5) * 0.012;
			idleClock += step;
			for (let i = 0; i < swells.length; i++) {
				const swell = swells[i];
				swell.at = wrap(swell.at + drift * swell.rate);
				const surplus = i < swells.length - idleCount;
				swell.fade = surplus ? swell.fade * Math.exp(-step / 0.5) : Math.min(1, swell.fade + step * 2);
			}
			for (let i = swells.length - 1; i >= 0; i--)
				if (idleClock - swells[i].born > swells[i].life || swells[i].fade < 0.002) swells.splice(i, 1);
			if (introTime >= INTRO_TIME && swells.length < idleCount && idleClock >= nextSwell) {
				spawnSwell();
				nextSwell = idleClock + (10 / Math.max(idleCount, 1)) * (0.6 + Math.random() * 0.4);
			}
		}
		const duration = travelTime();
		for (let i = pulses.length - 1; i >= 0; i--) if (clock - pulses[i].born > duration + 1.25) pulses.splice(i, 1);
		readSize();
		render();
		const settling = Math.abs(hover - hoverTarget) > 0.001 || Math.abs(hoverVelocity) > 0.001;
		const animating = moving || settling || pulses.length > 0 || introTime < INTRO_TIME;
		if (animating && !doc.hidden) raf = requestAnimationFrame(frame);
		else last = 0;
	};

	const addPulse = (at: number) => {
		if (pulses.length >= MAX_PULSES) pulses.shift();
		pulses.push({ at: wrap(at), born: clock });
	};
	// x, y in px from the element's top-left corner
	const pulseAt = (x: number, y: number) => {
		if (!sized) return;
		path = measure();
		const b = bleed();
		const position = along(x + b - width / 2, height / 2 - (y + b), path);
		addPulse(position / path.perimeter);
	};

	const isControl = (target: EventTarget | null) => {
		const element = target as Element | null;
		return !!element && typeof element.closest === 'function' && !!element.closest('a,button,input,textarea,select,label,summary,[role=button],[contenteditable=true]');
	};
	const fire = (event: PointerEvent) => {
		const s = settings;
		if (!s.interactive || reduced || s.paused) return;
		const box = root.getBoundingClientRect();
		if (box.width <= 0 || box.height <= 0 || !sized) return;
		pulseAt(((event.clientX - box.left) / box.width) * root.clientWidth, ((event.clientY - box.top) / box.height) * root.clientHeight);
		schedule();
	};
	const onPointerDown = (event: PointerEvent) => {
		if (!event.isPrimary || isControl(event.target)) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		if (event.pointerType === 'touch') { press = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() }; return; }
		fire(event);
	};
	const onPointerUp = (event: PointerEvent) => {
		const current = press;
		press = null;
		if (!current || current.id !== event.pointerId) return;
		if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) return;
		if (performance.now() - current.time > 600) return;
		fire(event);
	};
	const onPointerMove = (event: PointerEvent) => {
		if (event.pointerType === 'touch') return;
		hoverTarget = settings.interactive && !reduced ? 1 : 0;
		schedule();
	};
	const onPointerLeave = (event: PointerEvent) => {
		if (event.pointerType === 'touch') return;
		hoverTarget = 0;
		schedule();
	};
	const onPointerCancel = () => { press = null; };
	const onVisibility = () => kick();
	const onLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; };
	const onRestored = () => {
		if (!initGL()) return;
		lost = false;
		colorKey = '';
		sized = false;
		readSize();
		kick();
	};

	const resizeObserver = new ResizeObserver(() => { if (readSize()) { render(); schedule(); } });
	const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; kick(); }, { rootMargin: '120px' });

	root.addEventListener('pointerdown', onPointerDown);
	root.addEventListener('pointerup', onPointerUp);
	root.addEventListener('pointermove', onPointerMove);
	root.addEventListener('pointerleave', onPointerLeave);
	root.addEventListener('pointercancel', onPointerCancel);
	doc.addEventListener('visibilitychange', onVisibility);
	glCanvas.addEventListener('webglcontextlost', onLost);
	glCanvas.addEventListener('webglcontextrestored', onRestored);
	resizeObserver.observe(root);
	intersection.observe(root);
	if (settings.intro && !reduced) introTime = 0;
	flowTime = reduced ? 14 : 0;
	readSize();
	syncColors();

	return {
		pulse: (x, y) => {
			if (reduced || !sized) return;
			if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) addPulse(Math.random());
			else pulseAt(x, y);
			schedule();
		},
		replay: () => {
			if (reduced) return;
			introTime = 0;
			swells.length = 0;
			nextSwell = idleClock;
			kick();
		},
		update: (opts) => {
			Object.assign(settings, opts);
			placeCanvas();
			backgroundAt = -10;
			readSize();
			kick();
		},
		setOpacity: (v) => {
			canvasOpacity = clamp(v, 0, 1);
			canvas.style.opacity = canvasOpacity.toFixed(3);
			if (canvasOpacity > 0.001) { readSize(); if (reduced) render(); kick(); }
		},
		destroy: () => {
			destroyed = true;
			cancelAnimationFrame(raf);
			resizeObserver.disconnect();
			intersection.disconnect();
			motionQuery.removeEventListener('change', onMotion);
			root.removeEventListener('pointerdown', onPointerDown);
			root.removeEventListener('pointerup', onPointerUp);
			root.removeEventListener('pointermove', onPointerMove);
			root.removeEventListener('pointerleave', onPointerLeave);
			root.removeEventListener('pointercancel', onPointerCancel);
			doc.removeEventListener('visibilitychange', onVisibility);
			glCanvas.removeEventListener('webglcontextlost', onLost);
			glCanvas.removeEventListener('webglcontextrestored', onRestored);
			canvas.remove();
			gl?.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
