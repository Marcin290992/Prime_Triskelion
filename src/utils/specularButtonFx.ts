// Direct port of the "SpecularButton" vanilla-JS component — WebGL2 SDF
// rim-light that brightens on cursor proximity and steers toward the
// pointer when hovered. Logic is unchanged from the source; only wrapped
// in TS types and given an Astro-view-transition-aware init/destroy pair.

const PAD = 20;

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uAngle;
uniform float uPx;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform float uShineSize;
uniform float uShineFade;
uniform float uThickness;
uniform float uBaseWidth;

out vec4 fragColor;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float shapeSDF(vec2 p) { return sdRoundedRect(p, uHalfSize, uRadius); }

float gaussianLine(float d, float sigma) {
  float x = d / (sigma + 1e-6);
  float k = mix(1.0, 1.6, smoothstep(0.0, 1.5, x));
  return exp(-k * x * x);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = shapeSDF(p);
  vec2 L = vec2(cos(uAngle), sin(uAngle));

  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(d))) * 0.45;

  vec2 nEll = normalize(p / (uHalfSize * uHalfSize) + 1e-6);
  float phi = acos(clamp(abs(dot(nEll, L)), 0.0, 1.0));
  float rim = 1.0 - smoothstep(uShineSize - uShineFade, uShineSize + uShineFade + 1e-4, phi);
  float line = gaussianLine(d, uThickness);
  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(d));
  float hi = line * rim * edgeClamp * uIntensity;

  vec3 col = uBaseColor * base + uLineColor * hi;
  float a = clamp(base + hi, 0.0, 1.0);
  fragColor = vec4(col, a);
}
`;

let colorCtx: CanvasRenderingContext2D | null = null;
function cssColorToRgb01(css: string): [number, number, number] {
  if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d')!;
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = css;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
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
  shineSize?: number;
  shineFade?: number;
  thickness?: number;
  speed?: number;
  followMouse?: boolean;
  proximity?: number;
  autoAnimate?: boolean;
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
  shineSize: 10,
  shineFade: 40,
  thickness: 1,
  speed: 0.35,
  followMouse: true,
  proximity: 250,
  autoAnimate: false,
};

export class SpecularButton {
  btn: HTMLElement;
  opts: Required<SpecularButtonOptions>;
  private _destroyed = false;
  private gl: WebGL2RenderingContext | null = null;
  private prog!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private fx: HTMLElement | null = null;
  private canvas!: HTMLCanvasElement;
  private ro: ResizeObserver | null = null;
  private dpr = 1;
  private size = { w: 1, h: 1 };
  private _center: [number, number] = [0, 0];
  private _halfSize: [number, number] = [0, 0];

  private _angle = 2.4;
  private _idleAngle = 2.4;
  private _bright = 0;
  private _pointerAngle: number | null = null;
  private _proximityT = 0;
  private _last = performance.now();
  private _raf = 0;

  constructor(btn: HTMLElement, options: SpecularButtonOptions = {}) {
    this.btn = btn;
    this.opts = Object.assign({}, DEFAULTS, options);

    this._applyCssVars();
    this._initGL();
    if (!this.gl) return;

    this._onPointerMove = this._onPointerMove.bind(this);
    window.addEventListener('pointermove', this._onPointerMove);

    this._update = this._update.bind(this);
    this._raf = requestAnimationFrame(this._update);
  }

  private _applyCssVars() {
    const s = this.btn.style;
    s.setProperty('--sb-radius', this.opts.radius + 'px');
    s.setProperty('--sb-tint', this.opts.tint);
    s.setProperty('--sb-tint-opacity', String(this.opts.tintOpacity));
    s.setProperty('--sb-blur', this.opts.blur + 'px');
    s.setProperty('--sb-text-color', this.opts.textColor);
  }

  private _compile(gl: WebGL2RenderingContext, type: number, src: string) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('SpecularButton shader error:', gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  private _initGL() {
    this.fx = this.btn.querySelector('.specular-button__fx');
    if (!this.fx) {
      console.error('SpecularButton: brak elementu .specular-button__fx wewnątrz przycisku.');
      return;
    }

    this.dpr = window.devicePixelRatio || 1;
    this.canvas = document.createElement('canvas');
    // A brand-new canvas — created fresh on every page navigation, since
    // OxygenMenu rebuilds this button each time — has no guarantee its
    // first gl.clear() below has actually reached the screen before the
    // browser paints/snapshots it; some drivers present an untouched
    // WebGL backing store as solid white for that first frame. Same
    // failure mode as the context-loss case a few lines down, just hit
    // on ordinary navigation instead of a GPU reset. Stay invisible until
    // _reveal() confirms a cleared frame has actually been composited.
    this.canvas.style.opacity = '0';
    this.fx.appendChild(this.canvas);

    // The GPU can drop this context at any time — most commonly when the
    // page is restored from the back/forward cache, but also on a driver
    // reset or too many live WebGL contexts. Without handling this, the
    // canvas is left showing an undefined (often solid white) frame
    // forever, which is what read as "the menu button briefly turns into
    // a white square" on back-navigation/reload.
    this._onContextLost = this._onContextLost.bind(this);
    this._onContextRestored = this._onContextRestored.bind(this);
    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) {
      console.warn('SpecularButton: WebGL2 niedostępny, efekt pominięty.');
      return;
    }
    this.gl = gl;
    this._setupGLState();

    this.size = { w: 1, h: 1 };
    this._resize = this._resize.bind(this);
    this.ro = new ResizeObserver(this._resize);
    this.ro.observe(this.btn);
    this._resize();
    this._reveal();
  }

  // Waits two animation frames past the synchronous clear in _resize()
  // (one for the browser to actually composite it, one for margin) before
  // making the canvas visible, so it's never shown mid-transition with an
  // undefined backing store.
  private _reveal() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this._destroyed) this.canvas.style.opacity = '1';
      });
    });
  }

  // Everything that lives ON the GL context itself (program, buffers, VAO,
  // uniform locations) — all of it is invalidated by context loss and must
  // be recreated from scratch on restore, unlike the canvas element and
  // ResizeObserver, which survive.
  private _setupGLState() {
    const gl = this.gl!;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const vs = this._compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = this._compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('SpecularButton program link error:', gl.getProgramInfoLog(prog));
    }
    this.prog = prog;

    const posLoc = gl.getAttribLocation(prog, 'position');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    [
      'uCenter', 'uHalfSize', 'uRadius', 'uAngle', 'uPx',
      'uLineColor', 'uBaseColor', 'uIntensity',
      'uShineSize', 'uShineFade', 'uThickness', 'uBaseWidth',
    ].forEach((name) => {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    });
  }

  private _onContextLost(e: Event) {
    // preventDefault() is required to tell the browser we intend to
    // restore this context ourselves — without it, no
    // 'webglcontextrestored' event ever fires.
    e.preventDefault();
    if (this._raf) cancelAnimationFrame(this._raf);
    // Backing store content is undefined for the rest of the loss window —
    // hide until _onContextRestored() confirms a fresh cleared frame.
    this.canvas.style.opacity = '0';
  }

  private _onContextRestored() {
    if (this._destroyed) return;
    this._setupGLState();
    this._resize();
    this._reveal();
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._update);
  }

  private _resize() {
    const gl = this.gl!;
    const rect = this.btn.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    this.size.w = w;
    this.size.h = h;

    const cw = Math.max(1, Math.round((w + PAD * 2) * this.dpr));
    const ch = Math.max(1, Math.round((h + PAD * 2) * this.dpr));
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.canvas.style.width = w + PAD * 2 + 'px';
    this.canvas.style.height = h + PAD * 2 + 'px';
    gl.viewport(0, 0, cw, ch);

    this._center = [(PAD + w / 2) * this.dpr, (PAD + h / 2) * this.dpr];
    this._halfSize = [(w / 2) * this.dpr, (h / 2) * this.dpr];

    // Setting canvas.width/height resets the backing store to undefined
    // content — some drivers present that as an opaque white flash for a
    // frame if rAF is delayed (e.g. right after page load). Clear synchronously
    // instead of waiting for the first _update() tick.
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private _onPointerMove(e: PointerEvent) {
    const rect = this.btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
    const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
    const dist = Math.hypot(dx, dy);

    if (dist === 0) {
      const nx = (e.clientX - cx) / (rect.width / 2);
      const ny = (cy - e.clientY) / (rect.height / 2);
      this._pointerAngle = Math.atan2(2 / rect.height, -2 / rect.width) + nx * 0.3 + ny * 0.15;
    } else {
      this._pointerAngle = Math.atan2(cy - e.clientY, e.clientX - cx);
    }

    const t = Math.max(0, 1 - dist / Math.max(this.opts.proximity, 1));
    this._proximityT = t * t * (3 - 2 * t);
  }

  private _update(now: number) {
    if (this._destroyed) return;
    this._raf = requestAnimationFrame(this._update);

    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;
    const p = this.opts;

    this._idleAngle += p.speed * dt;
    const steer = p.followMouse && this._pointerAngle != null && (!p.autoAnimate || this._proximityT > 0);
    const target = steer ? this._pointerAngle : this._idleAngle;
    const diff = ((target - this._angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this._angle += diff * (1 - Math.exp(-dt * 7));

    const brightTarget = p.autoAnimate ? 1 : this._proximityT;
    this._bright += (brightTarget - this._bright) * (1 - Math.exp(-dt * 8));

    const lineRgb = cssColorToRgb01(p.lineColor);
    const baseRgb = cssColorToRgb01(p.baseColor);

    const gl = this.gl!;
    const u = this.uniforms;
    gl.useProgram(this.prog);
    gl.uniform2fv(u.uCenter, this._center);
    gl.uniform2fv(u.uHalfSize, this._halfSize);
    gl.uniform1f(u.uRadius, Math.min(p.radius, Math.min(this.size.w, this.size.h) / 2) * this.dpr);
    gl.uniform1f(u.uAngle, this._angle);
    gl.uniform1f(u.uPx, this.dpr);
    gl.uniform3fv(u.uLineColor, lineRgb);
    gl.uniform3fv(u.uBaseColor, baseRgb);
    gl.uniform1f(u.uIntensity, p.intensity * this._bright);
    gl.uniform1f(u.uShineSize, (p.shineSize * Math.PI) / 180);
    gl.uniform1f(u.uShineFade, (p.shineFade * Math.PI) / 180);
    gl.uniform1f(u.uThickness, p.thickness * this.dpr);
    gl.uniform1f(u.uBaseWidth, this.dpr);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.ro) this.ro.disconnect();
    window.removeEventListener('pointermove', this._onPointerMove);
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    }
    if (this.gl && this.canvas && this.canvas.parentNode === this.fx) {
      this.fx!.removeChild(this.canvas);
    }
    const ext = this.gl && this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}
