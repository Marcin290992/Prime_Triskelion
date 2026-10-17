// Side rays, the ORIGINAL version — kept for phones and tablets (touch), where
// the newer Side Rays shader (sideRays.js) rendered hard edges in Chrome.
// Mounted by sideRays.js; unchanged otherwise. Plain JavaScript and WebGL.
//
// A shaft of light falling into a subpage hero from its top-right corner,
// toward the title — the subpages' echo of the home hero's light. A port of
// React Bits' SideRays without React or ogl: one fragment shader on a
// fullscreen triangle.
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

// Kill switch: set to false and nothing is mounted.
const ENABLED = true;

const OPTS = {
  speed: 2.5,
  // White, toned like the home hero's light (the shader cools it toward
  // the bottom the same way — see the tone step in main()).
  rayColor1: [1, 1, 1],
  rayColor2: [1, 1, 1],
  // Strength per screen, tuned against the home hero's light: the title
  // sits at a different distance from the corner on each, so one number
  // can't fit all (a phone's narrow hero puts it close, a tablet's wide,
  // short one far).
  intensity: 2.1, // desktop
  intensityCompact: 0.9, // phones
  intensityTablet: 1.45, // tablets (touch or <=1024px, 700px and wider)
  spread: 1.6,
  origin: 'top-right', // top-right | top-left | bottom-right | bottom-left
  tilt: 0, // degrees
  saturation: 1,
  blend: 0.68,
  falloff: 0.95, // lower = the light reaches further
  opacity: 1,
  // Where the shaft points (fraction of the hero, from its top-left: the
  // titles sit low on the left) and how tightly it gathers around that line
  // (0 = spread evenly like the original, higher = a narrower beam).
  aim: [0.18, 0.78],
  // Phones and tablets: the heroes are shorter and centre the title.
  aimCompact: [0.25, 0.55],
  aimFocus: 2.2,
  maxDpr: 1, // soft light, nothing gained above this
  // Off once less than this share of the hero is on screen (its lower part
  // fades out anyway); faded out / back in over these (ms).
  activeRatio: 0.35,
  dimMs: 500,
  relightMs: 1600,
  // Entrance, as the home hero's light: right after the hero's text has
  // come in (title 0.8s, lead done at ~0.85s — titleIn/supportIn's short
  // entrance) the rays grow out of their source to full length (reveal)
  // while the light fades up (opacity) — seconds.
  inAt: 0.85,
  inOpacity: 2.6,
  inReveal: 3.0,
  // Phones and tablets: same start, then a sunrise — the light creeps up
  // from nothing (slow start, power1.in) and keeps growing for seconds,
  // never jumping in (power2.out did most of its change at once). Kept to
  // ~2-3s: the earlier 5-6s made the wait too long.
  inCompact: { at: 0.1, opacity: 1.8, reveal: 2.3, ease: 'power1.inOut' },
};

const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;
uniform vec2 iAim;
uniform float iAimFocus;
uniform float iReveal; // 0..1: how far the rays reach from their source

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  float reach = max(length(iResolution) * 6.0 * iReveal, 1.0);
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0) *
    // Grow out of the source: a soft front that travels outward as reveal
    // goes to 1 (at 1 it's well past the far corner — no effect).
    (1.0 - smoothstep(reach * 0.25, reach, length(sourceToCoord)));
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;

  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

  // The cone opens as the light grows, as on the home hero.
  float halfSpread = iSpread * 0.275 * (0.7 + 0.3 * iReveal);
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));

  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);

  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;

  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;

  // Gathered toward the title: brighter along the line to it, fading off it.
  vec2 aimDir = normalize(iAim * iResolution - rayPos);
  float along = max(dot(normalize(coord - rayPos), aimDir), 0.0);
  color.rgb *= mix(0.25, 1.15, pow(along, iAimFocus * 8.0));

  // Same tone as the home hero's rays: near-white at the top, cooling to a
  // blue-silver lower down (red falls off fastest, blue least).
  float br = 1.0 - coord.y / iResolution.y;
  color.r *= 0.1 + br * 0.8;
  color.g *= 0.3 + br * 0.6;
  color.b *= 0.5 + br * 0.5;

  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);

  // Premultiplied, light added as is — like the home hero's rays. (Through
  // a straight-alpha canvas the light was squared, and the faint part of
  // the shaft vanished, worst on AMOLED and wide heroes.)
  vec3 c = clamp(color.rgb, 0.0, 1.0) * iOpacity;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

const FLIP = {
  'top-left': [1, 0],
  'bottom-right': [0, 1],
  'bottom-left': [1, 1],
  'top-right': [0, 0],
};

export function mountSideRaysLegacy(host) {
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
  const gl = canvas.getContext('webgl', {
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

  // Fullscreen triangle.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  for (const name of [
    'iTime', 'iResolution', 'iSpeed', 'iRayColor1', 'iRayColor2', 'iIntensity', 'iSpread',
    'iFlipX', 'iFlipY', 'iTilt', 'iSaturation', 'iBlend', 'iFalloff', 'iOpacity',
    'iAim', 'iAimFocus', 'iReveal',
  ]) {
    u[name] = gl.getUniformLocation(prog, name);
  }
  const [flipX, flipY] = FLIP[OPTS.origin] ?? FLIP['top-right'];
  gl.uniform1f(u.iSpeed, OPTS.speed);
  gl.uniform3f(u.iRayColor1, ...OPTS.rayColor1);
  gl.uniform3f(u.iRayColor2, ...OPTS.rayColor2);
  gl.uniform1f(u.iSpread, OPTS.spread);
  gl.uniform1f(u.iFlipX, flipX);
  gl.uniform1f(u.iFlipY, flipY);
  gl.uniform1f(u.iTilt, OPTS.tilt);
  gl.uniform1f(u.iSaturation, OPTS.saturation);
  gl.uniform1f(u.iBlend, OPTS.blend);
  gl.uniform1f(u.iFalloff, OPTS.falloff);
  gl.uniform1f(u.iOpacity, OPTS.opacity);
  // A hero can aim elsewhere on desktop: data-side-rays="0.5,0.5" (About's
  // centred title). Phones and tablets aim the same on every page.
  const ownAim = (host.dataset.sideRays || '').split(',').map(Number);
  const compact = window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)');
  const setIntensity = () => {
    gl.uniform1f(u.iIntensity, !compact.matches ? OPTS.intensity
      : window.innerWidth >= 700 ? OPTS.intensityTablet : OPTS.intensityCompact);
  };
  setIntensity();
  const setAim = () => gl.uniform2f(u.iAim, ...(
    compact.matches ? OPTS.aimCompact
      : ownAim.length === 2 && ownAim.every(Number.isFinite) ? ownAim : OPTS.aim));
  setAim();
  gl.uniform1f(u.iAimFocus, OPTS.aimFocus);

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  function draw(now) {
    gl.uniform1f(u.iTime, now / 1000);
    gl.uniform1f(u.iReveal, intro.reveal);
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
    const dpr = Math.min(window.devicePixelRatio || 1, OPTS.maxDpr);
    const w = Math.max(1, Math.round(host.clientWidth * dpr));
    const h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.iResolution, w, h);
    setAim();
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
    tweens = [
      ...(() => {
        const c = compact.matches
          ? OPTS.inCompact
          : { at: OPTS.inAt, opacity: OPTS.inOpacity, reveal: OPTS.inReveal, ease: 'power2.out' };
        return [
          gsap.to(canvas, { opacity: 1, duration: c.opacity, delay: c.at, ease: c.ease }),
          gsap.to(intro, { reveal: 1, duration: c.reveal, delay: c.at, ease: c.ease }),
        ];
      })(),
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
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    unmount();
  };
}
