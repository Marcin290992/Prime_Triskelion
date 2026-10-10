// Border comet — plain JavaScript, no dependencies.
//
// The hover of the main CTA buttons (the `.h-hero-cta--fixed` family): from
// the point of the border the cursor came in at, two comets run round the
// outline, one each way, and meet on the far side, with a brief flash of the
// whole outline as they leave. At rest the buttons keep their own look (the
// slowly turning beam, CSS) — this only draws while a comet is running.
//
// One 2D canvas per button, inside it (the button clips its children, so the
// glow lives on the inside of the edge). Frames are drawn only while a comet
// is running.
//
// Everywhere: a mouse sets it off on entering the button, a finger on
// touching it (from the point touched). On phones and tablets the buttons have
// no turning beam (their CSS drops it there) — the comet is their only light.
// No comet with reduced motion.

const SELECTOR = '.h-hero-cta--fixed';
const THICKNESS = 1; // px
const GLOW = 0.4; // 0..1
const PULSE_TIME = 0.65; // s, how long a pulse lives
const PULSE_COOLDOWN = 0.7; // s, between two pulses (a shaky mouse at the edge)
// A comet lives 0.65s; on touch screens its frames are capped a little lower.
const FRAME_MS = 1000 / (window.matchMedia('(pointer: coarse)').matches ? 40 : 60);

const TAU = Math.PI * 2;
// Only used to rebuild when the layout crosses the phone/desktop line (which
// buttons exist and are shown differs).
const layout = window.matchMedia('(min-width: 1025px)');
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const wrap = (v, total) => ((v % total) + total) % total;
const white = (a) => `rgba(255, 255, 255, ${clamp(a, 0, 1).toFixed(3)})`;

// The button's outline as a closed path (rounded rectangle, clockwise from
// the top-left), measured in px along its length.
function outline(width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const arc = (Math.PI * r) / 2;
  const across = Math.max(0, width - 2 * r);
  const down = Math.max(0, height - 2 * r);
  const segments = [
    { length: across, x: r, y: 0, dx: 1, dy: 0, angle: null },
    { length: arc, x: width - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
    { length: down, x: width, y: r, dx: 0, dy: 1, angle: null },
    { length: arc, x: width - r, y: height - r, dx: 0, dy: 0, angle: 0 },
    { length: across, x: width - r, y: height, dx: -1, dy: 0, angle: null },
    { length: arc, x: r, y: height - r, dx: 0, dy: 0, angle: Math.PI / 2 },
    { length: down, x: 0, y: height - r, dx: 0, dy: -1, angle: null },
    { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI },
  ];
  return { r, segments, total: Math.max(1, segments.reduce((sum, s) => sum + s.length, 0)) };
}

// The point at a distance along the outline.
function pointAt(shape, distance, point) {
  let s = wrap(distance, shape.total);
  for (const seg of shape.segments) {
    if (seg.length > 0 && s <= seg.length) {
      if (seg.angle === null) {
        point.x = seg.x + seg.dx * s;
        point.y = seg.y + seg.dy * s;
      } else {
        const angle = seg.angle + s / shape.r;
        point.x = seg.x + Math.cos(angle) * shape.r;
        point.y = seg.y + Math.sin(angle) * shape.r;
      }
      return point;
    }
    s -= seg.length;
  }
  return point;
}

// How far along the outline the point nearest to (px, py) is.
function project(shape, px, py) {
  let best = Infinity;
  let found = 0;
  let offset = 0;
  for (const seg of shape.segments) {
    if (seg.length > 0) {
      let s = 0;
      let x = 0;
      let y = 0;
      if (seg.angle === null) {
        s = clamp((px - seg.x) * seg.dx + (py - seg.y) * seg.dy, 0, seg.length);
        x = seg.x + seg.dx * s;
        y = seg.y + seg.dy * s;
      } else {
        let angle = wrap(Math.atan2(py - seg.y, px - seg.x) - seg.angle, TAU);
        if (angle > Math.PI / 2) angle = angle > Math.PI * 1.25 ? 0 : Math.PI / 2;
        s = angle * shape.r;
        x = seg.x + Math.cos(seg.angle + angle) * shape.r;
        y = seg.y + Math.sin(seg.angle + angle) * shape.r;
      }
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < best) {
        best = d;
        found = offset + s;
      }
    }
    offset += seg.length;
  }
  return found;
}

class StarBorder {
  constructor(btn) {
    this.btn = btn;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    btn.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.radius = 0;
    this.phase = 0; // where a keyboard-focus comet starts (the top-left corner)
    this.time = 0;
    this.flash = 0;
    this.pulses = [];
    this.lastPulse = -10;
    this.visible = true;
    this.destroyed = false;
    this.raf = 0;
    this.last = 0;
    this.drawn = 0;
    this.point = { x: 0, y: 0 };

    this.onEnter = this.onEnter.bind(this);
    this.onDown = this.onDown.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.frame = this.frame.bind(this);

    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(btn);
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this.wake();
    });
    this.io.observe(btn);
    btn.addEventListener('pointerenter', this.onEnter);
    btn.addEventListener('pointerdown', this.onDown);
    btn.addEventListener('focus', this.onFocus);
    this.measure();
  }

  shape() {
    return outline(
      Math.max(1, this.w - THICKNESS),
      Math.max(1, this.h - THICKNESS),
      this.radius - THICKNESS / 2
    );
  }

  measure() {
    if (this.destroyed) return;
    this.w = this.btn.offsetWidth;
    this.h = this.btn.offsetHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.radius = parseFloat(getComputedStyle(this.btn).borderTopLeftRadius) || 0;
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    this.wake();
  }

  local(event) {
    const r = this.btn.getBoundingClientRect();
    const sx = r.width ? this.w / r.width : 1;
    const sy = r.height ? this.h / r.height : 1;
    return [(event.clientX - r.left) * sx, (event.clientY - r.top) * sy];
  }

  // A pulse from a point on the outline: two waves, one each way round.
  pulse(origin) {
    if (reduceQuery.matches) return;
    // wall-clock time: no frames run while a button is idle, so a frame
    // counter would stand still and block every pulse after the first
    const now = performance.now() / 1000;
    if (now - this.lastPulse < PULSE_COOLDOWN) return;
    this.lastPulse = now;
    this.pulses.push({ origin, age: 0 });
    if (this.pulses.length > 3) this.pulses.shift();
    this.flash = 1;
    this.wake();
  }

  onEnter(event) {
    if (event.pointerType !== 'mouse') return;
    const [x, y] = this.local(event);
    this.pulse(project(this.shape(), x - THICKNESS / 2, y - THICKNESS / 2));
  }

  // A finger (or pen) has no hover: the comet leaves from where it touched.
  onDown(event) {
    if (event.pointerType === 'mouse') return;
    const [x, y] = this.local(event);
    this.pulse(project(this.shape(), x - THICKNESS / 2, y - THICKNESS / 2));
  }

  onFocus() {
    if (this.btn.matches(':focus-visible')) this.pulse(this.phase);
  }

  // A comet tail behind `head`, `length` px long, fading to nothing.
  trail(ctx, shape, head, length, sign, intensity) {
    if (length < 0.5 || intensity <= 0) return;
    const steps = clamp(Math.ceil(length / 6), 2, 40);
    const p = this.point;
    pointAt(shape, head, p);
    let px = p.x;
    let py = p.y;
    ctx.lineCap = 'butt';
    for (let i = 1; i <= steps; i++) {
      pointAt(shape, head - sign * length * (i / steps), p);
      const u = 1 - (i - 0.5) / steps;
      const fade = u * u * intensity;
      // a wide, faint pass for the glow, then the line itself
      ctx.lineWidth = 2 + 6 * GLOW;
      ctx.strokeStyle = white(fade * 0.2 * GLOW);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.lineWidth = THICKNESS;
      ctx.strokeStyle = white(fade);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      px = p.x;
      py = p.y;
    }
  }

  // The soft bloom around a bright point.
  head(ctx, x, y, intensity) {
    if (intensity <= 0) return;
    const reach = 12 + 40 * GLOW;
    const strength = 0.4 * GLOW * intensity;
    const bloom = ctx.createRadialGradient(x, y, 0, x, y, reach);
    bloom.addColorStop(0, white(strength));
    bloom.addColorStop(0.2, white(strength * 0.4));
    bloom.addColorStop(0.5, white(strength * 0.1));
    bloom.addColorStop(1, white(0));
    ctx.fillStyle = bloom;
    ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.w < 2 || this.h < 2) return;
    const offset = (THICKNESS / 2) * this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, offset, offset);
    ctx.globalCompositeOperation = 'lighter';

    const shape = this.shape();
    const total = shape.total;
    // the whole outline flashes as a pulse is sent out
    if (this.flash > 0.005) {
      ctx.lineWidth = THICKNESS + 2 * GLOW;
      ctx.strokeStyle = white(this.flash * 0.32);
      ctx.beginPath();
      ctx.roundRect(0, 0, Math.max(1, this.w - THICKNESS), Math.max(1, this.h - THICKNESS), Math.max(0, shape.r));
      ctx.stroke();
    }

    for (const p of this.pulses) {
      const fade = (1 - p.age / PULSE_TIME) ** 2;
      const travel = (total / 2) * (1 - (1 - Math.min(1, p.age / 0.5)) ** 2);
      const tail = Math.min(travel, total * 0.16);
      for (const way of [1, -1]) {
        const front = p.origin + way * travel;
        this.trail(ctx, shape, front, tail, way, fade);
        pointAt(shape, front, this.point);
        this.head(ctx, this.point.x, this.point.y, fade * 0.8);
      }
    }
  }

  frame(now) {
    this.raf = 0;
    if (this.destroyed || !this.visible) return;
    // frame cap
    if (now - this.drawn < FRAME_MS) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const dt = Math.min(0.05, Math.max(0.001, (now - (this.last || now - 16)) / 1000));
    this.last = now;
    this.drawn = now;
    this.time += dt;

    this.flash *= Math.exp(-dt / 0.22);
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      this.pulses[i].age += dt;
      if (this.pulses[i].age >= PULSE_TIME) this.pulses.splice(i, 1);
    }

    this.draw();

    const busy = this.flash > 0.01 || this.pulses.length > 0;
    if (busy) this.raf = requestAnimationFrame(this.frame);
    else this.last = 0;
  }

  wake() {
    if (this.raf || this.destroyed || !this.visible) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    this.btn.removeEventListener('pointerenter', this.onEnter);
    this.btn.removeEventListener('pointerdown', this.onDown);
    this.btn.removeEventListener('focus', this.onFocus);
    this.canvas.remove();
  }
}

let instances = [];

function destroyAll() {
  instances.forEach((i) => i.destroy());
  instances = [];
}

function init() {
  destroyAll();
  document.querySelectorAll(SELECTOR).forEach((btn) => {
    // buttons that aren't shown at this size (display: none) get nothing
    if (btn.getClientRects().length) instances.push(new StarBorder(btn));
  });
}

// The page's buttons are new after every navigation.
document.addEventListener('astro:before-swap', destroyAll);
document.addEventListener('astro:page-load', init);
layout.addEventListener('change', init);
reduceQuery.addEventListener('change', () => instances.forEach((i) => i.wake()));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
