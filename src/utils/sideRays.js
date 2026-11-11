// Side rays — plain JavaScript and WebGL2, no dependencies.
//
// A shaft of light falling into a subpage hero from its top-right corner,
// toward the title — the subpages' echo of the home hero's light. A port of
// the React Bits Pro "Side Rays" component (licensed to the site's owner)
// without React: one fragment shader on a fullscreen triangle.
//
// Mounted into every [data-side-rays] element (Services, Projects, 404
// and About's black veil, so it lifts with it). It lights up just after
// the title's entrance, runs only while the hero is on screen and the tab
// is visible, and is freed on navigation.
// Reduced motion: one still frame.
//
// To remove it for good: delete this file, its import in Layout.astro and
// the data-side-rays attributes. Nothing else references it.

import gsap from 'gsap';
import { afterPageTransition, subpageMode } from './afterPageTransition';
import { mountSideRaysLegacy } from './sideRaysLegacy';

// Kill switch: set to false and nothing is mounted.
const ENABLED = true;

const PIXEL_BUDGET = 2.4e6;

const OPTS = {
  // Both shafts white-ish, like the home hero's light (a trace of blue in
  // the second so the two layers read apart).
  rayColor1: [1, 1, 1],
  rayColor2: [0.86, 0.91, 1],
  blend: 0.6,
  // The component's own scalings (speed x0.4, intensity x0.75, spread
  // x0.225, glow x1.2), so these read like its props: speed 2.5, spread 2,
  // glow 1.
  speed: 2.5 * 0.4,
  // Strength per screen, tuned against the home hero's light: the title
  // sits at a different distance from the corner on each, so one number
  // can't fit all (a phone's narrow hero puts it close, a tablet's wide,
  // short one far).
  intensity: 1.7 * 0.75, // desktop
  intensityCompact: 0.9 * 0.75, // phones
  intensityTablet: 1.45 * 0.75, // tablets (touch or <=1024px, 700px and wider)
  spread: 3 * 0.225,
  density: 5,
  sharpness: 0.05,
  falloff: 0.65,
  glow: 1.0 * 1.2,
  saturation: 1,
  dust: 0,
  opacity: 1,
  tilt: 0, // degrees, added to the aim
  origin: 'top-right', // top-right | top-left | bottom-right | bottom-left | right | left
  // Where the shaft points (fraction of the hero, from its top-left: the
  // titles sit low on the left). The component's heading is fixed, so the
  // aim is turned into a rotation of it.
  aim: [0.18, 0.78],
  // Phones and tablets: the heroes are shorter and centre the title.
  aimCompact: [0.25, 0.55],
  // Desktop only: the shaft leans toward the cursor (a share of the angle).
  mouseInfluence: 0.5,
  maxDpr: 1, // soft light, nothing gained above this
  // Off once less than this share of the hero is on screen (its lower part
  // fades out anyway); faded out / back in over these (ms).
  activeRatio: 0.35,
  dimMs: 1400,   // slow, always the same length — the light never cuts out
  relightMs: 1600,
  // Entrance, as the home hero's light: it starts as the lead is half in
  // (the lead runs 0.15-0.85s in titleIn/supportIn's short entrance), and the
  // rays grow out of their source to full length (reveal) while the light
  // fades up (opacity) — a sunrise of about two seconds. Seconds.
  inAt: 0.2,
  inOpacity: 2.5,
  inReveal: 2.5,
  // Phones and tablets: same start, then a sunrise — the light creeps up
  // from nothing (slow start, power1.in) and keeps growing for seconds,
  // never jumping in (power2.out did most of its change at once). Kept to
  // ~2-3s: the earlier 5-6s made the wait too long.
  inCompact: { at: 0.1, opacity: 1.8, reveal: 2.3, ease: 'power1.inOut' },
};

const VERT = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uBlend;
uniform float uIntensity;
uniform float uSpread;
uniform float uDensity;
uniform float uSharpness;
uniform float uFalloff;
uniform float uGlow;
uniform float uSaturation;
uniform float uDust;
uniform float uOpacity;
uniform float uReveal;
uniform float uLight;
uniform vec3 uFrame;
uniform float uAim;
uniform vec3 uFocus;
uniform float uSway;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float shafts(float u, float t, float seed, float aa) {
  float sway = (0.4 * sin(t * 0.31 + seed) + 0.24 * sin(t * 0.17 + seed * 2.3)) * uSway;
  float n = 0.7 * noise(vec2(u + sway + seed, t * 0.3)) + 0.3 * noise(vec2(u * 2.4 + sway * 1.5 + seed * 1.7, t * 0.45 + 3.0));
  float width = mix(0.5, 0.1, uSharpness);
  float s = mix(smoothstep(0.5 - width, 0.5 + width, n), 0.5, aa);
  return mix(0.05, 1.0, s);
}

float motes(vec2 p, float cell, float t, float seed) {
  p += vec2(t * 0.021, -t * 0.013) + seed * 7.31;
  vec2 grid = p / cell;
  vec2 id = floor(grid);
  vec2 f = grid - id;
  float h = hash(id + seed);
  if (h > 0.5) return 0.0;
  vec2 center = 0.25 + 0.5 * vec2(hash(id + 1.7 + seed), hash(id + 3.1 + seed));
  center += 0.1 * vec2(sin(t * 0.7 + h * 31.0), cos(t * 0.6 + h * 23.0));
  float size = mix(0.035, 0.09, hash(id + 5.3 + seed));
  float edge = length(fwidth(grid)) * 0.7;
  float twinkle = 0.55 + 0.45 * sin(t * 1.9 + h * 41.0);
  return (1.0 - smoothstep(size - edge, size + edge, length(f - center))) * twinkle;
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 q = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  if (uFrame.x > 0.5) q.x = -q.x;
  if (uFrame.y > 0.5) q.y = -q.y;
  vec2 source = uFrame.z > 0.5 ? vec2(aspect * 0.5 + 0.42, 0.3) : vec2(aspect * 0.5 + 0.1, 0.62);
  float heading = (uFrame.z > 0.5 ? 3.42 : -2.48) + uAim + 0.035 * sin(uTime * 0.21) * uSway;
  vec2 v = q - source;
  float r = length(v);
  float angle = mod(atan(v.y, v.x) - heading + 3.14159265, 6.28318531) - 3.14159265;
  float t = uTime;
  float u = angle * uDensity;
  float aa = smoothstep(0.12, 0.45, fwidth(u));
  float offset = uSpread * 0.22;
  float fanA = exp(-pow((angle + offset) / uSpread, 2.0) * 1.4);
  float fanB = exp(-pow((angle - offset) / (uSpread * 1.15), 2.0) * 1.4);
  float focus = 1.0 + uFocus.z * exp(-pow((angle - uFocus.x) / uFocus.y, 2.0));
  float lightA = fanA * shafts(u, t, 0.0, aa) * focus;
  float lightB = fanB * shafts(u * 0.83, t * 0.6, 17.0, aa) * focus;
  float reach = 1.0 / (1.0 + pow(r / 0.4, uFalloff));
  vec3 glowColor = mix(uColorA, uColorB, uBlend);
  vec3 light = (uColorA * lightA * (1.0 - uBlend) + uColorB * lightB * uBlend) * 2.0 * reach;
  light += glowColor * uGlow * exp(-pow(r / 0.4, 2.0));
  if (uDust > 0.0) {
    float sparkle = motes(q, 0.06, t, 0.0) + 0.7 * motes(q, 0.038, t * 0.8, 9.0);
    light += mix(glowColor, vec3(1.0), 0.6) * sparkle * (lightA + lightB) * reach * uDust * 2.5;
  }
  light *= uIntensity * (1.0 - smoothstep(uReveal * 2.6 - 0.45, uReveal * 2.6, r)) * smoothstep(0.0, 0.35, uReveal);
  float gray = dot(light, vec3(0.2126, 0.7152, 0.0722));
  light = max(mix(vec3(gray), light, uSaturation), 0.0);
  float peak = max(light.r, max(light.g, light.b));
  float grain = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  if (uLight > 0.5) {
    vec3 ink = pow(light / max(peak, 1e-4), vec3(2.0)) * 0.75;
    float alpha = clamp(pow(1.0 - exp(-peak * 2.6), 2.5) * 0.9 * uOpacity + grain, 0.0, 1.0);
    fragColor = vec4(pow(ink, vec3(1.0 / 2.2)) * alpha, alpha);
    return;
  }
  float mapped = 1.0 - exp(-peak);
  vec3 tone = light * (mapped / max(peak, 1e-4));
  tone = mix(tone, vec3(mapped), smoothstep(0.7, 1.0, mapped) * 0.55);
  vec3 shown = clamp(tone * uOpacity, 0.0, 1.0);
  float alpha = max(shown.r, max(shown.g, shown.b));
  vec3 color = clamp(shown * alpha + grain, 0.0, 1.0);
  fragColor = vec4(min(color, vec3(alpha)), alpha);
}`;

// [flipX, flipY, side] per origin (see the shader).
const FRAMES = {
  'top-right': [0, 0, 0],
  'top-left': [1, 0, 0],
  'bottom-right': [0, 1, 0],
  'bottom-left': [1, 1, 0],
  right: [0, 0, 1],
  left: [1, 0, 1],
};

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

// The component's light source and heading for a frame (as in the shader).
function geometryFor(frame, aspect) {
  return {
    source: frame[2] ? [aspect * 0.5 + 0.42, 0.3] : [aspect * 0.5 + 0.1, 0.62],
    heading: frame[2] ? 3.42 : -2.48,
  };
}

function mountSideRays(host) {
  if (host.querySelector(':scope > .side-rays')) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'side-rays';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    // Behind the hero's content, above the page's black (the host isolates).
    zIndex: '-1',
    opacity: '0',
  });
  // Faded out toward the hero's bottom edge, like the home hero's bottom
  // fade — the light dies into the page's black instead of ending on a line.
  const fade = 'linear-gradient(to bottom, #000 0%, #000 45%, rgb(0 0 0 / 0.55) 72%, transparent 100%)';
  canvas.style.maskImage = fade;
  canvas.style.setProperty('-webkit-mask-image', fade);
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  const prevPos = host.style.position;
  const prevIso = host.style.isolation;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.style.isolation = 'isolate';
  host.append(canvas);
  const unmount = () => {
    canvas.remove();
    host.style.position = prevPos;
    host.style.isolation = prevIso;
  };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[sideRays]', gl.getShaderInfoLog(s));
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    unmount();
    return null;
  }
  gl.useProgram(prog);
  gl.clearColor(0, 0, 0, 0);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const u = {};
  for (const name of [
    'uResolution', 'uTime', 'uColorA', 'uColorB', 'uBlend', 'uIntensity', 'uSpread', 'uDensity',
    'uSharpness', 'uFalloff', 'uGlow', 'uSaturation', 'uDust', 'uOpacity', 'uReveal', 'uLight',
    'uFrame', 'uAim', 'uFocus', 'uSway',
  ]) {
    u[name] = gl.getUniformLocation(prog, name);
  }

  const frame = FRAMES[OPTS.origin] ?? FRAMES['top-right'];
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  gl.uniform3f(u.uColorA, ...OPTS.rayColor1);
  gl.uniform3f(u.uColorB, ...OPTS.rayColor2);
  gl.uniform1f(u.uBlend, OPTS.blend);
  gl.uniform1f(u.uSpread, OPTS.spread);
  gl.uniform1f(u.uDensity, OPTS.density);
  gl.uniform1f(u.uSharpness, OPTS.sharpness);
  gl.uniform1f(u.uFalloff, OPTS.falloff);
  gl.uniform1f(u.uGlow, OPTS.glow);
  gl.uniform1f(u.uSaturation, OPTS.saturation);
  gl.uniform1f(u.uDust, OPTS.dust);
  gl.uniform1f(u.uOpacity, OPTS.opacity);
  gl.uniform1f(u.uLight, 0);
  gl.uniform3f(u.uFrame, ...frame);
  gl.uniform1f(u.uSway, still ? 0 : 1);

  // A hero can aim elsewhere on desktop: data-side-rays="0.5,0.5" (About's
  // centred title). Phones and tablets aim the same on every page.
  const ownAim = (host.dataset.sideRays || '').split(',').map(Number);
  const compact = window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)');
  const compactIntensityScale = host.dataset.sideRaysIntensity === undefined ? 1 : Number(host.dataset.sideRaysIntensity);
  const setIntensity = () => {
    gl.uniform1f(u.uIntensity, !compact.matches ? OPTS.intensity
      : (window.innerWidth >= 700 ? OPTS.intensityTablet : OPTS.intensityCompact) * compactIntensityScale);
  };
  setIntensity();

  // The heading is fixed in the component; the aim point (a fraction of the
  // hero from its top-left) becomes a rotation of it, so the shaft's centre
  // runs through the title.
  let aimBase = 0;
  const computeAim = () => {
    const f = compact.matches ? OPTS.aimCompact
      : ownAim.length === 2 && ownAim.every(Number.isFinite) ? ownAim : OPTS.aim;
    const aspect = canvas.width / Math.max(canvas.height, 1);
    const { source, heading } = geometryFor(frame, aspect);
    // The aim point in the shader's space (y up, centred, in heights); the
    // frame flips mirror it, so un-mirror the point the same way.
    let x = (f[0] - 0.5) * aspect;
    let y = 0.5 - f[1];
    if (frame[0]) x = -x;
    if (frame[1]) y = -y;
    aimBase = wrapAngle(Math.atan2(y - source[1], x - source[0]) - heading) + (OPTS.tilt * Math.PI) / 180;
  };

  // Desktop only: the shaft leans toward the cursor, the shaft near it
  // brightens (the component's pointer behaviour).
  const follow = { value: 0, velocity: 0, focusAngle: 0, focusStrength: 0 };
  const pointer = { x: 0, y: 0, inside: false };
  const tracks = () => !compact.matches && !still;
  const pointerAngle = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    let x = (pointer.x - w / 2) / h;
    let y = (h / 2 - pointer.y) / h;
    if (frame[0]) x = -x;
    if (frame[1]) y = -y;
    const { source, heading } = geometryFor(frame, w / h);
    return wrapAngle(Math.atan2(y - source[1], x - source[0]) - heading - aimBase);
  };
  const onPointerMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    ensureLoop();
  };
  const onLeave = () => { pointer.inside = false; ensureLoop(); };
  const onPointerUp = (e) => { if (e.pointerType !== 'mouse') onLeave(); };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);

  let raf = 0;
  let visible = false;
  // Lit only while the hero is really in view: once most of it has been
  // scrolled past (or the host says so — About's veil, .rays-off) the light
  // fades out and stops rendering; coming back fades it in again. Nobody
  // sees it out there, and it was the one thing still drawing every frame.
  let active = true;
  let stopAt = 0; // while fading out: keep drawing until then (ms)
  const setActive = (on) => {
    if (on === active) return;
    active = on;
    canvas.style.transition = on ? `filter ${OPTS.relightMs}ms ease` : `filter ${OPTS.dimMs}ms ease`;
    canvas.style.filter = on ? '' : 'opacity(0)';    if (!on) stopAt = performance.now() + OPTS.dimMs + 50;
    ensureLoop();
  };

  const intro = { reveal: 0 };
  let tweens = [];
  let time = Math.random() * 100;
  let lastNow = 0;

  function draw(now) {
    const dt = lastNow && now - lastNow < 100 ? Math.min(Math.max((now - lastNow) / 1000, 0), 0.05) : 1 / 60;
    lastNow = now;
    time += dt * OPTS.speed * (still ? 0.3 : 1);

    // Follow the cursor with a spring, as the component does.
    const tracking = tracks() && pointer.inside;
    const pointed = tracking ? pointerAngle() : 0;
    const spread = OPTS.spread;
    const target = tracking ? clamp(pointed, -spread, spread) * OPTS.mouseInfluence : 0;
    const focusTarget = tracking ? OPTS.mouseInfluence : 0;
    const ease = 1 - Math.exp(-dt * 6);
    if (tracking) follow.focusAngle += (clamp(pointed - follow.value, -spread * 1.5, spread * 1.5) - follow.focusAngle) * ease;
    follow.focusStrength += (focusTarget - follow.focusStrength) * ease;
    const stiffness = 18;
    const damping = 2 * Math.sqrt(stiffness);
    follow.velocity += ((target - follow.value) * stiffness - follow.velocity * damping) * dt;
    follow.value += follow.velocity * dt;

    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uReveal, intro.reveal); // eased by the entrance tween
    gl.uniform1f(u.uAim, aimBase + follow.value);
    gl.uniform3f(u.uFocus, follow.focusAngle, Math.max(0.06, spread * 0.25), follow.focusStrength * 1.4);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    if (!active && now > stopAt) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  function ensureLoop() {
    if (still) { draw(0); return; }
    if (!raf && visible && !document.hidden && (active || performance.now() < stopAt)) raf = requestAnimationFrame(loop);
  }

  function resize() {
    const cssW = Math.max(1, host.clientWidth);
    const cssH = Math.max(1, host.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, OPTS.maxDpr, Math.sqrt(PIXEL_BUDGET / (cssW * cssH)));
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.uResolution, w, h);
    computeAim();
    setIntensity();
    if (still) draw(0);
  }

  const ro = new ResizeObserver(() => { resize(); ensureLoop(); });
  ro.observe(host);
  let ratio = 1;
  const update = () => setActive(visible && ratio >= OPTS.activeRatio && !host.classList.contains('rays-off'));
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    ratio = entry.intersectionRatio;
    update();
    ensureLoop();
  }, { threshold: [0, OPTS.activeRatio] });
  io.observe(host);
  const mo = new MutationObserver(update);
  mo.observe(host, { attributes: true, attributeFilter: ['class'] });
  const onVisibility = () => ensureLoop();
  document.addEventListener('visibilitychange', onVisibility);
  resize();

  // Lit after the title, the way the home hero's light comes in: the rays
  // reach out from their source while the light fades up. Back/forward
  // lands on the finished page, so it's simply there.
  afterPageTransition(() => {
    if (subpageMode() === 'none' || still) {
      intro.reveal = 1;
      canvas.style.opacity = '1';
      if (still) draw(0);
      return;
    }
    const c = compact.matches
      ? OPTS.inCompact
      : { at: OPTS.inAt, opacity: OPTS.inOpacity, reveal: OPTS.inReveal, ease: 'power1.inOut' };
    tweens = [
      gsap.to(canvas, { opacity: 1, duration: c.opacity, delay: c.at, ease: c.ease }),
      gsap.to(intro, { reveal: 1, duration: c.reveal, delay: c.at, ease: c.ease }),
    ];
  });

  return () => {
    tweens.forEach((t) => t.kill());
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ro.disconnect();
    io.disconnect();
    mo.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    unmount();
  };
}

// The home hero's exit, on the subpages — built the same way (see index.astro,
// initHeroExit). The header stays put (sticky) for a stretch of scrolling.
// Everything on screen is a plain function of the scroll position, nothing is
// remembered between frames, so going back up is the same scene played in
// reverse: the light goes out first (on the clock), then the header goes soft
// (blur layer) and sinks into the dark (black layer). The page content sits
// above those layers, pulled up to where the pin ends; it comes up out of the
// dark, soft first and then in focus. Hosts opt in with [data-rays-pin]; an
// [data-pin-hold] on the content (screens x 100) keeps its first block still
// for that much scroll while it comes into focus (see projects/index.astro).
// Two fixed layers rather than a filter on the content: the project cards are
// position:fixed, which a filter on an ancestor would break.
const PIN_VH = 100;       // extra scroll the header stays pinned for, in screens x 100 (as on the home page)
const PIN_VH_TOUCH = 100; // the same on phones and tablets, as on the home page
function pinHost(host) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const wrap = document.createElement('div');
  // (a spacer, not padding: a sticky child only travels within its parent's content box)
  const spacer = document.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  const pinVh = window.matchMedia('(pointer: coarse)').matches ? PIN_VH_TOUCH : PIN_VH;
  spacer.style.height = `calc(var(--app-stable-vh, 1svh) * ${pinVh})`;
  host.before(wrap);
  wrap.append(host, spacer);
  host.style.position = 'sticky';
  host.style.top = '0';
  const smooth = (t) => t * t * (3 - 2 * t);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const mkLayer = (z, css) => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position:fixed;inset:0;pointer-events:none;visibility:hidden;z-index:${z};${css}`;
    document.body.append(el);
    return el;
  };
  const blurEl = mkLayer(19, '');                           // softens the header
  const veilEl = mkLayer(20, 'background:#000;opacity:0;'); // sinks it into the dark
  const focusEl = mkLayer(31, '');                          // softens the content coming up (above it)

  // The content, above the layers (as the manifesto on the home page), starting
  // where the pin ends.
  const after = wrap.nextElementSibling;
  if (after) {
    after.style.position = 'relative';
    after.style.zIndex = '30';
    after.style.transition = 'none';
  }

  // The light's own layer: a black sheet over the rays (below the header's
  // content, which is above them), its opacity the only thing that dims the
  // light. Nothing else writes to it, so nothing can undo it.
  host.style.isolation = 'isolate';
  const dimEl = document.createElement('div');
  dimEl.setAttribute('aria-hidden', 'true');
  dimEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:-1;background:#000;opacity:0;';
  host.append(dimEl);

  // Every write below happens only when the value changed, and the sizes are
  // measured once (and again on resize), not on every scroll frame.
  const last = {};
  const put = (el, key, prop, val) => {
    if (last[key] === val) return;
    last[key] = val;
    el.style[prop] = val;
  };
  const setBlur = (el, key, amount) => {
    const on = amount > 0.002;
    put(el, key + 'v', 'visibility', on ? 'visible' : 'hidden');
    const f = on ? `blur(${(amount * 22).toFixed(1)}px)` : '';
    if (last[key + 'f'] === f) return;
    last[key + 'f'] = f;
    el.style.backdropFilter = el.style.webkitBackdropFilter = f;
  };

  let hostH = 0;
  let ticking = false;
  function update() {
    ticking = false;
    const vh = window.innerHeight;
    if (!hostH || last.vh !== vh) {
      hostH = host.offsetHeight;
      last.vh = vh;
      wrap.style.marginBottom = `-${hostH}px`;   // the content starts where the pin ends
    }
    const top = wrap.getBoundingClientRect().top;
    const range = Math.max(1, wrap.offsetHeight - hostH);
    const pos = Math.max(0, -top);
    const p = pos / range;
    // (data-pin-hold-touch: for the phone/tablet layouts, where nothing is held)
    const stacked = window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches;
    const holdAttr = after && (stacked && after.dataset.pinHoldTouch != null ? after.dataset.pinHoldTouch : after.dataset.pinHold);
    const hold = holdAttr ? (vh * parseFloat(holdAttr)) / 100 : 0;
    if (after && last.hold !== Math.round(hold)) {
      last.hold = Math.round(hold);
      after.style.setProperty('--pin-hold', `${last.hold}px`);
    }
    // Layouts with nothing sticky to hold the first block (the phone/tablet
    // stack of Services; [data-pin-hold-shift]): the content is carried down
    // by exactly as much as the page scrolls, so it stands still on screen
    // for the hold; the room it needs at the bottom is made by --shift-pad.
    const shift = !!after && stacked && after.hasAttribute('data-pin-hold-shift') && hold > 0;
    if (after) {
      const pad = shift ? `${last.hold}px` : '0px';
      if (last.pad !== pad) { last.pad = pad; after.style.setProperty('--shift-pad', pad); }
      const tr = shift && pos > range ? `translate3d(0, ${Math.min(pos - range, hold).toFixed(1)}px, 0)` : '';
      if (last.tr !== tr) { last.tr = tr; after.style.transform = tr; }
    }

    // Three stretches of the pin, one after the other, each a function of the
    // scroll position alone: the light goes out (0.02-0.30), the header goes
    // soft (0.30-0.70) and sinks into the dark (0.55-0.95) — the home page's
    // stretches (index.astro, initHeroExit). It stays dark while it scrolls
    // away under the content.
    put(dimEl, 'dm', 'opacity', smooth(clamp01((p - 0.02) / 0.28)).toFixed(3));
    const bk = smooth(clamp01((p - 0.30) / 0.40));
    const a = smooth(clamp01((p - 0.55) / 0.40));
    const live = pos < range + vh;
    setBlur(blurEl, 'b', live ? bk : 0);
    put(veilEl, 'vv', 'visibility', a > 0.002 && live ? 'visible' : 'hidden');
    put(veilEl, 'vo', 'opacity', a.toFixed(3));

    // 3. the content, once the pin is over: up out of the dark, then into focus
    const d = pos > range ? (pos - range) / (hold > 0 ? hold : vh) : 0;
    const shown = smooth(clamp01(d / 0.25));
    const soft = 1 - smooth(clamp01(d / 0.5));
    if (after) {
      put(after, 'ao', 'opacity', shown.toFixed(3));
      put(after, 'ap', 'pointerEvents', shown < 0.05 ? 'none' : '');
    }
    setBlur(focusEl, 'f', shown > 0 ? soft : 0);
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // the header's own size can settle late (fonts, copy): measure it again then
  const hostRO = new ResizeObserver(() => { hostH = 0; onScroll(); });
  hostRO.observe(host);
  update();
  return () => {
    hostRO.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    dimEl.remove();
    blurEl.remove();
    veilEl.remove();
    focusEl.remove();
    if (after) {
      ['position', 'zIndex', 'transition', 'opacity', 'pointerEvents', 'transform'].forEach((k) => { after.style[k] = ''; });
      after.style.removeProperty('--pin-hold');
      after.style.removeProperty('--shift-pad');
    }
    wrap.style.marginBottom = '';
  };
}

function mountAll() {
  if (!ENABLED) return;
  const cleanups = [];
  document.querySelectorAll('[data-side-rays]').forEach((host) => {
    // Phones and tablets (touch) keep the original light: the new shader's
    // ribs rendered with hard edges in Chrome there.
    const c = window.matchMedia('(pointer: coarse)').matches ? mountSideRaysLegacy(host) : mountSideRays(host);
    if (c) cleanups.push(c);
    // the pin comes second: its dimming sheet goes over the light's canvas
    if (host.hasAttribute('data-rays-pin')) {
      const off = pinHost(host);
      if (off) cleanups.push(off);
    }
  });
  if (!cleanups.length) return;
  // Torn down once the old page is gone (after-swap), not before: while it is
  // still on screen the page's exit is fading it to black, and undoing the
  // hero's styles then (the content's opacity, the dark layers) would flash it
  // back for a moment before the swap.
  document.addEventListener('astro:after-swap', () => cleanups.forEach((c) => c()), { once: true });
}

document.addEventListener('astro:page-load', mountAll);
