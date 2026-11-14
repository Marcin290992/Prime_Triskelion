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
varying vec2 vUv;

const float BEAM_WIDTH = 0.11;
const float BEAM_GAIN = 1.1;
const float ZOOM = 1.1;
const vec2 PIVOT = vec2(0.5, 0.45);

void main() {
  float p = clamp(uP, 0.0, 1.0);
  vec2 uv = vUv;
  float tilt = 0.35 * (1.0 / max(uAspect, 0.3));
  float x = uv.x + (uv.y - 0.5) * tilt;
  float reach = abs(tilt) * 0.5 + 2.5 * BEAM_WIDTH;
  float head = mix(-reach, 1.0 + reach, p);

  // the picture settles in from a slight zoom as the light goes over it
  vec2 st = PIVOT + (uv - PIVOT) / mix(ZOOM, 1.0, p);
  vec3 pic = texture2D(uTex, vec2(clamp(st.x, 0.001, 0.999), 1.0 - clamp(st.y, 0.001, 0.999))).rgb;

  float reveal = smoothstep(head + BEAM_WIDTH * 0.3, head - BEAM_WIDTH * 0.3, x);
  float fade = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.9, 1.0, p));
  float glow = exp(-pow((x - head) / BEAM_WIDTH, 2.0)) * fade * BEAM_GAIN;
  float streak = exp(-abs(uv.y - 0.5) * 50.0) * exp(-abs(uv.x - head) * 1.4);
  float flare = streak * fade * BEAM_GAIN * 0.5;

  vec3 col = pic * reveal;
  col *= 1.0 + glow * 0.3;
  col += vec3(1.0, 0.95, 0.85) * glow * 0.55 + vec3(0.75, 0.85, 1.0) * flare;
  gl_FragColor = vec4(col, 1.0);
}`;

export function initBeamReveal(host: HTMLElement, img: HTMLImageElement): BeamReveal | null {
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
	const uP = gl.getUniformLocation(prog, 'uP');
	const uAspect = gl.getUniformLocation(prog, 'uAspect');
	gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);

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
