// Hover Gallery — a picture that follows the cursor over a list of titles.
//
// Plain TypeScript + raw WebGL2, no dependencies (not even three.js or GSAP).
// A port of the "HoverGallery" from michaelgatt.com's /projects page:
//
//   const gallery = createHoverGallery(container, [{ key: 'a', src: '/a.jpg' }, ...]);
//   gallery.setHovered('a');   // unfold a's picture, fold the others
//   gallery.setHovered(null);  // fold everything away
//   gallery.start(); gallery.stop(); gallery.resize(); gallery.destroy();
//
// How it works:
//  1. A transparent canvas fills `container` (pointer-events: none) and sits
//     behind the list. The camera stands at z = 800 with a field of view
//     chosen so 1 unit = 1 CSS px on the z = 0 plane: planes are placed in
//     plain pixels.
//  2. Every item gets a plane (437 × 245) with its picture. They are stacked
//     and all follow the cursor with a soft lag.
//  3. A plane starts "folded away" (warp = 1, invisible). Hovering its title
//     unfolds it (warp → 0): the top and bottom rows are pulled into the
//     middle and fade, so the picture opens from a thin line outward.
//  4. Fast sideways mouse moves bend the plane (edges pushed back in depth);
//     fast vertical moves tilt the planes that are not hovered.
//  5. Motion blur: each frame is mixed with the previous one, which leaves a
//     short trail. It switches itself off if the machine can't keep 30 fps.
//
// The loop only runs while the container is on screen and something is
// moving; it goes quiet (no GPU work) when everything has settled.

const CAMERA_Z = 800;
const PLANE_W = 437;
const PLANE_H = 245;
const SEGMENTS = 20; // enough vertices for the bend to look smooth

export interface GalleryItem {
  key: string;
  src: string;
}

export interface GalleryOptions {
  opacity?: number; // the original draws its previews at half opacity
  motionBlur?: boolean;
  blurMix?: number; // how much of the previous frame stays (0 = no trail)
  // One picture filling the container, not following a pointer (phones: the
  // same fold/unfold, no mouse). Full opacity, no trail, sharper pixels.
  fill?: boolean;
  // Which way the picture opens: 'y' from a horizontal line (up/down, the
  // default), 'x' from a vertical line (left/right).
  axis?: 'x' | 'y';
  // A calmer fold: the picture is pulled toward the centre less while it
  // opens, and scrubbed values are eased (slow start, slow end).
  soft?: boolean;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `#version 300 es
in vec2 aPos;          // -0.5 … 0.5 across the plane
uniform mat4 uProj;
uniform vec2 uCenter;  // plane centre in px (y up)
uniform vec2 uSize;
uniform float uCurve;  // 0 … 0.3, from horizontal mouse speed
uniform float uTilt;   // radians, from vertical mouse speed
out vec2 vUv;

void main() {
  vUv = aPos + 0.5;
  vec2 p = aPos * uSize;
  // 0 at the centre, 1 at the left/right edge; quadratic bend away from the viewer.
  float edge = abs(p.x) / (uSize.x * 0.5);
  float z = uCurve * edge * edge * 3000.0 * (uSize.x / 2000.0);
  z += p.y * tan(uTilt);
  gl_Position = uProj * vec4(uCenter + p, -z, 1.0);
}`;

const FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uCover;   // UV scale that makes the picture fill the plane (object-fit: cover)
uniform float uOpacity;
uniform float uWarp;   // 0 = fully open, 1 = folded away
uniform float uSqueeze; // how much the picture is pulled toward the centre while folding (1 = the original)
uniform float uAxis;   // 0 = opens from a horizontal line (up/down), 1 = from a vertical line (left/right)
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 c = vUv - 0.5;
  // Rows far from the middle fold first, so the picture opens from a thin
  // horizontal line outward as uWarp goes 1 → 0.
  float d = uAxis > 0.5 ? abs(c.x) : abs(c.y);
  float k = smoothstep(0.0, 1.0, uWarp * 2.0 + d * 2.0 - 1.0);
  // Pull the sample point toward the centre while folding.
  vec2 uv = (vUv - c * k * k * uSqueeze - 0.5) * uCover + 0.5;
  vec4 col = texture(uTex, vec2(uv.x, 1.0 - uv.y));
  float a = col.a * uOpacity * (1.0 - k);
  outColor = vec4(col.rgb * a, a); // premultiplied
}`;

const POST_VERT = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Mixes the fresh frame with the previous one (trail); mix = 0 is a plain copy.
const POST_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uPrev;
uniform float uMix;
in vec2 vUv;
out vec4 outColor;
void main() {
  // The small subtraction keeps 8-bit rounding from leaving a permanent ghost.
  vec4 prev = max(texture(uPrev, vUv) - 0.008, 0.0);
  outColor = mix(texture(uScene, vUv), prev, uMix);
}`;

const COPY_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uScene;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uScene, vUv); }`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// GSAP's power4 curves.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 5);
const easeIn = (t: number) => t * t * t * t * t;
const linear = (t: number) => t;

/** A value that moves toward a target over time. */
class Tween {
  v: number;
  private from: number;
  private to: number;
  private t0 = 0;
  private dur = 0;
  private ease = linear;
  /** Jump straight to a value (scrubbing), dropping any tween in flight. */
  set(v: number) {
    this.v = this.from = this.to = v;
  }
  constructor(v: number) {
    this.v = this.from = this.to = v;
  }
  go(to: number, dur: number, ease: (t: number) => number, now: number) {
    this.from = this.v;
    this.to = to;
    this.t0 = now;
    this.dur = dur;
    this.ease = ease;
  }
  step(now: number): boolean {
    if (this.v === this.to) return false;
    const t = Math.min(1, (now - this.t0) / this.dur);
    this.v = t >= 1 ? this.to : this.from + (this.to - this.from) * this.ease(t);
    return true;
  }
  get moving() {
    return this.v !== this.to;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

/** Soft gradient shown until the picture arrives (or if it can't load). */
function placeholder(gl: WebGL2RenderingContext, seed: number, clear = false) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const ctx = c.getContext('2d')!;
  if (clear) return upload(gl, c, false); // nothing to show until the picture is here
  const hue = (seed * 47) % 360;
  const g = ctx.createLinearGradient(0, 0, 64, 36);
  g.addColorStop(0, `hsl(${hue} 35% 22%)`);
  g.addColorStop(1, `hsl(${(hue + 60) % 360} 45% 45%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 36);
  return upload(gl, c, false);
}

function upload(gl: WebGL2RenderingContext, src: TexImageSource, mip: boolean) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, tex };
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

interface Plane {
  tex: WebGLTexture;
  cover: [number, number];
  ratio: number; // the picture's width / height once loaded
  warp: Tween;
  tilt: Tween;
  x: number; // px from the container's centre, y up
  y: number;
}

export function createHoverGallery(container: HTMLElement, items: GalleryItem[], options: GalleryOptions = {}) {
  const { fill = false, blurMix = 0.5, axis = 'y', soft = false } = options;
  const opacity = options.opacity ?? (fill ? 1 : 0.5);
  const motionBlur = options.motionBlur ?? !fill;
  let pw = PLANE_W, ph = PLANE_H; // plane size in px (the container's, when filling)
  let dpr = 1;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block';
  container.prepend(canvas);

  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
  if (!gl) {
    canvas.remove();
    return null;
  }

  // --- programs and geometry -------------------------------------------------
  const prog = program(gl, VERT, FRAG);
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const uProj = U('uProj'), uCenter = U('uCenter'), uSize = U('uSize'), uCurveL = U('uCurve');
  const uTiltL = U('uTilt'), uTexL = U('uTex'), uCoverL = U('uCover'), uOpacityL = U('uOpacity'), uWarpL = U('uWarp'), uAxisL = U('uAxis'), uSqueezeL = U('uSqueeze');

  const post = program(gl, POST_VERT, POST_FRAG);
  const copy = program(gl, POST_VERT, COPY_FRAG);

  // A (SEGMENTS+1)² grid of vertices over the plane, as indexed triangles.
  const verts: number[] = [];
  for (let j = 0; j <= SEGMENTS; j++) for (let i = 0; i <= SEGMENTS; i++) verts.push(i / SEGMENTS - 0.5, j / SEGMENTS - 0.5);
  const idx: number[] = [];
  const row = SEGMENTS + 1;
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  const emptyVao = gl.createVertexArray()!;

  // --- one plane per item ----------------------------------------------------
  const planes = new Map<string, Plane>();
  const owned: WebGLTexture[] = [];
  let destroyed = false;
  items.forEach((item, i) => {
    const tex = placeholder(gl, i + 1, fill);
    owned.push(tex);
    const plane: Plane = { tex, cover: [1, 1], ratio: 0, warp: new Tween(1), tilt: new Tween(0), x: 0, y: 0 };
    planes.set(item.key, plane);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (destroyed) return;
      const real = upload(gl, img, true);
      owned.push(real);
      gl.deleteTexture(plane.tex);
      plane.tex = real;
      // object-fit: cover → shrink the UV range on the axis that overflows.
      plane.ratio = img.naturalWidth / img.naturalHeight;
      fitCover(plane);
      dirty();
    };
    img.src = item.src; // same-origin; the site's CSP blocks remote images
  });

  function fitCover(p: Plane) {
    if (!p.ratio) return;
    const pr = pw / ph;
    p.cover = p.ratio > pr ? [pr / p.ratio, 1] : [1, p.ratio / pr];
  }

  // --- size and render targets -----------------------------------------------
  let w = 1, h = 1, bw = 1, bh = 1, aspect = 1;
  let scene: Target | null = null;
  let ping: Target | null = null;
  let pong: Target | null = null;
  const proj = new Float32Array(16);

  function resize() {
    const r = container.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    // Pixel ratio 1 like the original (the trail hides aliasing); filling a
    // phone-sized box there is no trail, so it gets up to 2.
    dpr = fill ? Math.min(2, window.devicePixelRatio || 1) : 1;
    bw = Math.round(w * dpr);
    bh = Math.round(h * dpr);
    canvas.width = bw;
    canvas.height = bh;
    if (fill) { pw = w; ph = h; planes.forEach(fitCover); }
    aspect = w / h;
    // Perspective with 1 unit = 1 px at z = 0 (camera at z = 800).
    const f = (2 * CAMERA_Z) / h, near = 1, far = 20000;
    proj.fill(0);
    proj[0] = f / aspect;
    proj[5] = f;
    const A = (far + near) / (near - far);
    const B = (2 * far * near) / (near - far);
    // The camera offset (z_view = z − 800) is folded into the matrix.
    proj[10] = A;
    proj[11] = -1;
    proj[14] = B - A * CAMERA_Z;
    proj[15] = CAMERA_Z; // w = −z_view = 800 − z
    for (const t of [scene, ping, pong]) if (t) { gl!.deleteFramebuffer(t.fbo); gl!.deleteTexture(t.tex); }
    scene = makeTarget(gl!, bw, bh);
    ping = makeTarget(gl!, bw, bh);
    pong = makeTarget(gl!, bw, bh);
    for (const t of [ping, pong]) { gl!.bindFramebuffer(gl!.FRAMEBUFFER, t.fbo); gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT); }
    dirty();
  }

  // --- mouse: position, speed → bend and tilt --------------------------------
  let hovered: string | null = null;
  let tx = 0, ty = 0; // target (px from the container's centre, y up)
  let seeded = false;
  let last: { x: number; y: number; t: number } | null = null;
  let idleTimer = 0;
  const curve = new Tween(0);
  let curveTarget = 0;
  let tiltTarget = 0;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

  function setCurve(value: number) {
    value = Math.round(value * 1000) / 1000;
    if (value === curveTarget) return;
    // Bending in speeds up (ease-in), relaxing slows down (ease-out).
    curve.go(value, 0.75, value > curveTarget ? easeIn : easeOut, performance.now() / 1000);
    curveTarget = value;
    dirty();
  }
  function setTilt(rad: number) {
    tiltTarget = rad;
    const now = performance.now() / 1000;
    planes.forEach((p, key) => p.tilt.go(key === hovered ? 0 : rad, 1.5, linear, now));
    dirty();
  }
  function resetSpeed() {
    last = null;
    setCurve(0);
    setTilt(0);
  }
  let cx = 0, cy = 0; // the pointer in viewport px
  function retarget() {
    const r = container.getBoundingClientRect();
    tx = cx - r.left - r.width / 2;
    ty = r.height / 2 - (cy - r.top);
  }
  // The page scrolling under a resting pointer: keep the picture under it.
  function onScroll() {
    if (!seeded) return;
    retarget();
    dirty();
  }
  function onMove(e: MouseEvent) {
    const now = performance.now();
    if (last) {
      const dt = (now - last.t) / 1000;
      if (dt > 0) {
        const vx = Math.abs((e.clientX - last.x) / dt); // px/s
        const vy = (e.clientY - last.y) / dt;
        setCurve(clamp((vx / 400) * 0.2, 0, 0.3)); // 400 px/s sideways → 0.2, capped at 0.3
        const deg = Math.abs(vy) > 50 ? clamp((vy / 100) * 30, -30, 30) : 0; // only fast vertical moves tilt
        setTilt((deg * Math.PI) / 180);
      }
    }
    last = { x: e.clientX, y: e.clientY, t: now };
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(resetSpeed, 100);

    cx = e.clientX;
    cy = e.clientY;
    retarget();
    if (!seeded) { // first move: appear under the cursor instead of flying in from the middle
      seeded = true;
      planes.forEach((p) => { p.x = tx; p.y = ty; });
    }
    dirty();
  }

  // --- hover: unfold one picture, fold the others ----------------------------
  function setHovered(key: string | null) {
    hovered = key;
    const now = performance.now() / 1000;
    planes.forEach((p, k) => {
      const open = k === key;
      p.warp.go(open ? 0 : 1, open ? 1.75 : 0.75, easeOut, now);
    });
    setTilt(tiltTarget);
    dirty();
  }

  // Scrubbing: set one picture's fold directly (0 = open, 1 = folded away),
  // e.g. from the scroll position, with no tween in between.
  function setWarp(key: string, value: number) {
    const p = planes.get(key);
    if (!p) return;
    // Soft: eased (slow start, slow end) so scrubbing never feels abrupt.
    const open = 1 - Math.min(1, Math.max(0, value));
    const v = soft ? 1 - open * open * (3 - 2 * open) : 1 - open;
    if (p.warp.v === v && !p.warp.moving) return;
    p.warp.set(v);
    dirty();
  }

  // --- render loop -----------------------------------------------------------
  let raf = 0;
  let visible = false;
  let quiet = 0; // frames left to draw after everything stopped (lets the trail fade)
  let blurOn = motionBlur;
  let frames = 0;
  let fpsStart = 0;
  let lastT = 0;

  function dirty() {
    quiet = 30;
    if (visible && !raf && !destroyed) { lastT = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function frame(ms: number) {
    raf = 0;
    if (!visible || destroyed || !scene || !ping || !pong) return;
    const dt = Math.min(0.1, Math.max(0.001, (ms - lastT) / 1000));
    lastT = ms;
    const now = ms / 1000;

    // Advance everything; remember whether anything is still moving.
    let moving = curve.step(now) || curve.moving;
    const k = 1 - Math.exp(-dt * 5); // soft lag behind the cursor (≈ the original's 1.6 s power4.out)
    let anyOpen = false;
    planes.forEach((p) => {
      moving = p.warp.step(now) || p.warp.moving || moving;
      moving = p.tilt.step(now) || p.tilt.moving || moving;
      const dx = tx - p.x, dy = ty - p.y;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) { p.x += dx * k; p.y += dy * k; moving = true; }
      if (p.warp.v < 0.999) anyOpen = true;
    });
    if (moving || anyOpen) quiet = 30;

    // 1. the planes → scene target
    const g = gl!;
    g.bindFramebuffer(g.FRAMEBUFFER, scene.fbo);
    g.viewport(0, 0, bw, bh);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    if (anyOpen) {
      g.useProgram(prog);
      g.bindVertexArray(vao);
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA); // premultiplied
      g.disable(g.DEPTH_TEST);
      g.disable(g.CULL_FACE);
      g.uniformMatrix4fv(uProj, false, proj);
      g.uniform2f(uSize, pw, ph);
      g.uniform1f(uCurveL, curve.v);
      g.uniform1f(uOpacityL, opacity);
      g.uniform1f(uAxisL, axis === 'x' ? 1 : 0);
      g.uniform1f(uSqueezeL, soft ? 0.4 : 1);
      g.uniform1i(uTexL, 0);
      g.activeTexture(g.TEXTURE0);
      planes.forEach((p) => {
        if (p.warp.v >= 0.999) return;
        g.uniform2f(uCenter, p.x, p.y);
        g.uniform1f(uTiltL, p.tilt.v);
        g.uniform1f(uWarpL, p.warp.v);
        g.uniform2f(uCoverL, p.cover[0], p.cover[1]);
        g.bindTexture(g.TEXTURE_2D, p.tex);
        g.drawElements(g.TRIANGLES, idx.length, g.UNSIGNED_SHORT, 0);
      });
    }

    // 2. blend with the previous frame → ping, 3. copy to the screen, swap
    g.bindVertexArray(emptyVao);
    g.disable(g.BLEND);
    g.useProgram(post);
    g.bindFramebuffer(g.FRAMEBUFFER, ping.fbo);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, scene.tex);
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, pong.tex);
    g.uniform1i(g.getUniformLocation(post, 'uScene'), 0);
    g.uniform1i(g.getUniformLocation(post, 'uPrev'), 1);
    g.uniform1f(g.getUniformLocation(post, 'uMix'), blurOn ? blurMix : 0);
    g.drawArrays(g.TRIANGLES, 0, 3);

    g.useProgram(copy);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, bw, bh);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, ping.tex);
    g.uniform1i(g.getUniformLocation(copy, 'uScene'), 0);
    g.drawArrays(g.TRIANGLES, 0, 3);
    [ping, pong] = [pong, ping];

    // Quality fallback: under 30 fps, drop the trail.
    if (blurOn && moving) {
      if (!fpsStart) fpsStart = ms + 1500; // let it settle before measuring
      else if (ms > fpsStart) {
        frames++;
        if (ms - fpsStart >= 1000) {
          const fps = (frames * 1000) / (ms - fpsStart);
          if (fps < 30 && fps > 5) blurOn = false;
          frames = 0;
          fpsStart = ms;
        }
      }
    }

    if (moving || quiet-- > 0) raf = requestAnimationFrame(frame);
  }

  // --- wiring ----------------------------------------------------------------
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) { resize(); dirty(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  });
  io.observe(container);
  const ro = new ResizeObserver(() => { if (visible) resize(); });
  ro.observe(container);
  if (!fill) {
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mouseleave', resetSpeed);
  }

  const onLost = (e: Event) => e.preventDefault();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(raf);
    clearTimeout(idleTimer);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('mouseleave', resetSpeed);
    canvas.removeEventListener('webglcontextlost', onLost);
    owned.forEach((t) => gl!.deleteTexture(t));
    gl!.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }

  return { setHovered, setWarp, resize, destroy, canvas };
}
