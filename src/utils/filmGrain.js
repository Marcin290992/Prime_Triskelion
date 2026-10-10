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
// Desktop only (mouse, wide screen) — phones and tablets keep pure black.
// Still when the user prefers reduced motion; paused while the tab is hidden.

const TILE = 256; // px, the texture is a TILE x TILE square
const CONTRAST = 0.6; // 0..1, how far the grain reaches from mid-grey
const OPACITY = 0.05; // layer opacity -> black lifted by ~OPACITY x 127
const FPS = 24;
const OVERSCAN = 120; // px the layer extends past the screen, so its edges never show
const JUMP = 100; // px, max offset either way (must stay under OVERSCAN)

const desktop = window.matchMedia('(min-width: 1025px) and (hover: hover) and (pointer: fine)');
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
let timer = 0;

function jump() {
  if (!layer) return;
  const x = (Math.random() * 2 - 1) * JUMP;
  const y = (Math.random() * 2 - 1) * JUMP;
  layer.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = 0;
}

function start() {
  stop();
  if (!layer || reduce.matches || document.hidden) return;
  timer = setInterval(jump, 1000 / FPS);
}

function ensure() {
  if (!desktop.matches) {
    stop();
    layer?.remove();
    layer = null;
    return;
  }
  if (!tileUrl) tileUrl = makeTile();
  if (!tileUrl) return;
  // The page's <body> is replaced on every navigation, so the layer is put
  // back each time.
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText =
      `position:fixed;top:-${OVERSCAN}px;left:-${OVERSCAN}px;right:-${OVERSCAN}px;` +
      `height:calc(100lvh + ${OVERSCAN * 2}px);z-index:9999;pointer-events:none;` +
      `opacity:${OPACITY};will-change:transform;image-rendering:pixelated;` +
      `background-image:url("${tileUrl}");background-size:${TILE}px ${TILE}px;`;
    document.body.appendChild(layer);
    jump();
  }
  start();
}

document.addEventListener('astro:page-load', ensure);
document.addEventListener('astro:after-swap', ensure);
document.addEventListener('visibilitychange', start);
desktop.addEventListener('change', ensure);
reduce.addEventListener('change', start);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
else ensure();
