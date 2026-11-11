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
  inAt: 0.5,
  inOpacity: 2.0,
  inReveal: 2.0,
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
    canvas.style.filter = on ? '' : 'opacity(0)';
    if (!on) stopAt = performance.now() + OPTS.dimMs + 50;
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
      : { at: OPTS.inAt, opacity: OPTS.inOpacity, reveal: OPTS.inReveal, ease: 'power2.out' };
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

// The hero's exit on Projects and Services, the same going-out as the home
// page's but on the clock, not on the scroll: the first scroll down plays it
// through and holds the page until it is done. The light goes out, then the
// rest goes soft (blur), then sinks into the dark; the first section is then
// put in place under the dark and comes up out of it (dark lifts, then blur),
// and only when it is sharp does the scroll carry on. Scrolling up from the
// top of that section plays it back the other way. Hosts opt in with
// [data-rays-pin]; the section that follows the header is the one that
// comes up. Nothing on the page is moved by script until the first scroll.
// Reduced motion: plain scrolling.
const LIGHT_OUT_S = 1.0; // the light going out
const LIGHT_IN_S = 1.2;  // and coming back
function pinHost(host) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const content = host.nextElementSibling;
  if (!content) return null;
  const maxBlur = window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches ? 14 : 22;

  const layer = (z, extra) => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position:fixed;inset:0;z-index:${z};pointer-events:none;visibility:hidden;${extra}`;
    document.body.appendChild(el);
    return el;
  };
  // (over the page and the grid lines, under the top blur band and the chrome)
  const blur = layer(900, '');
  const veil = layer(901, 'background:#000;opacity:0;');
  const level = { dark: 0, soft: 0 };
  const render = () => {
    const soft = level.soft > 0.001;
    blur.style.visibility = soft ? 'visible' : 'hidden';
    blur.style.backdropFilter = blur.style.webkitBackdropFilter = soft ? `blur(${(level.soft * maxBlur).toFixed(1)}px)` : '';
    const dark = level.dark > 0.001;
    veil.style.visibility = dark ? 'visible' : 'hidden';
    veil.style.opacity = level.dark.toFixed(3);
  };

  // The light: 1 = lit, 0 = out.
  const lit = { v: 1 };
  const apply = () => {
    const canvas = host.querySelector(':scope > .side-rays');
    if (!canvas) return;
    // brightness, not opacity: the entrance tween owns the canvas's opacity
    if (!canvas.style.filter || canvas.style.filter.startsWith('brightness')) {
      canvas.style.filter = lit.v < 0.999 ? `brightness(${lit.v.toFixed(3)})` : '';
    }
  };
  const setLight = (on) => {
    gsap.killTweensOf(lit);
    gsap.to(lit, { v: on ? 1 : 0, duration: on ? LIGHT_IN_S : LIGHT_OUT_S, ease: 'power2.out', onUpdate: apply });
  };

  // Where the section sits when it is "in place": its top at the top of the screen.
  const sectionY = () => Math.round(content.getBoundingClientRect().top + window.scrollY);
  const jump = (y) => {
    const lenis = window.__lenis;
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo(0, y);
  };

  const root = document.documentElement;
  let busy = false;
  let tl = null;
  let away = false;     // has been well into the page since last at its top
  let armedAt = 0;      // scrolling up from the section's top plays the way back only after this (a trackpad tail must not)
  const lock = () => { busy = true; root.style.overflow = 'hidden'; window.__lenis?.stop?.(); };
  const unlock = () => { busy = false; root.style.overflow = ''; window.__lenis?.start?.(); };

  const goDown = () => {
    if (busy) return;
    lock();
    tl = gsap.timeline({ onComplete: () => { armedAt = performance.now() + 700; away = false; unlock(); } })
      .call(() => setLight(false), null, 0)
      .to(level, { soft: 1, duration: 0.8, ease: 'power2.inOut', onUpdate: render }, 0.45)
      .to(level, { dark: 1, duration: 0.7, ease: 'power2.inOut', onUpdate: render }, 0.9)
      .call(() => jump(sectionY()), null, 1.7)
      .to(level, { dark: 0, duration: 0.8, ease: 'power2.inOut', onUpdate: render }, 1.8)
      .to(level, { soft: 0, duration: 0.9, ease: 'power2.out', onUpdate: render }, 1.95);
  };
  const goUp = () => {
    if (busy) return;
    lock();
    tl = gsap.timeline({ onComplete: unlock })
      .to(level, { soft: 1, duration: 0.45, ease: 'power2.out', onUpdate: render }, 0)
      .to(level, { dark: 1, duration: 0.55, ease: 'power2.inOut', onUpdate: render }, 0.1)
      .call(() => { jump(0); setLight(true); }, null, 0.75)
      .to(level, { dark: 0, duration: 0.8, ease: 'power2.inOut', onUpdate: render }, 0.85)
      .to(level, { soft: 0, duration: 0.9, ease: 'power2.out', onUpdate: render }, 1.0);
  };

  const atTop = () => window.scrollY <= 4;
  const atSection = () => Math.abs(window.scrollY - sectionY()) <= 4;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  // dir: +1 = heading down the page, -1 = heading up
  const intent = (dir, e) => {
    if (busy) return stop(e);
    if (dir > 0 && atTop()) { stop(e); goDown(); return; }
    if (dir < 0 && atSection()) {
      stop(e);
      if (performance.now() >= armedAt) goUp();
    }
  };
  const onWheel = (e) => { if (e.deltaY) intent(Math.sign(e.deltaY), e); };
  let touchY = 0;
  const onTouchStart = (e) => { touchY = e.touches[0].clientY; };
  const onTouchMove = (e) => {
    const dy = touchY - e.touches[0].clientY; // finger up = heading down
    if (busy) return stop(e);
    if (Math.abs(dy) > 6) intent(Math.sign(dy), e);
  };
  const DOWN = new Set([' ', 'PageDown', 'ArrowDown', 'End']);
  const UP = new Set(['PageUp', 'ArrowUp', 'Home']);
  const onKey = (e) => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === ' ' && e.shiftKey) return intent(-1, e);
    if (DOWN.has(e.key)) intent(1, e);
    else if (UP.has(e.key)) intent(-1, e);
  };
  // Anything else that moves the page (scrollbar, find, anchors): never rest
  // between the header and the section, settle on the nearer one.
  const onScroll = () => {
    if (busy) return;
    const y = window.scrollY;
    const top = sectionY();
    if (y > top + 40) away = true;
    else if (y <= top + 2 && away) { away = false; armedAt = performance.now() + 700; }
    if (y > 4 && y < top - 4) jump(y > top / 2 ? top : 0);
  };

  const cap = { capture: true, passive: false };
  window.addEventListener('wheel', onWheel, cap);
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', onTouchMove, cap);
  window.addEventListener('keydown', onKey, { capture: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return () => {
    tl?.kill();
    gsap.killTweensOf(lit);
    root.style.overflow = '';
    window.removeEventListener('wheel', onWheel, cap);
    window.removeEventListener('touchstart', onTouchStart, { capture: true });
    window.removeEventListener('touchmove', onTouchMove, cap);
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('scroll', onScroll);
    blur.remove();
    veil.remove();
  };
}


function mountAll() {
  if (!ENABLED) return;
  const cleanups = [];
  document.querySelectorAll('[data-side-rays]').forEach((host) => {
    if (host.hasAttribute('data-rays-pin')) {
      const off = pinHost(host);
      if (off) cleanups.push(off);
    }
    // Phones and tablets (touch) keep the original light: the new shader's
    // ribs rendered with hard edges in Chrome there.
    const c = window.matchMedia('(pointer: coarse)').matches ? mountSideRaysLegacy(host) : mountSideRays(host);
    if (c) cleanups.push(c);
  });
  if (!cleanups.length) return;
  document.addEventListener('astro:before-swap', () => cleanups.forEach((c) => c()), { once: true });
}

document.addEventListener('astro:page-load', mountAll);
