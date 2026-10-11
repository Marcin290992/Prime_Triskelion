// Ghost cursor — plain JavaScript and WebGL2, no dependencies.
//
// A drift of smoke that follows the cursor over the footer and trails off
// behind it, under the icons and the wordmark (which cut through it). A
// port of React Bits' GhostCursor without three.js: one fragment shader, no
// composer, bloom or film pass (the site has its own grain).
//
// Cheaper than the original by design: the smoke field depends only on the
// pixel and the time, so it's computed once per pixel, and only the cursor
// falloff is summed over the trail (the original redid the whole fbm for
// every one of the 50 trail points). Drawn at a fraction of the screen's
// resolution (it's soft anyway), only on desktop with a mouse, only while
// the footer is on screen and the smoke hasn't faded out.
//
// To remove it for good: delete this file and its import in Layout.astro.
// Nothing else references it.

// Kill switch: set to false and nothing is mounted.
const ENABLED = true;

const OPTS = {
  color: [242 / 255, 237 / 255, 232 / 255], // the site's cream
  brightness: 0.35,
  trailLength: 50,
  inertia: 0.5,
  // Materialise / dematerialise: time constants of the ease toward fully
  // shown or gone (about 3x this to settle), as the cursor comes over the
  // footer or leaves it — by moving or by the page scrolling under it.
  fadeInMs: 320,
  fadeOutMs: 520,
  maxDpr: 0.5, // render scale relative to CSS px
  pixelBudget: 1.3e6, // device pixels at most; scaled down beyond
};

const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAG = (n) => `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uTrail[${n}]; // 0..1, y up; [0] is the cursor
uniform float uOpacity;
uniform float uScale;
uniform vec3 uColor;
uniform float uBrightness;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f *= f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p * 2.0; a *= 0.5; }
  return v;
}

void main() {
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 uv = (gl_FragCoord.xy / uRes * 2.0 - 1.0) * aspect;

  // The smoke itself (domain-warped fbm), once per pixel.
  vec2 p = uv * uScale;
  vec2 q = vec2(fbm(p + uTime * 0.1), fbm(p + vec2(5.2, 1.3) + uTime * 0.1));
  vec2 r = vec2(fbm(p + q * 1.5 + uTime * 0.15), fbm(p + q * 1.5 + vec2(8.3, 2.8) + uTime * 0.15));
  float smoke = pow(fbm(p + r * 0.8), 2.5);

  // Where it shows: around the cursor and, fading, along its trail.
  float radius = (0.5 + 0.3 / uScale) * uOpacity;
  float acc = 0.0;
  for (int i = 0; i < ${n}; i++) {
    float t = 1.0 - float(i) / float(${n});
    t = i == 0 ? 1.0 : t * t * 0.8;
    if (t < 0.01) continue;
    vec2 m = (uTrail[i] * 2.0 - 1.0) * aspect;
    acc += t * (1.0 - smoothstep(0.0, max(radius, 1e-4), length(uv - m)));
  }

  // Cream drifting toward a cool silver and back, like the hero's light.
  vec3 c1 = mix(uColor, vec3(1.0), 0.15);
  vec3 c2 = mix(uColor, vec3(0.8, 0.9, 1.0), 0.25);
  vec3 tint = mix(c1, c2, sin(uTime * 0.5) * 0.5 + 0.5);

  // Soft shoulder instead of a hard clip: dense smoke settles at a grey
  // haze and never burns to white, so the wordmark stays readable in it.
  float density = smoke * acc * uOpacity;
  vec3 col = tint * (1.0 - exp(-density * uBrightness * 1.6)) * 0.5;
  // Premultiplied: the colour over the footer's black, nothing elsewhere.
  fragColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;

function canRun() {
  if (!ENABLED) return false;
  const desktop = window.matchMedia(
    '(min-width: 1025px) and (hover: hover) and (pointer: fine)'
  ).matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return desktop && !reduce;
}

function mountGhostCursor() {
  if (!canRun()) return;
  const host = document.getElementById('site-footer');
  if (!host || host.querySelector('.ghost-cursor')) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'ghost-cursor';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '0',
  });
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return;

  // Lift the footer's own content above the smoke (the canvas is positioned,
  // so it would otherwise paint over static siblings). Restored on cleanup.
  const prevHostPos = host.style.position;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const lifted = [];
  for (const el of host.children) {
    lifted.push([el, el.style.position, el.style.zIndex]);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.zIndex = '1';
  }
  host.prepend(canvas);
  const unmount = () => {
    canvas.remove();
    host.style.position = prevHostPos;
    for (const [el, pos, z] of lifted) {
      el.style.position = pos;
      el.style.zIndex = z;
    }
  };

  const N = OPTS.trailLength;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[ghostCursor]', gl.getShaderInfoLog(s));
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG(N)));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    unmount();
    return;
  }
  gl.useProgram(prog);

  // Fullscreen triangle.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  for (const name of ['uTime', 'uRes', 'uTrail', 'uOpacity', 'uScale', 'uColor', 'uBrightness']) {
    u[name] = gl.getUniformLocation(prog, name);
  }
  gl.uniform3f(u.uColor, ...OPTS.color);
  gl.uniform1f(u.uBrightness, OPTS.brightness);

  // Trail: a ring buffer of past positions, flattened newest-first per frame.
  const ring = new Float32Array(N * 2).fill(0.5);
  const trail = new Float32Array(N * 2);
  let head = 0;
  const mouse = [0.5, 0.5]; // what's drawn
  const target = [0.5, 0.5]; // where the pointer is, over the footer
  const vel = [0, 0];
  // The pointer in the window, kept between moves: scrolling carries the
  // footer under a still cursor and fires no pointer event at all.
  const pointer = { x: 0, y: 0, known: false };
  let inside = false;
  let visible = false;
  let opacity = 0;
  let last = performance.now();
  let raf = 0;
  let validSize = false;
  const start = performance.now();

  function resize() {
    const rect = host.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w <= 0 || h <= 0) {
      validSize = false;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, OPTS.maxDpr);
    const need = w * h * dpr * dpr;
    const scale = need <= OPTS.pixelBudget ? 1 : Math.max(0.5, Math.sqrt(OPTS.pixelBudget / need));
    canvas.width = Math.max(1, Math.floor(w * dpr * scale));
    canvas.height = Math.max(1, Math.floor(h * dpr * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    // Smoke grain relative to a 600px reference, as in the original.
    gl.uniform1f(u.uScale, Math.max(0.5, Math.min(2, Math.min(w, h) / 600)));
    validSize = true;
  }

  function frame(now) {
    raf = 0;
    if (!validSize) return;
    const dt = Math.min(100, now - last);
    last = now;

    if (inside) {
      vel[0] = target[0] - mouse[0];
      vel[1] = target[1] - mouse[1];
      mouse[0] = target[0];
      mouse[1] = target[1];
    } else {
      // Gone out: the smoke drifts on a little the way it was going.
      vel[0] *= OPTS.inertia;
      vel[1] *= OPTS.inertia;
      if (vel[0] * vel[0] + vel[1] * vel[1] > 1e-6) {
        mouse[0] += vel[0];
        mouse[1] += vel[1];
      }
    }
    // Ease toward shown / gone. The shader scales the smoke's reach with
    // this too, so it gathers out of the cursor's point and draws back in.
    const tau = inside ? OPTS.fadeInMs : OPTS.fadeOutMs;
    opacity += ((inside ? 1 : 0) - opacity) * (1 - Math.exp(-dt / tau));

    head = (head + 1) % N;
    ring[head * 2] = mouse[0];
    ring[head * 2 + 1] = mouse[1];
    for (let i = 0; i < N; i++) {
      const src = ((head - i + N) % N) * 2;
      trail[i * 2] = ring[src];
      trail[i * 2 + 1] = ring[src + 1];
    }

    gl.uniform2fv(u.uTrail, trail);
    gl.uniform1f(u.uOpacity, opacity);
    gl.uniform1f(u.uTime, (now - start) / 1000);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Keeps going while the cursor is over the footer; once it's out and
    // the smoke has gone, the loop stops until it comes back.
    if (!visible || (!inside && opacity < 0.002)) {
      if (!inside) {
        opacity = 0;
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function ensureLoop() {
    if (!raf && visible) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  // Is the cursor over the footer, and where — from the last known pointer
  // and the footer's box right now (after a move, or a scroll under it).
  function update() {
    if (!visible) return;
    const rect = host.getBoundingClientRect();
    const was = inside;
    inside =
      pointer.known &&
      pointer.x >= rect.left && pointer.x <= rect.right &&
      pointer.y >= rect.top && pointer.y <= rect.bottom;
    if (inside) {
      target[0] = (pointer.x - rect.left) / Math.max(1, rect.width);
      target[1] = 1 - (pointer.y - rect.top) / Math.max(1, rect.height);
      if (!was && opacity < 0.02) {
        // Arriving fresh: start the trail here, not at the old spot.
        mouse[0] = target[0];
        mouse[1] = target[1];
        vel[0] = vel[1] = 0;
        for (let i = 0; i < N; i++) {
          ring[i * 2] = target[0];
          ring[i * 2 + 1] = target[1];
        }
      }
    }
    if (inside || was) ensureLoop();
  }

  function onMove(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.known = true;
    update();
  }
  function onOut(e) {
    // Left the window altogether.
    if (e.relatedTarget) return;
    pointer.known = false;
    update();
  }

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('scroll', update, { passive: true });
  document.addEventListener('pointerout', onOut, { passive: true });

  const ro = new ResizeObserver(() => {
    resize();
    ensureLoop();
  });
  ro.observe(host);

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) {
      update();
    } else {
      // Off screen: nothing to see, so no fade — just stop clean.
      inside = false;
      opacity = 0;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  });
  io.observe(host);

  resize();

  function cleanup() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('scroll', update);
    document.removeEventListener('pointerout', onOut);
    ro.disconnect();
    io.disconnect();
    // Free the GPU context now (see the note in HeroSection's initRays).
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    unmount();
  }

  document.addEventListener('astro:before-swap', cleanup, { once: true });
}

document.addEventListener('astro:page-load', mountGhostCursor);
