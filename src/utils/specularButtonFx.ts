// SpecularButton — vanilla port (no framework, no dependencies) of the
// React component of the same name: a WebGL2 SDF rim-light drawn around a
// button. A bright "spot" travels the rim following the cursor (it takes
// the side of the button the pointer is nearest, with a second, dimmer lobe
// on the opposite side), the whole light swells with proximity and flares
// on press, and at rest it sits dimly in the top-left corner.
//
// Mount point: a `.specular-button__fx` element inside the button (the
// canvas is appended to it; its CSS insets it by PAD px on every side, see
// OxygenMenu.astro). Frames are drawn on demand — only while something is
// moving or settling — and not at all while the button is off screen.
// Wrapped with what this site needs around WebGL: context-loss recovery, a
// canvas that stays invisible until a cleared frame has been composited,
// and an explicit context release on destroy().

// Must match the inset of `.specular-button__fx` in OxygenMenu.astro.
const PAD = 20;
const TAU = Math.PI * 2;

const VERT = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uPx;
uniform float uSpot;
uniform vec2 uEntry;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform vec2 uWindow;
uniform float uThickness;
uniform float uGlow;
out vec4 outColor;

float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Where on the rim (0..1, once around) the point p lies nearest to.
float loopPosition(vec2 p, vec2 b, float r) {
  vec2 inner = b - r;
  float arc = 1.5707963 * r;
  float quarter = inner.x + inner.y + arc;
  vec2 a = abs(p);
  vec2 q = a - inner;
  float s = q.x > 0.0 && q.y > 0.0
    ? inner.y + atan(q.y, q.x) * r
    : (q.x > q.y ? min(a.y, inner.y) : inner.y + arc + inner.x - min(a.x, inner.x));
  if (p.x < 0.0) s = p.y >= 0.0 ? 2.0 * quarter - s : 2.0 * quarter + s;
  else if (p.y < 0.0) s = 4.0 * quarter - s;
  return s / max(4.0 * quarter, 0.0001);
}

float lobe(float position, float center) {
  float gap = abs(fract(position - center + 0.5) - 0.5);
  return 1.0 - smoothstep(uWindow.x, uWindow.x + uWindow.y, gap);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = roundedBox(p, uHalf, uRadius);
  float position = loopPosition(p, uHalf, uRadius);
  float key = lobe(position, uSpot);
  float back = lobe(position, uSpot + 0.5);
  float streak = key + back * 0.45;
  float width = max(uThickness * uPx * mix(1.0, max(key, back), 0.6), 0.35);
  float band = smoothstep(-width - 0.6, -width + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float hair = smoothstep(-uPx - 0.6, -uPx + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  vec2 pool = (p - uEntry) / (uHalf.y * vec2(1.6, 1.1));
  float glow = streak * 0.2 * exp(-abs(d + width * 0.5) / (5.0 * uPx)) + inside * 0.08 * exp(-dot(pool, pool));
  float light = clamp((band * streak + glow * uGlow) * uIntensity, 0.0, 1.0);
  vec4 base = vec4(uBaseColor, 1.0) * hair * 0.6;
  outColor = vec4(uLineColor, 1.0) * light + base * (1.0 - light);
}
`;

const UNIFORM_NAMES = [
  'uCenter', 'uHalf', 'uRadius', 'uPx', 'uSpot', 'uEntry',
  'uLineColor', 'uBaseColor', 'uIntensity', 'uWindow', 'uThickness', 'uGlow',
] as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const wrap = (v: number) => v - Math.floor(v);

// Same maths as the shader's loopPosition(), for steering on the CPU.
function loopPosition(x: number, y: number, halfX: number, halfY: number, r: number): number {
  const innerX = halfX - r;
  const innerY = halfY - r;
  const arc = (Math.PI / 2) * r;
  const quarter = innerX + innerY + arc;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const qx = ax - innerX;
  const qy = ay - innerY;
  let s: number;
  if (qx > 0 && qy > 0) s = innerY + Math.atan2(qy, qx) * r;
  else if (qx > qy) s = Math.min(ay, innerY);
  else s = innerY + arc + innerX - Math.min(ax, innerX);
  if (x < 0) s = y >= 0 ? 2 * quarter - s : 2 * quarter + s;
  else if (y < 0) s = 4 * quarter - s;
  return wrap(s / Math.max(4 * quarter, 0.0001));
}

// The point on the rim at a given position (inverse of loopPosition).
function rimPoint(position: number, halfX: number, halfY: number, r: number): [number, number] {
  const innerX = halfX - r;
  const innerY = halfY - r;
  const arc = (Math.PI / 2) * r;
  const quarter = innerX + innerY + arc;
  let s = wrap(position) * 4 * quarter;
  let signX = 1;
  let signY = 1;
  if (s > 3 * quarter) {
    s = 4 * quarter - s;
    signY = -1;
  } else if (s > 2 * quarter) {
    s -= 2 * quarter;
    signX = -1;
    signY = -1;
  } else if (s > quarter) {
    s = 2 * quarter - s;
    signX = -1;
  }
  let x = innerX - (s - innerY - arc);
  let y = halfY;
  if (s <= innerY) {
    x = halfX;
    y = s;
  } else if (s <= innerY + arc) {
    const angle = (s - innerY) / Math.max(r, 0.0001);
    x = innerX + Math.cos(angle) * r;
    y = innerY + Math.sin(angle) * r;
  }
  return [x * signX, y * signY];
}

// Parsed once per colour — this is a 2D-canvas getImageData(), i.e. a
// synchronous GPU readback, far too expensive for a per-frame call.
let colorCtx: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, [number, number, number]>();
function cssColorToRgb01(css: string): [number, number, number] {
  const hit = colorCache.get(css);
  if (hit) return hit;
  let rgb: [number, number, number] = [1, 1, 1];
  if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (colorCtx) {
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.fillStyle = '#000000';
    colorCtx.fillStyle = css;
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    rgb = [d[0] / 255, d[1] / 255, d[2] / 255];
  }
  colorCache.set(css, rgb);
  return rgb;
}

export interface SpecularButtonOptions {
  radius?: number;
  tint?: string;
  tintOpacity?: number;
  blur?: number;
  textColor?: string;
  lineColor?: string;
  baseColor?: string;
  intensity?: number;
  /** Light level at rest (0..1), before the pointer comes near. */
  idleIntensity?: number;
  shineSize?: number;
  shineFade?: number;
  thickness?: number;
  /** Soft glow along the lit rim and pooled at the entry point. */
  glow?: number;
  speed?: number;
  followMouse?: boolean;
  proximity?: number;
  autoAnimate?: boolean;
  disabled?: boolean;
}

const DEFAULTS: Required<SpecularButtonOptions> = {
  radius: 18,
  tint: '#ffffff',
  tintOpacity: 0,
  blur: 0,
  textColor: '#f5f5f5',
  lineColor: '#ffffff',
  baseColor: '#525252',
  intensity: 1,
  idleIntensity: 0.35,
  shineSize: 10,
  shineFade: 34,
  thickness: 1.2,
  glow: 1,
  speed: 0.35,
  followMouse: true,
  proximity: 250,
  autoAnimate: false,
  disabled: false,
};

export class SpecularButton {
  btn: HTMLElement;
  opts: Required<SpecularButtonOptions>;

  private fx: HTMLElement | null = null;
  private canvas!: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buf: WebGLBuffer | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;

  private view = { width: 1, height: 1, ratio: 1 };
  private pointer = { x: 0, y: 0, known: false };
  private state = { spot: 0, level: 0, press: 0, ready: false };
  private raf = 0;
  private last = 0;
  private visible = true;
  private destroyed = false;
  private reduce = false;
  private lineRgb: [number, number, number];
  private baseRgb: [number, number, number];

  constructor(btn: HTMLElement, options: SpecularButtonOptions = {}) {
    this.btn = btn;
    const o = Object.assign({}, DEFAULTS, options);
    o.radius = Math.max(0, o.radius);
    o.intensity = Math.max(0, o.intensity);
    o.idleIntensity = clamp(o.idleIntensity, 0, 1);
    o.shineSize = Math.max(0, o.shineSize);
    o.shineFade = Math.max(0, o.shineFade);
    o.thickness = Math.max(0, o.thickness);
    o.glow = Math.max(0, o.glow);
    o.proximity = Math.max(1, o.proximity);
    this.opts = o;
    this.lineRgb = cssColorToRgb01(o.lineColor);
    this.baseRgb = cssColorToRgb01(o.baseColor);
    this.reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.applyCssVars();
    this.init();
  }

  // The button's own CSS reads these (border-radius etc.).
  private applyCssVars() {
    const s = this.btn.style;
    s.setProperty('--sb-radius', this.opts.radius + 'px');
    s.setProperty('--sb-tint', this.opts.tint);
    s.setProperty('--sb-tint-opacity', String(this.opts.tintOpacity));
    s.setProperty('--sb-blur', this.opts.blur + 'px');
    s.setProperty('--sb-text-color', this.opts.textColor);
  }

  private init() {
    this.fx = this.btn.querySelector<HTMLElement>('.specular-button__fx');
    if (!this.fx) {
      console.error('SpecularButton: no .specular-button__fx element inside the button.');
      return;
    }

    this.canvas = document.createElement('canvas');
    // A brand-new canvas has no guarantee its first clear has reached the
    // screen before the browser paints it — some drivers present an
    // untouched WebGL backing store as solid white for that first frame.
    // It stays invisible until reveal() has confirmed a cleared frame was
    // composited.
    this.canvas.style.opacity = '0';
    this.fx.appendChild(this.canvas);

    // The GPU can drop this context at any time (back/forward cache restore,
    // driver reset, too many live contexts); left alone the canvas would
    // show an undefined — often solid white — frame forever.
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) {
      console.warn('SpecularButton: WebGL2 unavailable, effect skipped.');
      return;
    }
    this.gl = gl;
    if (!this.setupGL()) return;

    this.ro = new ResizeObserver((entries) => this.measure(entries[entries.length - 1]));
    this.ro.observe(this.btn);
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) {
        this.last = 0;
        this.wake();
      }
    });
    this.io.observe(this.btn);

    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerEnd, { passive: true });
    window.addEventListener('pointercancel', this.onPointerEnd, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave);
    this.btn.addEventListener('pointerdown', this.onPointerDown);

    this.measure();
    this.reveal();
  }

  // Everything that lives ON the GL context (program, buffer, VAO, uniform
  // locations) — lost with the context, so rebuilt from scratch on restore.
  private setupGL(): boolean {
    const gl = this.gl!;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
      console.error('SpecularButton shader error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPosition');
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('SpecularButton program link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return false;
    }
    this.prog = prog;
    for (const name of UNIFORM_NAMES) this.uniforms[name] = gl.getUniformLocation(prog, name);

    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return true;
  }

  // Two animation frames past the synchronous clear in measure() (one for
  // the browser to composite it, one for margin) before the canvas is shown.
  private reveal() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.destroyed && this.canvas) this.canvas.style.opacity = '1';
      });
    });
  }

  private onContextLost = (e: Event) => {
    // preventDefault() tells the browser we intend to restore the context
    // ourselves — without it 'webglcontextrestored' never fires.
    e.preventDefault();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.style.opacity = '0';
  };

  private onContextRestored = () => {
    if (this.destroyed) return;
    if (!this.setupGL()) return;
    this.measure();
    this.reveal();
    this.last = 0;
    this.wake();
  };

  private cornerRadius() {
    return Math.min(this.opts.radius, this.view.width / 2, this.view.height / 2);
  }

  // Where the light rests: just inside the top-left corner.
  private restSpot() {
    const r = this.cornerRadius();
    const inset = r * (1 - Math.SQRT1_2);
    const { width, height } = this.view;
    return loopPosition(inset - width / 2, height / 2 - inset, width / 2, height / 2, r);
  }

  // Where the pointer wants the light, and how near it is (0..1).
  private aim(): { spot: number; near: number } | null {
    const o = this.opts;
    if (!o.followMouse || o.disabled || !this.pointer.known) return null;
    const { width, height } = this.view;
    const rect = this.btn.getBoundingClientRect();
    const scale = rect.width / width || 1;
    const halfX = width / 2;
    const halfY = height / 2;
    const x = (this.pointer.x - rect.left - rect.width / 2) / scale;
    const y = (rect.top + rect.height / 2 - this.pointer.y) / scale;
    const distance = Math.hypot(Math.max(Math.abs(x) - halfX, 0), Math.max(Math.abs(y) - halfY, 0));
    const t = clamp(1 - distance / o.proximity, 0, 1);
    const near = t * t * (3 - 2 * t);
    const nearest = loopPosition(x, y, halfX, halfY, this.cornerRadius());
    if (distance > 0) return { spot: nearest, near };
    // Pointer over the button itself: ease from the nearest rim point toward
    // a resting spot that sways with where the pointer is inside.
    const depth = clamp(Math.min(halfX - Math.abs(x), halfY - Math.abs(y)) / (halfY * 0.8), 0, 1);
    const sway = this.restSpot() - (x / halfX) * 0.06 - (y / halfY) * 0.02;
    const offset = sway - nearest - Math.round(sway - nearest);
    return { spot: wrap(nearest + offset * depth * depth * (3 - 2 * depth)), near };
  }

  private draw() {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    const o = this.opts;
    const u = this.uniforms;
    const { width, height, ratio } = this.view;
    const c = this.canvas;
    const scaleX = c.width / (width + PAD * 2);
    const scaleY = c.height / (height + PAD * 2);
    const r = this.cornerRadius();
    const [rimX, rimY] = rimPoint(this.state.spot, width / 2, height / 2, r);
    const rimLen = Math.hypot(rimX, rimY);
    const pull = 1 - Math.min(0.35 * (height / 2), rimLen) / Math.max(rimLen, 0.0001);

    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(u.uCenter, (PAD + width / 2) * scaleX, (PAD + height / 2) * scaleY);
    gl.uniform2f(u.uHalf, (width / 2) * scaleX, (height / 2) * scaleY);
    gl.uniform1f(u.uRadius, r * scaleX);
    gl.uniform1f(u.uPx, ratio);
    gl.uniform1f(u.uSpot, this.state.spot);
    gl.uniform2f(u.uEntry, rimX * pull * scaleX, rimY * pull * scaleY);
    gl.uniform3fv(u.uLineColor, this.lineRgb);
    gl.uniform3fv(u.uBaseColor, this.baseRgb);
    gl.uniform1f(u.uIntensity, o.intensity * (this.state.level + this.state.press * 0.8));
    gl.uniform2f(u.uWindow, o.shineSize / 360 + this.state.press * 0.06, o.shineFade / 360 + 0.0001);
    gl.uniform1f(u.uThickness, o.thickness);
    gl.uniform1f(u.uGlow, o.glow);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.destroyed || !this.visible || !this.gl) return;
    const o = this.opts;
    const s = this.state;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const target = this.aim();
    const spinning = o.autoAnimate && !this.reduce;
    const steering = !!target && target.near > 0;
    if (!s.ready) {
      s.spot = this.restSpot();
      s.level = o.autoAnimate ? 1 : o.idleIntensity;
      s.ready = true;
    }
    let diff = 0;
    if (spinning && !steering) s.spot = wrap(s.spot + (o.speed / TAU) * dt);
    else {
      diff = (steering ? target!.spot : this.restSpot()) - s.spot;
      diff -= Math.round(diff);
      s.spot = wrap(s.spot + diff * (1 - Math.exp(-dt * 8)));
    }
    const level = o.autoAnimate ? 1 : o.idleIntensity + (1 - o.idleIntensity) * (target ? target.near : 0);
    s.level += (level - s.level) * (1 - Math.exp(-dt * 7));
    s.press *= Math.exp(-dt * 5);
    this.draw();
    const settling = Math.abs(diff) > 0.0002 || Math.abs(level - s.level) > 0.001 || s.press > 0.002;
    if (settling || (spinning && !steering)) this.raf = requestAnimationFrame(this.frame);
    else this.last = 0;
  };

  private wake() {
    if (!this.raf && this.visible && !this.destroyed && this.gl) this.raf = requestAnimationFrame(this.frame);
  }

  private measure(entry?: ResizeObserverEntry) {
    const gl = this.gl;
    if (!gl || this.destroyed) return;
    const box = entry?.borderBoxSize?.[0];
    const v = this.view;
    v.width = Math.max(1, box ? box.inlineSize : this.btn.offsetWidth);
    v.height = Math.max(1, box ? box.blockSize : this.btn.offsetHeight);
    v.ratio = Math.min(window.devicePixelRatio || 1, 3);
    const c = this.canvas;
    c.width = Math.max(1, Math.round((v.width + PAD * 2) * v.ratio));
    c.height = Math.max(1, Math.round((v.height + PAD * 2) * v.ratio));
    c.style.width = v.width + PAD * 2 + 'px';
    c.style.height = v.height + PAD * 2 + 'px';
    // Setting canvas.width/height resets the backing store to undefined
    // content (some drivers show it as a white flash): clear it right away.
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.state.ready) this.draw();
    this.wake();
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.known = true;
    this.wake();
  };

  private onPointerDown = (e: PointerEvent) => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.known = true;
    if (!this.opts.disabled) this.state.press = 1;
    this.wake();
  };

  // A finger lifting leaves no pointer behind; a mouse keeps its position.
  private onPointerEnd = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    this.pointer.known = false;
    this.wake();
  };

  private onPointerLeave = () => {
    this.pointer.known = false;
    this.wake();
  };

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro?.disconnect();
    this.io?.disconnect();
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerEnd);
    window.removeEventListener('pointercancel', this.onPointerEnd);
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.btn.removeEventListener('pointerdown', this.onPointerDown);
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    const gl = this.gl;
    if (gl) {
      if (this.buf) gl.deleteBuffer(this.buf);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.prog) gl.deleteProgram(this.prog);
    }
    if (this.canvas && this.canvas.parentNode === this.fx) this.fx!.removeChild(this.canvas);
    // Free the GPU context now rather than whenever the canvas is collected.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
