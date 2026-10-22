// Film grain — plain JavaScript, no dependencies.
//
// One fixed, full-screen layer of monochrome grain over the whole page.
// The grain tile is drawn once on a canvas (a seeded generator, so it is the
// same every visit): a triangular distribution around mid-grey with a
// contrast setting, which reads as film rather than blotchy noise. The layer
// then jumps to a new random offset FPS times a second. It is moved with
// `transform` (composited, nothing repainted), not by scrolling the texture.
//
// Normal blend at a low opacity, calibrated so black stays deep: the grain
// lifts pure black by roughly OPACITY x 127 levels of 255 (see OPACITY).
//
// On every device (desktop, tablet, phone).
// Still when the user prefers reduced motion; paused while the tab is hidden.

const TILE = 256; // px, the texture is a TILE x TILE square
const CONTRAST = 0.6; // 0..1, how far the grain reaches from mid-grey
const OPACITY = 0.05; // layer opacity -> black lifted by ~OPACITY x 127
const FPS = 24;
const LOOP_SECONDS = 10;
const FRAME_COUNT = FPS * LOOP_SECONDS;
const OVERSCAN = 120; // px the layer extends past the screen, so its edges never show
const JUMP = 100; // px, max offset either way (must stay under OVERSCAN)

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

// Small seeded generator (mulberry32).
function generator(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTile() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(TILE, TILE);
  const data = image.data;
  const random = generator(1013904223);
  const range = 0.5 + CONTRAST * 1.1;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.min(1, Math.max(0, 0.5 + (random() + random() - 1) * range)) * 255;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

let layer = null;
let tileUrl = '';
let motion = null;

function makeMotionFrames() {
  const frames = Array.from({ length: FRAME_COUNT }, (_, index) => {
    const x = (Math.random() * 2 - 1) * JUMP;
    const y = (Math.random() * 2 - 1) * JUMP;
    return {
      transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`,
      offset: index / FRAME_COUNT,
      easing: 'steps(1, end)',
    };
  });
  frames.push({ ...frames[0], offset: 1 });
  return frames;
}

function start() {
  if (!motion) return;
  if (reduce.matches || document.hidden) {
    motion.pause();
    return;
  }
  motion.play();
}

function ensure() {
  if (!tileUrl) tileUrl = makeTile();
  if (!tileUrl) return;
  if (!layer || !layer.isConnected) {
    motion?.cancel();
    layer = document.createElement('div');
    layer.className = 'film-grain'; // kept out of the "hide the page" rules (menu open, page leaving)
    layer.setAttribute('aria-hidden', 'true');
    layer.dataset.opacity = String(OPACITY); // the home intro fades it in to this
    layer.style.cssText =
      `position:fixed;top:-${OVERSCAN}px;left:-${OVERSCAN}px;right:-${OVERSCAN}px;` +
      `height:calc(100lvh + ${OVERSCAN * 2}px);z-index:9999;pointer-events:none;` +
      `opacity:${window.__ptGridHold ? 0 : OPACITY};will-change:transform;image-rendering:pixelated;` +
      `background-image:url("${tileUrl}");background-size:${TILE}px ${TILE}px;`;
    // Astro replaces <body> on client-side navigation; keeping the effect on
    // <html> lets both its texture and animation survive the swap.
    document.documentElement.appendChild(layer);
    const frames = makeMotionFrames();
    layer.style.transform = frames[0].transform;
    motion = layer.animate(frames, {
      duration: LOOP_SECONDS * 1000,
      iterations: Infinity,
    });
  }
  if (window.__ptFxRevealed && layer.style.opacity === '0') {
    layer.style.opacity = String(OPACITY);
  }
  start();
}

document.addEventListener('astro:page-load', ensure);
document.addEventListener('astro:after-swap', ensure);
document.addEventListener('visibilitychange', start);
reduce.addEventListener('change', start);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
else ensure();
