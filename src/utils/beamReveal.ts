// A picture revealed by a band of light (plain WebGL, no dependencies).
//
// The <img> in the page is drawn into a canvas that covers the host box
// (object-fit: cover, centred). As the progress goes 0 -> 1 a tilted beam
// sweeps across the box left to right: behind it the picture is there (it
// settles from a slight zoom), ahead of it there is only the dark. The beam
// itself glows warm with a thin cool streak, and has passed completely by 1,
// where the canvas shows the plain picture.
//
// Frames are drawn only when the progress changes — no permanent rAF loop.
// Returns null without WebGL; the caller then falls back to a plain fade.

export interface BeamReveal {
	setProgress(p: number): void;
	destroy(): void;
	canvas: HTMLCanvasElement;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform float uP;
uniform float uAspect;
uniform float uAxis;   // 0: the light sweeps left to right, 1: from the top down
varying vec2 vUv;

const float BEAM_WIDTH = 0.11;
const float BEAM_GAIN = 1.1;
const float ZOOM = 1.1;
const vec2 PIVOT = vec2(0.5, 0.45);

void main() {
  float p = clamp(uP, 0.0, 1.0);
  vec2 uv = vUv;
  float tilt = mix(0.35 * (1.0 / max(uAspect, 0.3)), 0.22, uAxis);
  float xAcross = uv.x + (uv.y - 0.5) * tilt;
  float xDown = (1.0 - uv.y) + (uv.x - 0.5) * tilt;
  float x = mix(xAcross, xDown, uAxis);
  float reach = abs(tilt) * 0.5 + 2.5 * BEAM_WIDTH;
  float head = mix(-reach, 1.0 + reach, p);

  // the picture settles in from a slight zoom as the light goes over it
  vec2 st = PIVOT + (uv - PIVOT) / mix(ZOOM, 1.0, p);
  vec3 pic = texture2D(uTex, vec2(clamp(st.x, 0.001, 0.999), 1.0 - clamp(st.y, 0.001, 0.999))).rgb;

  float reveal = smoothstep(head + BEAM_WIDTH * 0.3, head - BEAM_WIDTH * 0.3, x);
  float fade = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.9, 1.0, p));
  float glow = exp(-pow((x - head) / BEAM_WIDTH, 2.0)) * fade * BEAM_GAIN;
  float streakAcross = exp(-abs(uv.y - 0.5) * 50.0) * exp(-abs(uv.x - head) * 1.4);
  float streakDown = exp(-abs(uv.x - 0.5) * 50.0) * exp(-abs((1.0 - uv.y) - head) * 1.4);
  float streak = mix(streakAcross, streakDown, uAxis);
  // the thin streak through the middle belongs to the sideways sweep only; coming down from the top the edge is enough
  float flare = streak * fade * BEAM_GAIN * 0.5 * (1.0 - uAxis);

  vec3 col = pic * reveal;
  col *= 1.0 + glow * 0.3;
  col += vec3(1.0, 0.95, 0.85) * glow * 0.55 + vec3(0.75, 0.85, 1.0) * flare;
  gl_FragColor = vec4(col, 1.0);
}`;

// The opening of the Projects ribbon (src/lib/zen/shaders/ribbon.js, introReveal), for a single picture: a front of light that
// is torn into an ink-like edge by noise, with a hard bright core, a halo, the red / green / blue pulled apart behind it, and
// grain on the edge. The numbers are the ribbon's own (its `intro` config). The Projects front climbs from the bottom; this
// one comes DOWN from the top.
const FRAG_INK = `
precision highp float;
uniform sampler2D uTex;
uniform float uP;
uniform float uTime;
uniform float uAspect;
uniform float uPx;
uniform float uSeed;
varying vec2 vUv;

const float SCALE = 1.1;
const float SPEED = 0.4;
const float SPREAD = 0.45;
const float WARP = 3.5;
const float TWIST = 1.5;
const float STREAKS = 0.8;
const float CORE_W = 0.002;
const float CORE_I = 3.0;
const float MID_W = 0.03;
const float MID_I = 0.55;
const float OUTER_W = 0.35;
const float OUTER_I = 0.26;
const float HALO_W = 0.04;
const float FRINGE = 0.0005;
const float ABERR = 0.004;
const float GRAIN = 0.75;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(vec3(i, 0.0)), hash(vec3(i + vec2(1.0, 0.0), 0.0)), f.x),
    mix(hash(vec3(i + vec2(0.0, 1.0), 0.0)), hash(vec3(i + 1.0, 0.0)), f.x),
    f.y
  );
}
float introFbm(vec2 p) {
  return valueNoise(p) * 0.5 + valueNoise(p * 2.0) * 0.25 + valueNoise(p * 4.0) * 0.125 + valueNoise(p * 8.0) * 0.0625;
}
float inkNoise(vec2 p, float t) {
  vec2 warp = vec2(introFbm(p + t), introFbm(p + vec2(5.2, 1.3) - t));
  return introFbm(p + (warp - 0.5) * WARP);
}
mat2 introRotate(float a) {
  return mat2(cos(a), sin(a), -sin(a), cos(a));
}
float introGlow(float width, float x) {
  float t = clamp(1.0 - x / width, 0.0, 1.0);
  return t * t * t;
}
float introSplit(float d) {
  return FRINGE + ABERR * max(d, 0.0);
}
float edgeLight(float trail, float streak, float aa) {
  float behind = max(trail, 0.0);
  float ahead = max(-trail, 0.0);
  float core = (1.0 - smoothstep(0.0, max(CORE_W, aa), abs(trail))) * CORE_W / max(CORE_W, aa);
  float spill = trail > 0.0
    ? introGlow(MID_W, behind) * MID_I + introGlow(OUTER_W, behind) * OUTER_I * streak
    : introGlow(HALO_W, ahead) * MID_I;
  return core * CORE_I + spill;
}

void main() {
  // the card in the ribbon's own units (a share of the screen's height; the card is 0.65 of it tall)
  float height = 0.65;
  float width = height * uAspect;
  vec2 q = vec2((vUv.x - 0.5) * width, (1.0 - vUv.y) * height);   // y grows DOWN from the top edge
  float aa = 1.5 * height / max(uPx, 1.0);

  float start = -(0.5 * SPREAD + HALO_W + introSplit(SPREAD));
  float end = height + 0.5 * SPREAD + max(MID_W, OUTER_W) + introSplit(height + SPREAD);
  float front = mix(start, end, clamp(uP, 0.0, 1.0));

  float r = max(q.y, 0.0);
  float t = uTime * SPEED;
  vec2 n = introRotate(TWIST * front / (1.0 + 2.0 * r)) * q + uSeed;
  float offset = (inkNoise(n * SCALE, t) - 0.5) * SPREAD;
  float streak = mix(1.0, 2.0 * introFbm(vec2(q.x * 6.0, r * 1.5 - t)), STREAKS);
  float trail = front - q.y - offset;

  vec3 trails = trail + vec3(1.0, 0.0, -1.0) * introSplit(r);
  vec3 light = vec3(edgeLight(trails.r, streak, aa), edgeLight(trails.g, streak, aa), edgeLight(trails.b, streak, aa));
  float stored = 0.5 + (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) * 0.264;
  light *= max(1.0 + GRAIN * (stored * 2.0 - 1.0) / 0.132, 0.0);
  light = 1.0 - exp(-light);

  vec3 pic = texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  float shown = smoothstep(-aa, aa, trail);
  float alpha = max(shown, max(light.r, max(light.g, light.b)));
  vec3 rgb = (pic * shown + light) / max(alpha, 1e-4);
  gl_FragColor = vec4(rgb * alpha, 1.0);
}`;

export function initBeamReveal(host: HTMLElement, img: HTMLImageElement, options: { axis?: 'x' | 'y'; style?: 'beam' | 'ink'; seed?: number } = {}): BeamReveal | null {
	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;z-index:1';
	const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
	if (!gl) return null;

	const compile = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
	};
	const vs = compile(gl.VERTEX_SHADER, VERT);
	const fs = compile(gl.FRAGMENT_SHADER, options.style === 'ink' ? FRAG_INK : FRAG);
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
	const uP = gl.getUniformLocation(prog, 'uP');
	const uTime = gl.getUniformLocation(prog, 'uTime');
	const uPx = gl.getUniformLocation(prog, 'uPx');
	gl.uniform1f(gl.getUniformLocation(prog, 'uSeed'), options.seed ?? 0);
	const uAspect = gl.getUniformLocation(prog, 'uAspect');
	gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
	gl.uniform1f(gl.getUniformLocation(prog, 'uAxis'), options.axis === 'y' ? 1 : 0);

	let progress = 0;
	let raf = 0;
	let ready = false;
	let sized = false;
	const tex = gl.createTexture();

	// The texture is the photo already cropped (cover, centred) and scaled to
	// the canvas's own pixel size by the browser's resampler, so it is as sharp
	// as the <img> it stands in for.
	const upload = () => {
		if (!sized || !img.naturalWidth || !canvas.width) return;
		const cw = canvas.width, ch = canvas.height;
		const c2 = document.createElement('canvas');
		c2.width = cw; c2.height = ch;
		const x = c2.getContext('2d');
		if (!x) return;
		const sc = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
		const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
		x.imageSmoothingEnabled = true;
		x.imageSmoothingQuality = 'high';
		x.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		ready = true;
		requestDraw();
	};

	// (desktop Safari can fire `load` before we listen: decode() and a couple of
	// retries make sure the texture is made whichever comes first)
	img.decode?.().then(upload).catch(() => {});
	img.addEventListener('load', upload);
	const t1 = setTimeout(() => { if (!ready) upload(); }, 400);
	const t2 = setTimeout(() => { if (!ready) upload(); }, 1500);

	function layout() {
		const W = host.clientWidth || 1, H = host.clientHeight || 1;
		const dpr = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(W, H));
		canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
		gl!.viewport(0, 0, canvas.width, canvas.height);
		gl!.uniform1f(uAspect, W / H);
		gl!.uniform1f(uPx, canvas.height);
		sized = true;
		upload();
		draw();   // resizing clears the canvas: draw again in this very frame
	}

	function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }

	function draw() {
		raf = 0;
		const g = gl!;
		g.clearColor(0, 0, 0, 1);
		g.clear(g.COLOR_BUFFER_BIT);
		if (!ready) return;
		g.activeTexture(g.TEXTURE0);
		g.bindTexture(g.TEXTURE_2D, tex);
		g.uniform1f(uP, progress);
		if (uTime) g.uniform1f(uTime, (performance.now() / 1000) % 1000);
		g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
	}

	host.insertBefore(canvas, host.firstChild);
	const ro = new ResizeObserver(layout);
	ro.observe(host);
	layout();

	return {
		canvas,
		setProgress(p: number) {
			const v = p < 0 ? 0 : p > 1 ? 1 : p;
			if (v === progress) return;
			progress = v;
			requestDraw();
		},
		destroy() {
			ro.disconnect();
			if (raf) cancelAnimationFrame(raf);
			clearTimeout(t1);
			clearTimeout(t2);
			img.removeEventListener('load', upload);
			canvas.remove();
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
