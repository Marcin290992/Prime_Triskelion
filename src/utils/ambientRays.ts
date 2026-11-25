// The small light that comes back in the dark pauses (phones and tablets): the hero's own
// light (same shader as HeroSection's initLegacyRays: the cone from the top, the ribs that
// shimmer) but SMALLER (its reach grows with `level`, never to the hero's full reach) and
// dimmer. It goes out in the hero, and returns here once the manifesto is pinned.
//
// Cheap by design: the buffer is a fraction of the screen (the light is soft, nobody sees the
// pixels), ~20 fps, and it draws only while level > 0 (the RAF is stopped otherwise).
import { createLightRays } from './lightRays';

const VERT = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = (highp: boolean) => `
precision ${highp ? 'highp' : 'mediump'} float;
uniform float iTime; uniform vec2 iResolution; uniform float reveal; uniform float gain;
const vec2 rayDir = vec2(0.0, 1.0);

float rayStrength(vec2 src, vec2 coord, float sA, float sB, float spd) {
	vec2  s2c = coord - src;
	float da  = dot(normalize(s2c), rayDir);
	float sf  = pow(max(da, 0.0), 1.0 / max(0.8 * (0.7 + 0.3 * reveal), 0.001));
	float d   = length(s2c);
	float md  = max(iResolution.x * 3.0 * reveal, 1.0);
	float lf  = clamp((md - d) / md, 0.0, 1.0);
	float ff  = clamp((iResolution.x - d) / iResolution.x, 0.5, 1.0);
	float bs  = clamp(
		(0.45 + 0.15 * sin(da * sA + iTime * spd)) +
		(0.3  + 0.2  * cos(-da * sB + iTime * spd)),
		0.0, 1.0);
	return bs * lf * ff * sf;
}

void main() {
	vec2 coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);
	vec2 src = vec2(iResolution.x * 0.5, -iResolution.y * 0.18);
	float r1 = rayStrength(src, coord, 36.2214, 21.11349, 1.5);
	float r2 = rayStrength(src, coord, 22.3991, 18.0234, 1.1);
	float f = r1 * 0.5 + r2 * 0.4;
	float br = 1.0 - (coord.y / iResolution.y);
	vec3 c = vec3(f * (0.1 + br * 0.8), f * (0.3 + br * 0.6), f * (0.5 + br * 0.5));
	gl_FragColor = vec4(c * gain, f * gain);
}
`;

export interface AmbientRays {
	/** 0 = out (nothing drawn), 1 = the small light at its fullest. */
	setLevel(level: number): void;
	resize(): void;
	destroy(): void;
}

// Desktop: the home hero's own light (utils/lightRays.ts, the one with the visible ribs), smaller and dimmer,
// so the pause light looks like the hero's and not like the phone shader.
function createDesktopAmbient(canvas: HTMLCanvasElement): AmbientRays | null {
	let level = 0;
	const rays = createLightRays(canvas, {
		reveal: () => 0.55 * Math.sqrt(level),   // "smaller": about half the hero's reach, opening as it comes in
		intensity: 0.8,                          // and dimmer than the hero's 1.0
		rayLength: 5.25,
		lightSpread: 1.5,
		rayDensity: 1,
		raySharpness: 0.35,
		glow: 0.4,
		haze: 0.2,
		maxDevicePixelRatio: 1,
		frameMs: 1000 / 30,
		// Interactive like the hero's light (the listeners are on window, so the canvas can stay click-through):
		// it leans toward the cursor, the cursor casts a soft shadow, a click sends a pulse.
		mouseInfluence: 0.1,
		cursorShadow: true,
		clickPulse: true,
	});
	if (!rays) return null;
	let running = false;
	return {
		setLevel(v) {
			level = Math.max(0, Math.min(1, v));
			canvas.style.opacity = level.toFixed(3);
			canvas.style.visibility = level <= 0.002 ? 'hidden' : 'visible';
			if (level > 0.002 && !running && !document.hidden) { running = true; rays.start(); }
			else if (level <= 0.002 && running) { running = false; rays.stop(); }
		},
		resize: () => rays.resize(),
		destroy: () => rays.destroy(),
	};
}

export function createAmbientRays(canvas: HTMLCanvasElement): AmbientRays | null {
	if (!window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches) return createDesktopAmbient(canvas);
	const gl = (canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, premultipliedAlpha: true }) ||
		canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
	if (!gl) return null;

	const highp = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) > 0;
	const sh = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return s;
	};
	const prog = gl.createProgram()!;
	gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
	gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG(highp)));
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
	gl.useProgram(prog);

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(prog, 'a_pos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
	const uTime = gl.getUniformLocation(prog, 'iTime');
	const uRes = gl.getUniformLocation(prog, 'iResolution');
	const uReveal = gl.getUniformLocation(prog, 'reveal');
	const uGain = gl.getUniformLocation(prog, 'gain');

	const SCALE = 0.5;       // buffer = half the CSS size
	const MAX_REVEAL = 0.55; // "smaller": about half the hero light's reach
	const GAIN = 1.5;        // and dimmer than the hero's 2.1
	const FRAME_MS = 1000 / 20;
	let W = 1, H = 1, level = 0, raf = 0, last = 0;

	const resize = () => {
		W = Math.max(1, Math.round(canvas.clientWidth * SCALE));
		H = Math.max(1, Math.round(canvas.clientHeight * SCALE));
		if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
		gl.viewport(0, 0, W, H);
	};
	const draw = (ts: number) => {
		raf = 0;
		if (level <= 0.002 || document.hidden) return;
		raf = requestAnimationFrame(draw);
		if (ts - last < FRAME_MS) return;
		last = ts;
		gl.uniform1f(uTime, ts * 0.001);
		gl.uniform2f(uRes, W, H);
		// it opens as it comes in, so it is a light being lit, not a layer fading
		gl.uniform1f(uReveal, MAX_REVEAL * Math.sqrt(level));
		gl.uniform1f(uGain, GAIN);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	};
	const onVis = () => { if (!document.hidden && level > 0.002 && !raf) raf = requestAnimationFrame(draw); };
	document.addEventListener('visibilitychange', onVis);
	resize();

	return {
		setLevel(v) {
			level = Math.max(0, Math.min(1, v));
			canvas.style.opacity = level.toFixed(3);
			canvas.style.visibility = level <= 0.002 ? 'hidden' : 'visible';
			if (level > 0.002 && !raf && !document.hidden) raf = requestAnimationFrame(draw);
		},
		resize,
		destroy() {
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			document.removeEventListener('visibilitychange', onVis);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
