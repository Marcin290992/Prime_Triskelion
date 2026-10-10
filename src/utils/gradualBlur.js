// Gradual blur — plain JavaScript, no dependencies.
//
// A band of blur that builds up smoothly towards a screen edge, instead of a
// single blur with a faded mask: several stacked layers, each a stronger
// backdrop blur that shows over a narrower stretch of the band's outer part
// (via a mask), so the blur climbs from nothing to full strength with no
// visible steps. Used here as two fixed bands, one along the top and one
// along the bottom of every page, under the menu, logo and buttons.
//
// createGradualBlur(options) returns the element; mountGradualBlur() puts the
// two page bands on the <body> (and again after every page swap).
//
// Cost note: backdrop-filter over scrolling content is the expensive kind of
// blur, and it scales with the filtered area and the layer count. The layers
// are few (DIV_COUNT) and the bands short on purpose.

const CURVES = {
  linear: (p) => p,
  bezier: (p) => p * p * (3 - 2 * p),
  'ease-in': (p) => p * p,
  'ease-out': (p) => 1 - (1 - p) ** 2,
  'ease-in-out': (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
};

const DIRECTIONS = { top: 'to top', bottom: 'to bottom', left: 'to left', right: 'to right' };

const DEFAULTS = {
  position: 'bottom', // which edge: 'top' | 'bottom' | 'left' | 'right'
  height: '7rem', // how far the band reaches in from the edge
  strength: 2, // overall blur strength
  divCount: 5, // number of stacked layers (more = smoother, costlier)
  curve: 'bezier', // how the blur builds up: see CURVES
  exponential: true, // blur grows exponentially towards the edge
  opacity: 1,
  zIndex: 998, // above page content, below the menu overlay (999) and the logo/CTA (1002)
};

export function createGradualBlur(options = {}) {
  const c = { ...DEFAULTS, ...options };
  const curve = CURVES[c.curve] || CURVES.linear;
  const direction = DIRECTIONS[c.position] || DIRECTIONS.bottom;
  const vertical = c.position === 'top' || c.position === 'bottom';

  const root = document.createElement('div');
  root.className = 'gradual-blur';
  root.setAttribute('aria-hidden', 'true');
  const s = root.style;
  s.zIndex = String(c.zIndex);
  s[c.position] = '0';
  if (vertical) {
    s.left = '0';
    s.right = '0';
    s.height = c.height;
  } else {
    s.top = '0';
    s.bottom = '0';
    s.width = c.height;
  }

  const step = 100 / c.divCount;
  const r = (v) => Math.round(v * 10) / 10;
  for (let i = 1; i <= c.divCount; i++) {
    const progress = curve(i / c.divCount);
    const blur = c.exponential
      ? 2 ** (progress * 4) * 0.0625 * c.strength
      : 0.0625 * (progress * c.divCount + 1) * c.strength;

    const p1 = r(step * i - step);
    const p2 = r(step * i);
    const p3 = r(step * i + step);
    const p4 = r(step * i + step * 2);
    let gradient = `transparent ${p1}%, black ${p2}%`;
    if (p3 <= 100) gradient += `, black ${p3}%`;
    if (p4 <= 100) gradient += `, transparent ${p4}%`;
    const mask = `linear-gradient(${direction}, ${gradient})`;
    const filter = `blur(${blur.toFixed(3)}rem)`;

    const layer = document.createElement('div');
    layer.className = 'gradual-blur__layer';
    const l = layer.style;
    l.maskImage = mask;
    l.webkitMaskImage = mask;
    l.backdropFilter = filter;
    l.webkitBackdropFilter = filter;
    l.opacity = String(c.opacity);
    root.appendChild(layer);
  }
  return root;
}

// The page's two bands. The <body> is replaced on every navigation, so they
// are put back each time (right after the swap, before the new page paints).
export function mountGradualBlur() {
  const body = document.body;
  if (!body || body.querySelector(':scope > .gradual-blur')) return;
  body.prepend(createGradualBlur({ position: 'bottom' }));
  body.prepend(createGradualBlur({ position: 'top' }));
}

document.addEventListener('astro:after-swap', mountGradualBlur);
document.addEventListener('astro:page-load', mountGradualBlur);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountGradualBlur);
else mountGradualBlur();
