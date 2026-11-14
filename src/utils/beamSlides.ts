// Full-screen frames that melt into each other along a band of light (plain
// WebGL, no dependencies).
//
// Frame 0 is the dark; frames 1..N are the <img> elements handed in. The scene
// is driven by one number, `pos` (0 .. N): at a whole number a frame stands
// still, and between two of them (the middle 40% of the way) a tilted beam
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
uniform float uView;
uniform float uP;
varying vec2 vUv;

const float BEAM_WIDTH = 0.12;
const float BEAM_GAIN = 1.2;
const float ZOOM = 1.12;
const float DRIFT = 0.05;
const vec2 PIVOT = vec2(0.5, 0.4);

// Fill the screen (cover). Where the picture is cropped vertically, the crop is
// shared between top and bottom (FOCUS_Y 0 = bottom kept, 1 = top kept), so the
// subject is not pushed into the blurred edge bands.
const float FOCUS_Y = 0.4;
vec2 fit(vec2 uv, float img) {
  vec2 s = uView > img ? vec2(1.0, img / uView) : vec2(uView / img, 1.0);
  return vec2((uv.x - 0.5) * s.x + 0.5, uv.y * s.y + (1.0 - s.y) * FOCUS_Y);
}

vec3 frame(sampler2D tex, float aspect, vec2 uv) {
  vec2 st = fit(uv, aspect);
  return texture2D(tex, vec2(clamp(st.x, 0.001, 0.999), 1.0 - clamp(st.y, 0.001, 0.999))).rgb;
}

void main() {
  vec2 uv = vUv;
  float p = clamp(uP, 0.0, 1.0);
  if (p <= 0.0) { gl_FragColor = vec4(frame(uFrom, uFromAspect, uv), 1.0); return; }
  if (p >= 1.0) { gl_FragColor = vec4(frame(uTo, uToAspect, uv), 1.0); return; }

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

  float reveal = smoothstep(head + BEAM_WIDTH * 0.3, head - BEAM_WIDTH * 0.3, x);
  float fade = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.92, 1.0, p));
  float glow = exp(-pow((x - head) / BEAM_WIDTH, 2.0)) * fade * BEAM_GAIN;
  float streak = tall
    ? exp(-abs(x - head) * 60.0) * exp(-abs(across - 0.5) * 1.5)
    : exp(-abs(uv.y - 0.5) * 60.0) * exp(-abs(uv.x - head) * 1.5);
  float flare = streak * fade * BEAM_GAIN * 0.6;

  vec3 col = mix(frame(uFrom, uFromAspect, outUv), frame(uTo, uToAspect, inUv), reveal);
  col *= 1.0 + glow * 0.3;
  col += vec3(1.0, 0.95, 0.85) * glow * 0.6 + vec3(0.75, 0.85, 1.0) * flare;
  gl_FragColor = vec4(col, 1.0);
}`;

const smooth = (v: number) => { v = v < 0 ? 0 : v > 1 ? 1 : v; return v * v * (3 - 2 * v); };

interface Frame { tex: WebGLTexture; aspect: number; ready: boolean; }

export function createBeamSlides(
	canvas: HTMLCanvasElement,
	images: HTMLImageElement[],
	onLost?: () => void,
): BeamSlides | null {
	const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false });
	if (!gl) return null;

	const compile = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
	};
	const vs = compile(gl.VERTEX_SHADER, VERT);
	const fs = compile(gl.FRAGMENT_SHADER, FRAG);
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
	const U = Object.fromEntries(['uFrom', 'uTo', 'uFromAspect', 'uToAspect', 'uView', 'uP']
		.map((n) => [n, gl.getUniformLocation(prog, n)]));
	gl.uniform1i(U.uFrom, 0);
	gl.uniform1i(U.uTo, 1);

	const makeTexture = (source: TexImageSource, w: number, h: number): Frame => {
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		return { tex, aspect: w / h, ready: true };
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

	const upload = (k: number) => {
		const img = images[k];
		if (dead || !img.naturalWidth) return;
		if (frames[k + 1]?.ready) return;
		frames[k + 1] = makeTexture(img, img.naturalWidth, img.naturalHeight);
		requestDraw();
	};
	images.forEach((img, k) => {
		frames[k + 1] = { tex: gl.createTexture()!, aspect: 1, ready: false };
		const go = () => upload(k);
		if (img.complete && img.naturalWidth) go();
		else img.addEventListener('load', go, { once: true });
		img.decode?.().then(go).catch(() => {});
		// (desktop Safari can fire `load` before a listener exists)
		setTimeout(go, 600);
		setTimeout(go, 2000);
	});

	const resize = () => {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
		const p = smooth((f - 0.3) / 0.4);   // holds for 30% either side of the beam
		const a = frames[i], b = frames[i + 1];
		gl!.activeTexture(gl!.TEXTURE0);
		gl!.bindTexture(gl!.TEXTURE_2D, (a.ready ? a : frames[0]).tex);
		gl!.activeTexture(gl!.TEXTURE1);
		gl!.bindTexture(gl!.TEXTURE_2D, (b.ready ? b : frames[0]).tex);
		gl!.uniform1f(U.uFromAspect, a.ready ? a.aspect : 1);
		gl!.uniform1f(U.uToAspect, b.ready ? b.aspect : 1);
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
