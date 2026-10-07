/**
 * Chroma card — a photo as a 3D card that leans, drifts and scales after the
 * mouse; hovering it zooms in through an RGB-split, pixel-displaced
 * transition. Plain WebGL port of React Bits' ChromaCard (no three.js / R3F).
 *
 * The canvas is PAD times the photo box, centred on it, so the card has room
 * to move; at rest the card covers the box exactly. Frames are drawn only
 * while something is animating.
 */
import gsap from 'gsap';

export interface ChromaCardOpts {
	zoomLevel?: number;
	rgbShiftAmount?: number;
	pixelDisplaceAmount?: number;
	hoverDuration?: number;
	rotationIntensity?: number;
	scaleIntensity?: number;
	positionIntensity?: number;
	interactionDuration?: number;
}

export interface ChromaCardHandle {
	destroy(): void;
}

// Canvas size relative to the photo box (CSS sets the same, see FaqSection).
const PAD = 1.5;
const CARD_H = 6;
const FOV = (50 * Math.PI) / 180;
// Camera distance at which the resting card spans 1/PAD of the view.
const CAM_Z = (CARD_H * PAD) / (2 * Math.tan(FOV / 2));

const VERT = `
attribute vec2 aPos;
uniform mat4 uMvp;
uniform vec2 uCard;
varying vec2 vUv;
void main() {
  vUv = aPos + 0.5;
  gl_Position = uMvp * vec4(aPos * uCard, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform float uImageAspect;
uniform float uCardAspect;
uniform float uHover;
uniform float uZoom;
uniform float uRgbShift;
uniform float uDisplace;
varying vec2 vUv;

float exponentialInOut(float t) {
  return t == 0.0 || t == 1.0
    ? t
    : t < 0.5
      ? 0.5 * pow(2.0, (20.0 * t) - 10.0)
      : -0.5 * pow(2.0, 10.0 - (t * 20.0)) + 1.0;
}

void main() {
  // Cover-fit the photo to the card.
  vec2 s = vec2(1.0);
  if (uImageAspect > uCardAspect) s.x = uCardAspect / uImageAspect;
  else s.y = uImageAspect / uCardAspect;
  vec2 uv = (vUv - 0.5) * s + 0.5;

  float h = exponentialInOut(min(1.0, distance(vec2(0.5), uv) * uHover + uHover));
  uv *= 1.0 - uZoom * h;
  uv += uZoom / 2.0 * h;
  uv = clamp(uv, 0.0, 1.0);
  vec4 color = texture2D(uTex, uv);

  if (h > 0.0) {
    h = 1.0 - abs(h - 0.5) * 2.0;
    uv.y += color.r * h * uDisplace;
    color = texture2D(uTex, uv);
    color.r = texture2D(uTex, uv + h * uRgbShift).r;
    color.g = texture2D(uTex, uv - h * uRgbShift).g;
  }
  gl_FragColor = vec4(color.rgb, 1.0);
}`;

// ── column-major 4x4 helpers ──
type M = Float32Array;
const mul = (a: M, b: M): M => {
	const o = new Float32Array(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let s = 0;
			for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
			o[c * 4 + r] = s;
		}
	return o;
};
const perspective = (fov: number, aspect: number, near: number, far: number): M => {
	const f = 1 / Math.tan(fov / 2);
	const nf = 1 / (near - far);
	return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
};
const translate = (x: number, y: number, z: number): M =>
	new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const scale = (x: number, y: number): M => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const rotX = (a: number): M => {
	const c = Math.cos(a), s = Math.sin(a);
	return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
};
const rotY = (a: number): M => {
	const c = Math.cos(a), s = Math.sin(a);
	return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
};

export function createChromaCard(
	box: HTMLElement,
	canvas: HTMLCanvasElement,
	img: HTMLImageElement,
	opts: ChromaCardOpts = {},
): ChromaCardHandle | null {
	const o = {
		zoomLevel: 0.3,
		rgbShiftAmount: 0.02,
		pixelDisplaceAmount: 0.095,
		hoverDuration: 3,
		rotationIntensity: 0.2,
		scaleIntensity: 0.1,
		positionIntensity: 0.5,
		interactionDuration: 0.4,
		...opts,
	};
	const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
	if (!gl) return null;

	const shader = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return s;
	};
	const prog = gl.createProgram()!;
	gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
	gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
	gl.useProgram(prog);

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(prog, 'aPos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	const u = (n: string) => gl.getUniformLocation(prog, n);
	const uMvp = u('uMvp'), uCard = u('uCard'), uImageAspect = u('uImageAspect'), uCardAspect = u('uCardAspect');
	const uHover = u('uHover');
	gl.uniform1f(u('uZoom'), o.zoomLevel);
	gl.uniform1f(u('uRgbShift'), o.rgbShiftAmount);
	gl.uniform1f(u('uDisplace'), o.pixelDisplaceAmount);
	gl.uniform1i(u('uTex'), 0);

	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.uniform1f(uImageAspect, img.naturalWidth / img.naturalHeight);

	// Animated state — tweened by gsap, read each frame.
	const st = { hover: 0, s: 1, x: 0, rx: 0, ry: 0 };
	let cardW = CARD_H;
	let proj = perspective(FOV, 1, 0.1, 100);

	const draw = () => {
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		// Euler XYZ, as three.js: T * Rx * Ry * S
		const model = mul(translate(st.x, 0, 0), mul(rotX(st.rx), mul(rotY(st.ry), scale(st.s, st.s))));
		gl.uniformMatrix4fv(uMvp, false, mul(proj, mul(translate(0, 0, -CAM_Z), model)));
		gl.uniform1f(uHover, st.hover);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	};

	let raf = 0;
	const loop = () => {
		raf = 0;
		draw();
		if (gsap.isTweening(st)) raf = requestAnimationFrame(loop);
	};
	const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

	const resize = () => {
		const w = box.clientWidth, h = box.clientHeight;
		if (!w || !h) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(w * PAD * dpr);
		canvas.height = Math.round(h * PAD * dpr);
		const aspect = w / h;
		cardW = CARD_H * aspect;
		proj = perspective(FOV, aspect, 0.1, 100);
		gl.uniform2f(uCard, cardW, CARD_H);
		gl.uniform1f(uCardAspect, aspect);
		kick();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(box);
	resize();

	// Pointer anywhere over the canvas area (the wrapper listens, since the
	// canvas itself lets clicks through); hover = over the resting card.
	const zone = box.parentElement ?? box;
	let hovering = false;
	let hoverTween: gsap.core.Tween | null = null;
	const setHover = (on: boolean) => {
		hovering = on;
		hoverTween?.kill();
		hoverTween = gsap.to(st, { hover: on ? 1 : 0, duration: o.hoverDuration });
	};
	const onMove = (e: PointerEvent) => {
		const c = canvas.getBoundingClientRect();
		const mx = Math.max(-1, Math.min(1, ((e.clientX - c.left) / c.width) * 2 - 1));
		const my = Math.max(-1, Math.min(1, -((e.clientY - c.top) / c.height) * 2 + 1));
		const b = box.getBoundingClientRect();
		const over = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
		const d = o.interactionDuration;
		if (over !== hovering) setHover(over);
		gsap.to(st, {
			s: 1 - my * o.scaleIntensity,
			x: mx * o.positionIntensity,
			rx: -my * (Math.PI / 3) * o.rotationIntensity,
			ry: mx * (Math.PI / 3) * o.rotationIntensity,
			duration: d,
			overwrite: 'auto',
		});
		kick();
	};
	const onLeave = () => {
		if (hovering) setHover(false);
		gsap.to(st, { s: 1, x: 0, rx: 0, ry: 0, duration: 0.9, ease: 'power3.out', overwrite: 'auto' });
		kick();
	};
	zone.addEventListener('pointermove', onMove);
	zone.addEventListener('pointerleave', onLeave);

	return {
		destroy() {
			cancelAnimationFrame(raf);
			gsap.killTweensOf(st);
			ro.disconnect();
			zone.removeEventListener('pointermove', onMove);
			zone.removeEventListener('pointerleave', onLeave);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
