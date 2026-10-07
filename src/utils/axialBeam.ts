/**
 * Axial beam — volumetric shafts of light fanning out from a source outside
 * the frame, seen in perspective (tilt), breathing and drifting slowly; the
 * shaft nearest the cursor brightens. Plain WebGL port of React Bits'
 * AxialBeam (no three.js / R3F); the shader is unchanged apart from its
 * WebGL1 plumbing and the linear → sRGB output three.js added.
 *
 * Draws transparent: the glow is the alpha, so it lies over the page's own
 * black. Runs only while its section is on screen and the tab is visible;
 * capped at 24fps and DPR 1 on touch.
 */

export interface AxialBeamOpts {
	colors?: string[];
	originX?: number;
	originY?: number;
	angle?: number;
	tilt?: number;
	spread?: number;
	rays?: number;
	rayWidth?: number;
	reach?: number;
	swing?: number;
	flicker?: number;
	haze?: number;
	intensity?: number;
	speed?: number;
	interactive?: boolean;
	cursorBoost?: number;
	cursorWidth?: number;
	seed?: number;
	/** Max device pixel ratio (desktop). Touch is always 1. */
	dpr?: number;
}

export interface AxialBeamHandle {
	/** Change settings in place (e.g. aim on rotation) — the WebGL context
	 *  can't be made again on the same canvas once released. */
	update(opts: AxialBeamOpts): void;
	destroy(): void;
}

const MAX_COLORS = 4;
const MAX_RAYS = 16;
const FOCAL = 1.2;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const frag = (precision: string) => `
precision ${precision} float;
#define MAX_COLORS ${MAX_COLORS}
#define MAX_RAYS ${MAX_RAYS}

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uLab[MAX_COLORS];
uniform int uColorCount;
uniform vec2 uOrigin;
uniform vec2 uAxis;
uniform vec2 uHinge;
uniform vec3 uTilt;
uniform float uNear;
uniform float uSpread;
uniform int uRays;
uniform vec4 uRay[MAX_RAYS];
uniform float uReach;
uniform float uHaze;
uniform float uIntensity;
uniform float uSeed;

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

float gradientNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i), f);
  float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 lab = uLab[0];
  float scaled = t * float(uColorCount - 1);
  for (int i = 1; i < MAX_COLORS; i++) {
    if (i >= uColorCount) break;
    lab = mix(lab, uLab[i], smoothstep(0.0, 1.0, clamp(scaled - float(i - 1), 0.0, 1.0)));
  }
  return max(oklabToLinear(lab), 0.0);
}

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float t = uTime;
  vec2 point = (vUv - 0.5) * vec2(aspect, 1.0);
  vec2 side = vec2(uAxis.y, -uAxis.x);

  float visible = 1.0;
  float near = 1.0;
  if (abs(uTilt.x) > 0.0001) {
    vec2 rel = point - uHinge;
    float x = dot(rel, side);
    float y = dot(rel, uAxis);
    float xc = dot(-uHinge, side);
    float yc = dot(-uHinge, uAxis);
    float den = (y - yc) * uTilt.x + uTilt.z * uTilt.y;
    float k = (uTilt.z * uTilt.y - yc * uTilt.x) / max(den, 0.02);
    visible = smoothstep(0.0, 0.12, den);
    point = uHinge + (xc + k * (x - xc)) * side + ((yc + k * (y - yc)) / uTilt.y) * uAxis;
    near = clamp(1.0 / max(k, 0.05), 0.3, 3.0);
  }

  vec2 d = point - uOrigin;
  float r = length(d);
  float theta = atan(dot(d, side), dot(d, uAxis));
  float past = max(r - uNear, 0.0);
  float blur = 0.02 / max(r, 0.001);

  float rays = 0.0;
  for (int i = 0; i < MAX_RAYS; i++) {
    if (i >= uRays) break;
    vec4 ray = uRay[i];
    float width = sqrt(ray.y * ray.y + blur * blur);
    float offset = theta - ray.x;
    rays += exp(-offset * offset / (width * width)) * (ray.y / width) * ray.z * exp(-past / ray.w);
  }

  float haze = clamp(uHaze, 0.0, 2.0);
  float streaks = 1.0 + 0.22 * gradientNoise(vec2(theta * 18.0 + uSeed * 7.0, t * 0.1));
  float drift = gradientNoise(vec2(theta * 5.0 - uSeed * 3.0, past * 2.6 - t * 0.32));
  float body = 1.0 + 0.2 * min(haze, 1.5) * drift;
  float fanWidth = max(uSpread * 0.8, 0.02);
  float fan = exp(-theta * theta / (fanWidth * fanWidth));
  float fill = fan * exp(-past / max(uReach * 1.35, 0.02));
  float ambient = exp(-past / max(uReach * 3.0, 0.02)) * mix(0.1, 1.0, fan);

  float light = rays * streaks * body * 2.0;
  light += fill * body * 0.4 * haze;
  light += ambient * 0.02 * haze;
  light *= uIntensity * visible * sqrt(near);

  float tone = 1.0 - exp(-light * 0.3);
  vec3 hdr = palette(tone) * light * 1.3;

  // Transparent "add" blend: the glow is both colour and coverage.
  vec3 glow = 1.0 - exp(-hdr);
  float alpha = clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
  vec3 color = toSrgb(glow);
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  color += (dither - 0.5) / 255.0;
  // As in the original: colour not scaled by alpha — with a premultiplied
  // canvas that composites as light added over what's beneath.
  gl_FragColor = vec4(color, alpha);
}`;

// ── JS side, as in the original ──
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
const smoothstep = (e0: number, e1: number, v: number) => {
	const x = clamp((v - e0) / (e1 - e0), 0, 1);
	return x * x * (3 - 2 * x);
};
const hash = (v: number) => {
	const x = Math.sin(v * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
};
const wander = (v: number) => {
	const i = Math.floor(v);
	const f = v - i;
	const u = f * f * f * (f * (f * 6 - 15) + 10);
	const a = (hash(i) * 2 - 1) * f;
	const b = (hash(i + 1) * 2 - 1) * (f - 1);
	return (a + (b - a) * u) * 2;
};

const hexToLinear = (hex: string): [number, number, number] => {
	const h = hex.replace('#', '');
	const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
};
const toOklab = ([r, g, b]: [number, number, number]): [number, number, number] => {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
};

interface Geometry { originX: number; originY: number; axisX: number; axisY: number; hingeX: number; hingeY: number; sin: number; cos: number }

const findHinge = (ox: number, oy: number, ax: number, ay: number, aspect: number): [number, number] => {
	const half = [aspect / 2, 0.5];
	const origin = [ox, oy];
	const axis = [ax, ay];
	let enter = 0;
	let exit = Infinity;
	for (let i = 0; i < 2; i++) {
		if (Math.abs(axis[i]) < 1e-6) {
			if (origin[i] < -half[i] || origin[i] > half[i]) return [ox, oy];
			continue;
		}
		const a = (-half[i] - origin[i]) / axis[i];
		const b = (half[i] - origin[i]) / axis[i];
		enter = Math.max(enter, Math.min(a, b));
		exit = Math.min(exit, Math.max(a, b));
	}
	if (enter > exit) return [ox, oy];
	return [ox + ax * enter, oy + ay * enter];
};

const toPlane = (px: number, py: number, g: Geometry): [number, number] => {
	const { axisX, axisY, hingeX, hingeY, sin, cos } = g;
	if (Math.abs(sin) < 1e-4) return [px, py];
	const sideX = axisY, sideY = -axisX;
	const relX = px - hingeX, relY = py - hingeY;
	const x = relX * sideX + relY * sideY;
	const y = relX * axisX + relY * axisY;
	const xc = -hingeX * sideX - hingeY * sideY;
	const yc = -hingeX * axisX - hingeY * axisY;
	const den = Math.max((y - yc) * sin + FOCAL * cos, 0.02);
	const k = (FOCAL * cos - yc * sin) / den;
	const u = xc + k * (x - xc);
	const v = (yc + k * (y - yc)) / cos;
	return [hingeX + u * sideX + v * axisX, hingeY + u * sideY + v * axisY];
};

export function createAxialBeam(canvas: HTMLCanvasElement, section: HTMLElement, opts: AxialBeamOpts = {}): AxialBeamHandle | null {
	const s = {
		colors: ['#5227FF', '#B84DFF', '#FF9FFC', '#FFE6FA'],
		originX: 0.5, originY: -0.7, angle: 0, tilt: 20, spread: 34, rays: 10, rayWidth: 1,
		reach: 1.1, swing: 1, flicker: 0.6, haze: 1, intensity: 1, speed: 1,
		interactive: true, cursorBoost: 1, cursorWidth: 5, seed: 0, dpr: 1.5,
		...opts,
	};
	const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
	if (!gl) return null;

	const touch = window.matchMedia('(pointer: coarse)').matches;
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const highp = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) > 0;

	const shader = (type: number, src: string) => {
		const sh = gl.createShader(type)!;
		gl.shaderSource(sh, src);
		gl.compileShader(sh);
		return sh;
	};
	const prog = gl.createProgram()!;
	gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
	gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, frag(highp ? 'highp' : 'mediump')));
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
	gl.useProgram(prog);

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(prog, 'aPos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	const U = (n: string) => gl.getUniformLocation(prog, n);
	const u = {
		res: U('uResolution'), time: U('uTime'), lab: U('uLab'), colorCount: U('uColorCount'),
		origin: U('uOrigin'), axis: U('uAxis'), hinge: U('uHinge'), tilt: U('uTilt'), near: U('uNear'),
		spread: U('uSpread'), rays: U('uRays'), ray: U('uRay'), reach: U('uReach'), haze: U('uHaze'),
		intensity: U('uIntensity'), seed: U('uSeed'),
	};

	// Palette (constant).
	const count = Math.min(s.colors.length, MAX_COLORS);
	const lab = new Float32Array(MAX_COLORS * 3);
	for (let i = 0; i < MAX_COLORS; i++) lab.set(toOklab(hexToLinear(s.colors[Math.min(i, count - 1)])), i * 3);
	gl.uniform3fv(u.lab, lab);
	gl.uniform1i(u.colorCount, count);

	const rayData = new Float32Array(MAX_RAYS * 4);
	const glow = new Float32Array(MAX_RAYS);
	const pointer = { x: 0.5, y: 0.5, inside: false };
	let time = 12.5;

	const maxDpr = touch ? 1 : Math.min(window.devicePixelRatio || 1, s.dpr);
	let W = 0, H = 0;
	const resize = () => {
		const w = Math.round(canvas.offsetWidth * maxDpr);
		const h = Math.round(canvas.offsetHeight * maxDpr);
		if (!w || !h || (w === W && h === H)) return;
		W = canvas.width = w;
		H = canvas.height = h;
		gl.viewport(0, 0, W, H);
	};
	const ro = new ResizeObserver(() => { resize(); if (!raf) draw(1 / 60); });
	ro.observe(canvas);
	resize();

	const draw = (dt: number) => {
		if (!reduced && s.speed > 0) time += dt * s.speed;
		const t = time;
		const aspect = W / Math.max(H, 1);
		const roll = rad(s.angle);
		const tilt = rad(clamp(s.tilt, -60, 60));
		const originX = (s.originX - 0.5) * aspect;
		const originY = s.originY - 0.5;
		const axisX = Math.sin(roll);
		const axisY = Math.cos(roll);
		const [hingeX, hingeY] = findHinge(originX, originY, axisX, axisY, aspect);
		const g: Geometry = { originX, originY, axisX, axisY, hingeX, hingeY, sin: Math.sin(tilt), cos: Math.cos(tilt) };

		const tracking = s.interactive && !reduced && pointer.inside;
		let pointerAngle = 0;
		if (tracking) {
			const [px, py] = toPlane((pointer.x - 0.5) * aspect, pointer.y - 0.5, g);
			const dx = px - originX, dy = py - originY;
			pointerAngle = Math.atan2(dx * axisY - dy * axisX, dx * axisX + dy * axisY);
		}

		const spread = rad(clamp(s.spread, 2, 85));
		const n = Math.round(clamp(s.rays, 1, MAX_RAYS));
		const swing = clamp(s.swing, 0, 3);
		const flicker = clamp(s.flicker, 0, 1);
		const falloff = clamp(s.reach, 0.05, 4) / 3;
		const widthScale = clamp(s.rayWidth, 0.2, 4);
		const focusWidth = rad(clamp(s.cursorWidth, 1, 60));
		const boost = clamp(s.cursorBoost, 0, 3);
		for (let i = 0; i < n; i++) {
			const base = i * 7.31 + s.seed * 13 + 1.7;
			const hx = hash(base), hy = hash(base + 0.37), hz = hash(base + 0.71), hw = hash(base + 1.13);
			const slot = n > 1 ? ((i + 0.5 + (hx - 0.5) * 0.6) / n) * 2 - 1 : 0;
			const angle = spread * slot * 0.92 + wander(t * (0.07 + hy * 0.05) + hz * 61) * swing * spread * 0.1;
			const width = (0.024 + 0.07 * Math.pow(hw, 1.3)) * widthScale * (0.85 + 0.15 * wander(t * 0.05 + hx * 23));
			const breath = smoothstep(-0.7, 0.8, wander(t * (0.18 + hx * 0.12) + hy * 97));
			const level = (0.45 + 0.75 * Math.pow(hz, 1.2)) * (1 - flicker + flicker * (0.15 + 0.85 * breath));
			const off = angle - pointerAngle;
			const target = tracking ? Math.exp(-(off * off) / (focusWidth * focusWidth)) : 0;
			const rate = target > glow[i] ? 9 : 2.2;
			glow[i] += (target - glow[i]) * (1 - Math.exp(-dt * rate));
			rayData.set([angle, width, level * (1 + glow[i] * boost * 2.6), falloff * (0.7 + 0.6 * hy)], i * 4);
		}

		gl.uniform2f(u.res, W, H);
		gl.uniform1f(u.time, t);
		gl.uniform2f(u.origin, originX, originY);
		gl.uniform2f(u.axis, axisX, axisY);
		gl.uniform2f(u.hinge, hingeX, hingeY);
		gl.uniform3f(u.tilt, g.sin, g.cos, FOCAL);
		gl.uniform1f(u.near, Math.hypot(hingeX - originX, hingeY - originY));
		gl.uniform1f(u.spread, spread);
		gl.uniform1i(u.rays, n);
		gl.uniform4fv(u.ray, rayData);
		gl.uniform1f(u.reach, falloff);
		gl.uniform1f(u.haze, clamp(s.haze, 0, 2));
		gl.uniform1f(u.intensity, clamp(s.intensity, 0, 4));
		gl.uniform1f(u.seed, s.seed);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	};

	// Frame loop: only while the section is on screen and the tab visible;
	// 24fps on touch (a full-screen shader every frame is what touch Safari
	// stutters on). Reduced motion: a single still frame.
	const FRAME_MS = touch ? 1000 / 24 : 0;
	let raf = 0;
	let last = 0;
	let onScreen = true;
	const loop = (ts: number) => {
		raf = requestAnimationFrame(loop);
		if (FRAME_MS && ts - last < FRAME_MS) return;
		const dt = last ? Math.min(Math.max((ts - last) / 1000, 0), 0.05) : 1 / 60;
		last = ts;
		draw(dt);
	};
	const start = () => { if (!raf && !reduced && onScreen && !document.hidden) { last = 0; raf = requestAnimationFrame(loop); } };
	const stop = () => { cancelAnimationFrame(raf); raf = 0; };
	const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? start() : stop(); });
	io.observe(section);
	const onVis = () => (document.hidden ? stop() : start());
	document.addEventListener('visibilitychange', onVis);

	// Cursor (mouse only: a finger scrolling the hero shouldn't flash shafts).
	const onMove = (e: PointerEvent) => {
		if (e.pointerType !== 'mouse') return;
		const b = section.getBoundingClientRect();
		pointer.x = (e.clientX - b.left) / Math.max(b.width, 1);
		pointer.y = 1 - (e.clientY - b.top) / Math.max(b.height, 1);
		pointer.inside = true;
	};
	const onLeave = () => { pointer.inside = false; };
	if (s.interactive && !touch) {
		section.addEventListener('pointermove', onMove, { passive: true });
		section.addEventListener('pointerleave', onLeave, { passive: true });
	}

	draw(1 / 60);
	start();

	return {
		update(next: AxialBeamOpts) {
			Object.assign(s, next);
			if (!raf) draw(1 / 60);
		},
		destroy() {
			stop();
			io.disconnect();
			ro.disconnect();
			document.removeEventListener('visibilitychange', onVis);
			section.removeEventListener('pointermove', onMove);
			section.removeEventListener('pointerleave', onLeave);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
