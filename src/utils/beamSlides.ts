// Full-screen frames that melt into each other along a band of light (plain
// WebGL, no dependencies).
//
// Frame 0 is the dark; frames 1..N are the <img> elements handed in. The scene
// is driven by one number, `pos` (0 .. N): at a whole number a frame stands
// still, and between two of them (the middle 70% of the way) a tilted beam
// sweeps across and swaps one for the other. On a landscape screen the beam
// runs left to right, on a portrait one (phones) top to bottom.
//
// Frames are drawn only when `pos` changes — no permanent rAF loop. If WebGL
// is missing or its context is lost, `createBeamSlides` returns null / calls
// `onLost` and the caller falls back to plain cross-fading.

export interface BeamSlides {
	setPos(pos: number): void;
	resize(): void;
	destroy(): void;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uFromAspect;
uniform float uToAspect;
uniform vec2 uFromFocus;
uniform vec2 uToFocus;
uniform float uView;
uniform float uP;
varying vec2 vUv;

const float BEAM_WIDTH = 0.12;
const float BEAM_GAIN = 0.6;
const float ZOOM = 1.12;
const float DRIFT = 0.05;
const vec2 PIVOT = vec2(0.5, 0.4);

// Fill the screen (cover). Where the picture is cropped, the crop is shared
// around the picture's own focus point (x: 0 left .. 1 right, y: 0 bottom .. 1
// top), so the subject stays in view on any screen shape and is not pushed into
// the blurred edge bands.
vec2 fit(vec2 uv, float img, vec2 focus) {
  vec2 s = uView > img ? vec2(1.0, img / uView) : vec2(uView / img, 1.0);
  return vec2(uv.x * s.x + (1.0 - s.x) * focus.x, uv.y * s.y + (1.0 - s.y) * focus.y);
}

vec3 frame(sampler2D tex, float aspect, vec2 focus, vec2 uv) {
  vec2 st = fit(uv, aspect, focus);
  return texture2D(tex, vec2(clamp(st.x, 0.001, 0.999), 1.0 - clamp(st.y, 0.001, 0.999))).rgb;
}

// The picture with its colours split along n by s (a fraction of the screen): three
// reads, one per channel. Below half a pixel there is nothing to see, so one read.
vec3 frameSplit(sampler2D tex, float aspect, vec2 focus, vec2 uv, vec2 n, float s) {
#ifdef LOW_FRAGMENT_COST
  return frame(tex, aspect, focus, uv);
#else
  if (s < 0.0004) return frame(tex, aspect, focus, uv);
  return vec3(
    frame(tex, aspect, focus, uv + n * s).r,
    frame(tex, aspect, focus, uv).g,
    frame(tex, aspect, focus, uv - n * s).b);
#endif
}

void main() {
  vec2 uv = vUv;
  float p = clamp(uP, 0.0, 1.0);
  if (p <= 0.0) { gl_FragColor = vec4(frame(uFrom, uFromAspect, uFromFocus, uv), 1.0); return; }
  if (p >= 1.0) { gl_FragColor = vec4(frame(uTo, uToAspect, uToFocus, uv), 1.0); return; }

  bool tall = uView < 1.0;
  float along = tall ? uv.y : uv.x;
  float across = tall ? uv.x : uv.y;
  float tilt = tall ? uView * 0.35 : 1.0;
  float x = along + (across - 0.5) * tilt;
  float reach = abs(tilt) * 0.5 + 2.5 * BEAM_WIDTH;
  float head = mix(-reach, 1.0 + reach, p);

  // the leaving frame swells and lifts; the arriving one settles up from below
  vec2 outUv = PIVOT + (uv - PIVOT) / mix(1.0, ZOOM, p) - vec2(0.0, DRIFT * p);
  vec2 inUv = PIVOT + (uv - PIVOT) / mix(ZOOM, 1.0, p) + vec2(0.0, DRIFT * (1.0 - p));

  // The Forge light beam: a hot narrow core inside a wide halo, both zero at rest
  // (env), a lens-like warp of the picture along the beam, a colour split inside
  // it, and the pictures lit up (exposure) as it passes. (x * x, not pow(x, 2.0):
  // pow of a negative is undefined in GLSL and flickers on some GPUs.)
  float env = sin(p * 3.14159265);
  float d = x - head;
  float dc = d / 0.04;
  float dh = d / 0.13;
  float core = exp(-dc * dc) * env;
  float halo = exp(-dh * dh) * env;
  float beam = (core * 1.2 + halo * 0.5) * BEAM_GAIN;
  float reveal = 1.0 - smoothstep(head - 0.12, head + 0.12, x);

  vec2 n = tall ? normalize(vec2(tilt, 1.0)) : normalize(vec2(1.0, tilt));
  vec2 warp = n * d * halo * 0.08;
  float ca = core * 0.004 + halo * 0.002;
  vec2 uo = outUv + warp;
  vec2 ui = inUv - warp * 1.25;
  // Only what is seen is read: far from the beam one picture needs one texture read
  // (not six), and the colour split costs three reads only where it can be seen.
  // (The shader used to read both pictures three times at every pixel.)
  vec3 a = vec3(0.0);
  vec3 b = vec3(0.0);
  if (reveal < 0.999) a = frameSplit(uFrom, uFromAspect, uFromFocus, uo, n, ca);
  if (reveal > 0.001) b = frameSplit(uTo, uToAspect, uToFocus, ui, n, ca * 1.2);
  vec3 base = mix(a, b, reveal);

  vec3 tint = mix(vec3(0.82, 0.9, 1.0), vec3(1.0, 0.93, 0.82), core);
  // the picture is lit, not burnt out: about twice as bright at the very core, a little white on top
  vec3 col = base * (1.0 + beam * 1.0) + tint * pow(max(beam, 0.0), 1.6) * 0.3;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;


interface Frame { tex: WebGLTexture; aspect: number; ready: boolean; fx: number; fy: number; }

export function createBeamSlides(
	canvas: HTMLCanvasElement,
	images: HTMLImageElement[],
	onLost?: () => void,
	// where in each step (0..1) the beam starts and ends; the rest is a still
	// frame. A wider rest gives a finger time to land on the text and the button.
	range: [number, number] = [0.15, 0.85],
): BeamSlides | null {
	const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false });
	if (!gl) return null;
	const lowCostAndroidChrome = /Android/i.test(navigator.userAgent) && /Chrome\/\d+/i.test(navigator.userAgent);

	const compile = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
	};
	const vs = compile(gl.VERTEX_SHADER, VERT);
	const fs = compile(gl.FRAGMENT_SHADER, `${lowCostAndroidChrome ? '#define LOW_FRAGMENT_COST\n' : ''}${FRAG}`);
	if (!vs || !fs) return null;
	const prog = gl.createProgram()!;
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
	gl.useProgram(prog);

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(prog, 'aPos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
	const U = Object.fromEntries(['uFrom', 'uTo', 'uFromAspect', 'uToAspect', 'uFromFocus', 'uToFocus', 'uView', 'uP']
		.map((n) => [n, gl.getUniformLocation(prog, n)]));
	gl.uniform1i(U.uFrom, 0);
	gl.uniform1i(U.uTo, 1);

	const makeTexture = (source: TexImageSource, w: number, h: number, fx = 0.5, fy = 0.4): Frame => {
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		return { tex, aspect: w / h, ready: true, fx, fy };
	};

	// frame 0: the dark (1x1 black); the rest fill in as their images decode
	const black = document.createElement('canvas');
	black.width = black.height = 1;
	const bx = black.getContext('2d');
	if (bx) { bx.fillStyle = '#000'; bx.fillRect(0, 0, 1, 1); }
	const frames: Frame[] = [makeTexture(black, 1, 1)];
	let pos = 0;
	let raf = 0;
	let dead = false;

	// each picture says where its subject is (data-fx / data-fy)
	const focusOf = (img: HTMLImageElement, axis: 0 | 1) => {
		const v = parseFloat(axis === 0 ? img.dataset.fx ?? '' : img.dataset.fy ?? '');
		return Number.isFinite(v) ? v : axis === 0 ? 0.5 : 0.4;
	};
	const upload = (k: number) => {
		const img = images[k];
		if (dead || !img.naturalWidth) return;
		if (frames[k + 1]?.ready) return;
		frames[k + 1] = makeTexture(img, img.naturalWidth, img.naturalHeight, focusOf(img, 0), focusOf(img, 1));
		requestDraw();
	};
	images.forEach((img, k) => {
		frames[k + 1] = { tex: gl.createTexture()!, aspect: 1, ready: false, fx: 0.5, fy: 0.4 };
		const go = () => upload(k);
		if (img.complete && img.naturalWidth) go();
		else img.addEventListener('load', go, { once: true });
		img.decode?.().then(go).catch(() => {});
		// (desktop Safari can fire `load` before a listener exists)
		setTimeout(go, 600);
		setTimeout(go, 2000);
	});

	const resize = () => {
		// the shader reads six textures a pixel: capped as in the test file (a phone's 3x screen
		// would cost 9x the pixels for nothing the eye can see in motion)
		const coarse = window.matchMedia('(pointer: coarse)').matches;
		const lite = /[?&]lite=(all|[^&]*dpr)/.test(window.location.search);   // ?lite=dpr: diagnostics, see SelectedWorkSection
		const dpr = lite || lowCostAndroidChrome ? 1 : Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.75);
		const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
		const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
		if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
		gl.viewport(0, 0, w, h);
		gl.uniform1f(U.uView, canvas.clientWidth / Math.max(1, canvas.clientHeight));
		draw();   // a resized canvas is cleared: draw again in this very frame
	};

	function requestDraw() { if (!raf && !dead) raf = requestAnimationFrame(draw); }

	function draw() {
		raf = 0;
		if (dead) return;
		const last = frames.length - 1;
		const i = Math.min(Math.floor(pos), last - 1);
		const f = pos - i;
		// linear: the easing comes from the scroll (the snap's ease and the glide), as
		// in the test file; a smoothstep on top made the light crawl at both ends
		const p = Math.min(1, Math.max(0, (f - range[0]) / (range[1] - range[0])));
		const a = frames[i], b = frames[i + 1];
		gl!.activeTexture(gl!.TEXTURE0);
		gl!.bindTexture(gl!.TEXTURE_2D, (a.ready ? a : frames[0]).tex);
		gl!.activeTexture(gl!.TEXTURE1);
		gl!.bindTexture(gl!.TEXTURE_2D, (b.ready ? b : frames[0]).tex);
		gl!.uniform1f(U.uFromAspect, a.ready ? a.aspect : 1);
		gl!.uniform1f(U.uToAspect, b.ready ? b.aspect : 1);
		gl!.uniform2f(U.uFromFocus, a.ready ? a.fx : 0.5, a.ready ? a.fy : 0.4);
		gl!.uniform2f(U.uToFocus, b.ready ? b.fx : 0.5, b.ready ? b.fy : 0.4);
		gl!.uniform1f(U.uP, p);
		gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
	}

	const lost = (e: Event) => { e.preventDefault(); dead = true; onLost?.(); };
	canvas.addEventListener('webglcontextlost', lost);

	resize();

	return {
		setPos(v: number) {
			const m = images.length;
			const n = v < 0 ? 0 : v > m ? m : v;
			if (n === pos) return;
			pos = n;
			requestDraw();
		},
		resize,
		destroy() {
			dead = true;
			if (raf) cancelAnimationFrame(raf);
			canvas.removeEventListener('webglcontextlost', lost);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
