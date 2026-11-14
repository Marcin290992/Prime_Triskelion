// A portrait built from tiles (plain WebGL, no dependencies).
//
// The photo (the <img> in the page) is cut into a grid of tiles that cover the
// whole host box. Each tile starts scattered: tilted, skewed, stretched, dark,
// rippled and colour-split — and settles into its place as the progress
// (set from outside, e.g. by how much of the copy has been revealed) goes
// 0 -> 1. Tiles join top to bottom (like the copy), with a little randomness.
//
// The tiles are drawn exactly like the <img> underneath (object-fit: cover at
// the given focus, grey, contrast 1.1, brightness .9), so when everything is
// in place the canvas can fade out onto the real image without a visible jump.
// Frames are drawn only when the progress changes — no permanent rAF loop.

export interface FaceTiles {
	setProgress(a: number): void;
	destroy(): void;
	canvas: HTMLCanvasElement;
}

export interface FaceTilesOpts {
	focusX?: number; // object-position of the <img>, 0..1
	focusY?: number;
	tile?: number;   // wanted tile size in CSS px
}

const STAGGER = 0.6;

const VERT = `
attribute vec2 aPos;
uniform vec2 uBox;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uRx;
uniform float uRz;
uniform float uSkew;
uniform float uZ;
uniform float uCam;
varying vec2 vUv;
void main() {
  vec3 p = vec3(aPos * uSize, 0.0);
  p.x += p.y * uSkew;
  float cx = cos(uRx), sx = sin(uRx);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  float cz = cos(uRz), sz = sin(uRz);
  p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
  p += vec3(uCenter, uZ);
  float s = uCam / (uCam - p.z);
  gl_Position = vec4(p.x * s / (uBox.x * 0.5), -p.y * s / (uBox.y * 0.5), 0.0, 1.0);
  vUv = aPos + 0.5;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec4 uRect;   // this tile's place in the box: x, y, w, h (px)
uniform vec4 uCrop;   // where the photo sits in the box: x, y, w, h (px)
uniform float uT;
uniform float uTime;
varying vec2 vUv;
float lum(vec2 uv) { return dot(texture2D(uTex, uv).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  float k = 1.0 - uT;
  vec2 l = vec2(vUv.x - 0.5, (vUv.y - 0.5) / mix(1.0, 1.3, k)) + 0.5;
  l += k * 0.05 * vec2(sin(vUv.y * 14.0 + uTime * 2.0), cos(vUv.x * 14.0 + uTime * 2.2));
  vec2 px = uRect.xy + l * uRect.zw;
  vec2 uv = (px - uCrop.xy) / uCrop.zw;
  vec2 sh = vec2(k * 0.04 * uRect.z / uCrop.z, 0.0);
  vec3 g = vec3(lum(uv + sh), lum(uv), lum(uv - sh));
  g = clamp((g - 0.5) * mix(2.2, 1.1, uT) + 0.5, 0.0, 1.0);
  g *= 0.877 * mix(0.55, 1.0, smoothstep(0.0, 0.8, uT));
  float a = smoothstep(0.0, 0.1, uT);
  gl_FragColor = vec4(g * a, a);
}`;

const smooth = (v: number) => { v = v < 0 ? 0 : v > 1 ? 1 : v; return v * v * (3 - 2 * v); };
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

interface Tile { col: number; row: number; delay: number; side: number; h: number; }

export function initFaceTiles(host: HTMLElement, img: HTMLImageElement, opts: FaceTilesOpts = {}): FaceTiles | null {
	const focusX = opts.focusX ?? 0.5;
	const focusY = opts.focusY ?? 0.5;

	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block';
	const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
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
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(prog, 'aPos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	const U = Object.fromEntries(
		['uBox', 'uCenter', 'uSize', 'uRx', 'uRz', 'uSkew', 'uZ', 'uCam', 'uRect', 'uCrop', 'uT', 'uTime', 'uTex']
			.map((n) => [n, gl.getUniformLocation(prog, n)]));
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

	let progress = 0;
	let raf = 0;

	// the photo as a texture, once it is there
	const tex = gl.createTexture();
	let ready = false;
	// The texture is the photo already cropped (cover + focus) and scaled to the
	// box's own pixel size by the browser's high-quality resampler, so the tiles
	// are as sharp and as soft as the <img> they fade onto — sampling the huge
	// original directly was noticeably crisper and showed as a blink at the end.
	let sized = false;
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
		x.drawImage(img, (cw - dw) * focusX, (ch - dh) * focusY, dw, dh);
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
	img.loading = 'eager';
	img.style.willChange = 'opacity';   // keep it rastered, ready to be uncovered
	// Desktop Safari can leave a lazy image unloaded (or fire `load` before we
	// listen), so the texture is also made when decode() resolves and once more
	// shortly after, whichever comes first.
	img.decode?.().then(upload).catch(() => {});
	img.addEventListener('load', upload);
	setTimeout(() => { if (!ready) upload(); }, 400);
	setTimeout(() => { if (!ready) upload(); }, 1500);

	// grid of tiles over the whole box
	let W = 1, H = 1, cols = 1, rows = 1, tw = 1, th = 1;
	let tiles: Tile[] = [];
	function layout() {
		W = host.clientWidth || 1; H = host.clientHeight || 1;
		// full device resolution (phones are 3x): the tiles must be as sharp as the <img>
		// under them, or the hand-over at the end shows as a flicker of sharpness
		const dpr = Math.min(window.devicePixelRatio || 1, 3, 4096 / Math.max(W, H));
		canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
		gl!.viewport(0, 0, canvas.width, canvas.height);
		const want = opts.tile ?? Math.max(60, Math.min(W, H) / 8);
		cols = Math.max(2, Math.round(W / want)); rows = Math.max(2, Math.round(H / want));
		tw = W / cols; th = H / rows;
		tiles = [];
		for (let i = 0; i < cols * rows; i++) {
			const col = i % cols, row = Math.floor(i / cols);
			tiles.push({
				col, row, h: hash(i + 13), side: (col + row) % 2 ? 1 : -1,
				delay: (row / (rows - 1)) * 0.6 + hash(i) * 0.4,   // top to bottom, like the copy
			});
		}
		sized = true;
		upload();   // the photo is re-cut for the new size
		// Resizing a canvas clears it: draw again at once, in this very frame —
		// not in the next one, which would show one empty frame (a blink).
		draw();
	}

	function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }

	function draw() {
		raf = 0;
		const g = gl!;
		g.clearColor(0, 0, 0, 0);
		g.clear(g.COLOR_BUFFER_BIT);
		if (!ready || progress <= 0) return;

		const cam = Math.max(W, H) * 1.1;
		g.activeTexture(g.TEXTURE0);
		g.bindTexture(g.TEXTURE_2D, tex);
		g.uniform1i(U.uTex, 0);
		g.uniform2f(U.uBox, W, H);
		g.uniform2f(U.uSize, tw * 1.006, th * 1.006);   // a hair of overlap: no seams
		g.uniform4f(U.uCrop, 0, 0, W, H);   // the texture is the box
		g.uniform1f(U.uCam, cam);
		g.uniform1f(U.uTime, progress * 6);

		for (const t of tiles) {
			const s = smooth(progress * (1 + STAGGER) - t.delay * STAGGER);
			if (s < 0.002) continue;
			const away = 1 - s;
			const x0 = t.col * tw, y0 = t.row * th;
			g.uniform4f(U.uRect, x0, y0, tw, th);
			g.uniform2f(U.uCenter,
				x0 + tw / 2 - W / 2 + t.side * (tw * 1.2 + t.h * tw * 3.2) * away,
				y0 + th / 2 - H / 2 + (H * 0.3 + t.h * H * 0.4) * away);   // up from below, like the old grid
			g.uniform1f(U.uRx, 1.2 * away);
			g.uniform1f(U.uRz, t.side * 0.09 * away);
			g.uniform1f(U.uSkew, t.side * 0.36 * away);
			g.uniform1f(U.uZ, cam * (0.12 + t.h * 0.25) * away);
			g.uniform1f(U.uT, s);
			g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
		}
	}

	host.appendChild(canvas);
	const ro = new ResizeObserver(layout);
	ro.observe(host);
	layout();

	return {
		canvas,
		setProgress(a: number) {
			const v = a < 0 ? 0 : a > 1 ? 1 : a;
			if (v === progress) return;
			progress = v;
			requestDraw();
		},
		destroy() {
			ro.disconnect();
			if (raf) cancelAnimationFrame(raf);
			img.removeEventListener('load', upload);
			canvas.remove();
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
