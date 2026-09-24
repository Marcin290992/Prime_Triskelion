# Prime Triskelion — Copilot Instructions

## 🏢 About the Project

**Studio:** Prime Triskelion  
**Type:** One-person design & development studio  
**Voice:** First person singular — "I", "my work". Never "we/our".  
**Stack:** Astro + GSAP + Lenis + Tailwind v4 + Vanilla JS + Blender (assets)  
**Fonts:** Clash Display (600/700, headings) + DM Sans (300/400, body). Self-hosted woff2. No mono face — HUD labels are DM Sans with wide letter-spacing.  
**Goal:** Build a premium, immersive studio website inspired by studios like Trionn — with smooth animations, scroll-triggered effects, and a strong visual identity.

---

## 🧠 Copilot Mindset

When assisting on this project, always:

- Write **clean, semantic, minimal** code — no unnecessary abstractions
- Prefer **vanilla JS** over heavy frameworks for animation logic
- Respect **performance** — lazy load, use `will-change` sparingly, avoid layout thrash
- Follow the **component structure** defined by Astro (`.astro` files)
- Animations should always be tied to **GSAP** — never use raw CSS transitions for complex sequences
- Use **CSS custom properties** (`--var`) for all design tokens (colors, spacing, typography)
- Comment non-obvious animation logic — especially GSAP timelines

---

## 🎨 Brand Identity — Prime Triskelion

Colours are stored as **space-separated RGB triplets** and always consumed as `rgb(var(--c-x) / <alpha>)` — never as bare hex in component CSS.

| Token | CSS var | Value | Hex |
|---|---|---|---|
| Background | `--c-bg` | `10 10 10` | `#0A0A0A` |
| Cream (text/UI) | `--c-cream` | `242 237 232` | `#F2EDE8` |
| Red (sole accent) | `--c-red` | `255 62 30` | `#FF3E1E` |
| Font — Display | `--f-display` | `'Clash Display', sans-serif` (weights 600 / 700) | |
| Font — Body | `--f-body` | `'DM Sans', sans-serif` (weights 300 / 400) | |
| Gutter | `--site-gutter` | `clamp(1rem, 3.6vw, 3rem)` | |
| Max width | `--site-max-width` | `1440px` | |
| Section space | `--section-space-top` / `--section-space-bottom` | `clamp(7rem,14vw,20rem)` / `clamp(6rem,10vw,15rem)` | |
| Mobile breakpoint | `--bp-mobile` | `1024px` (used in JS; CSS splits at `max-width:1024px` / `min-width:1025px`) | |

**Brand personality:** Dark, cinematic, technical. HUD/sci-fi aesthetic. One red accent — no gold, no orange-red gradient, no neon blue. Muted greys/whites do the rest.

### CSS tokens — the real `:root` (`src/styles/global.css`)
```css
:root {
  color-scheme: dark;

  /* Colours — space-separated RGB, use as rgb(var(--c-x) / alpha) */
  --c-bg:    10 10 10;
  --c-cream: 242 237 232;
  --c-red:   255 62 30;

  /* Typography — self-hosted woff2, no mono face */
  --f-display: 'Clash Display', sans-serif;
  --f-body:    'DM Sans', sans-serif;

  /* Layout */
  --site-max-width: 1440px;
  --site-gutter: clamp(1rem, 3.6vw, 3rem);
  --section-space-top: clamp(7rem, 14vw, 20rem);
  --section-space-bottom: clamp(6rem, 10vw, 15rem);
  --bp-mobile: 1024px; /* reference for JS matchMedia */
}
```

Tailwind v4 is pulled in via `@import "tailwindcss";` at the top of `global.css` (plus `@tailwindcss/vite`). There is **no `tokens.css` / `typography.css`** — everything lives in `global.css`. (`src/styles/tailwind.css` is a stale unused artifact.)

---

## 📁 Project Structure

```
prime-triskelion/
├── public/
│   ├── images/          # SVGs, logos, static assets
│   ├── video/           # Blender renders, background loops
│   └── fonts/           # Self-hosted woff2
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.astro
│   │   │   ├── Footer.astro
│   │   │   └── MobileMenu.astro
│   │   ├── sections/
│   │   │   ├── Hero.astro
│   │   │   ├── About.astro
│   │   │   ├── Services.astro
│   │   │   ├── Work.astro
│   │   │   ├── KeyFacts.astro
│   │   │   └── Contact.astro
│   │   └── ui/
│   │       ├── Button.astro
│   │       ├── NavLink.astro
│   │       ├── MarqueeText.astro
│   │       └── SplitText.astro
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── work/
│   │   │   └── index.astro
│   │   ├── services.astro
│   │   ├── about.astro
│   │   └── contact.astro
│   ├── scripts/
│   │   ├── gsap/
│   │   │   ├── preloader.js      # Page load animation
│   │   │   ├── splitText.js      # Char/word split utility
│   │   │   ├── scrollAnimations.js
│   │   │   └── marquee.js
│   │   ├── lenis.js              # Smooth scroll init
│   │   └── main.js               # Entry point
│   └── styles/
│       ├── global.css
│       ├── tokens.css            # CSS custom properties
│       ├── typography.css
│       └── utils.css
├── astro.config.mjs
├── package.json
└── .github/
    └── copilot-instructions.md  # ← this file
```

---

## ⚙️ Dependencies

```json
{
  "astro": "^4.x",
  "gsap": "^3.12.x",
  "@gsap/member-plugins": "SplitText, ScrollTrigger, Flip",
  "lenis": "^1.x"
}
```

Install command:
```bash
npm create astro@latest prime-triskelion
cd prime-triskelion
npm install gsap lenis
```

---

## 🎬 Animation Conventions

### GSAP Timeline naming
```js
// ✅ Good
const tlHero = gsap.timeline({ paused: true });
const tlPreloader = gsap.timeline({ onComplete: initSite });

// ❌ Bad
const tl1 = gsap.timeline();
const t = gsap.timeline();
```

### ScrollTrigger pattern
```js
// Always use this wrapper — never inline ScrollTrigger without context
gsap.registerPlugin(ScrollTrigger);

ScrollTrigger.create({
  trigger: element,
  start: "top 80%",
  onEnter: () => animateIn(element),
});
```

### SplitText pattern
```js
// Split chars, animate stagger on scroll enter
import { SplitText } from "gsap/SplitText";

export function animateSplitHeading(selector) {
  const el = document.querySelector(selector);
  const split = new SplitText(el, { type: "chars, words" });

  gsap.from(split.chars, {
    opacity: 0,
    y: 40,
    rotateX: -90,
    stagger: 0.02,
    duration: 0.6,
    ease: "power3.out",
    scrollTrigger: {
      trigger: el,
      start: "top 85%",
    },
  });
}
```

### Preloader pattern
```js
// src/scripts/gsap/preloader.js
export function runPreloader(onComplete) {
  const tl = gsap.timeline({ onComplete });

  tl.to(".preloader__belts", {
    scaleY: 0,
    transformOrigin: "top",
    stagger: 0.05,
    duration: 0.8,
    ease: "power4.inOut",
  });
}
```

### Smooth scroll (Lenis)
```js
// src/scripts/lenis.js
import Lenis from "lenis";

export const lenis = new Lenis({
  duration: 1.2,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smooth: true,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
```

---

## 🧩 Component Conventions

### Astro component header
Every `.astro` file should start with:
```astro
---
// Component: [ComponentName]
// Section: [which page section]
// Dependencies: [GSAP / none]

interface Props {
  // define props here
}

const { } = Astro.props;
---
```

### Button component
```astro
---
interface Props {
  href: string;
  label: string;
  variant?: "primary" | "ghost" | "pill";
}
const { href, label, variant = "primary" } = Astro.props;
---

<a href={href} class={`btn btn--${variant}`} draggable="false">
  <span class="btn__text">{label}</span>
  <span class="btn__arrow" aria-hidden="true">→</span>
</a>
```

### MarqueeText component
```astro
---
interface Props {
  items: string[];
  speed?: number; // px/s, default 80
}
const { items, speed = 80 } = Astro.props;
---

<div class="marquee" data-speed={speed}>
  <div class="marquee__track">
    {items.map(item => <span class="marquee__item">{item}</span>)}
  </div>
</div>
```

---

## 📐 CSS Conventions

```css
/* global.css :root — always use these, never hardcode hex.
   Colours are RGB triplets: rgb(var(--c-red) / 0.45), etc. */
:root {
  color-scheme: dark;

  --c-bg:    10 10 10;
  --c-cream: 242 237 232;
  --c-red:   255 62 30;

  --f-display: 'Clash Display', sans-serif; /* 600 / 700 */
  --f-body:    'DM Sans', sans-serif;       /* 300 / 400 */

  --site-max-width: 1440px;
  --site-gutter: clamp(1rem, 3.6vw, 3rem);
  --section-space-top: clamp(7rem, 14vw, 20rem);
  --section-space-bottom: clamp(6rem, 10vw, 15rem);
  --app-stable-vh: 1vh; /* set in JS to the locked viewport height */
  --bp-mobile: 1024px;
}
```

```css
/* utility classes — use these in markup */
.tr__container {
  width: 100%;
  max-width: 1440px;
  margin-inline: auto;
  padding-inline: var(--container-px);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
}
```

---

## 📱 Mobile Viewport & iOS Safari — hard-won rules

These fixed a long run of mobile bugs (gaps above/below the menu overlay, Safari-only scroll jank, jumps when the URL bar hides). Break one and the bug comes back.

### Black status-bar / URL-bar areas (iOS Safari 26+)
- Safari paints the areas behind its status bar and floating URL bar using the colour of a **fixed element touching that screen edge**. With none, page content shows through them.
- `.edge-tint--top` / `.edge-tint--bottom` in `Layout.astro` do this: `position: fixed`, full width, opaque `rgb(var(--c-bg))`, **12px tall**, `z-index: 10000`, iOS-only via `@supports (-webkit-touch-callout: none)`.
- WebKit (`LocalFrameView::fixedContainerEdges`) samples **4–6px in from the edge** and **ignores boxes ≤10px tall** or narrower than ~90% of the viewport.
- ❌ Never shrink the strips to ≤10px, and never put anything above `z-index: 10000` near the top/bottom edge (cookie banners, toasts, popups). Safari would take its colour instead.
- ❌ Never add `viewport-fit=cover` to the viewport meta. It was the root cause of the original menu-gap bugs.

### Viewport height (`--app-stable-vh`)
- It's set in JS in `Layout.astro`. On toolbar show/hide (height-only resize) it is re-measured **only while `scrollY` is inside the first screen**, in every browser.
- Re-measuring deeper resizes every vh-sized section above the reader, and the page visibly jumps. Safari has no scroll anchoring; in Chrome the section in view still visibly resizes.
- ❌ Don't size sections **below the first screen** off the viewport height on mobile (`--app-stable-vh`, `vh`, `dvh`, `lvh`). Use content or aspect-ratio sizing instead: `/projects` on mobile uses 4:5 cards for this reason.

### Menu overlay
- `#ox-menu-overlay` (fixed, `inset: 0`) can't reach the strips under Safari's bars. Once it has faded in, `oxygenMenu.ts` adds `html.ox-menu-covered`, which hides the page underneath (`visibility: hidden`), so only black shows.
- ❌ No `transform` on `#ox-menu-overlay` or its fixed ancestors. It makes iOS Safari size fixed elements against the wrong viewport.
- On mobile the overlay has no grain (both grain layers are hidden while it's open), so it matches Safari's black bars.

### Performance on mobile Safari
- `backdrop-filter` over scrolling content is expensive. Keep it to small areas (the 104px `.top-blur` strip is fine) and add every new blur surface to the `:active-view-transition` guard in `global.css`.
- ❌ Don't leave `filter: blur(0)` / `transform` on elements after a reveal on mobile. Safari treats `blur(0)` as an active filter and re-renders it on scroll. Use `filter: none` / `transform: none`.
- ❌ No per-frame `getImageData()` or other GPU readbacks in rAF loops. Don't run WebGL loops for effects that are hidden on mobile.
- Large source images go through `astro:assets` (`<Image>` / `getImage()`) so a downscaled file ships, never the raw original.

---

## 🚫 Rules — What NOT to do

- ❌ Do NOT use Tailwind (unless explicitly asked)
- ❌ Do NOT use React/Vue components — this is Astro + vanilla JS
- ❌ Do NOT animate `width`, `height`, or `top/left` — use `transform` only
- ❌ Do NOT use `setTimeout` for animation sequencing — use GSAP timelines
- ❌ Do NOT import GSAP plugins without `gsap.registerPlugin()`
- ❌ Do NOT hardcode colours — use `rgb(var(--c-cream) / a)` / `rgb(var(--c-red) / a)`, never `#f2ede8` or `rgb(255,62,30)`
- ❌ Do NOT create a new ScrollTrigger inside a scroll handler
- ❌ Do NOT write "we" / "our" in copy — the studio speaks as "I"
- ❌ Do NOT introduce a mono font or `font-mono` — HUD labels are `--f-body` with wide `letter-spacing`

---

## ✅ Checklist before pushing code

- [ ] All animations use GSAP
- [ ] No layout thrash (read before write in DOM)
- [ ] Images have `loading="lazy"` (except above fold)
- [ ] `will-change` removed after animation completes
- [ ] Lenis `data-lenis-prevent` on modal/drawer scrollable elements
- [ ] Mobile breakpoint tested (320px min)
- [ ] `prefers-reduced-motion` respected

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 🔗 Reference

- Inspiration: [trionn.com](https://trionn.com)
- GSAP docs: [gsap.com/docs](https://gsap.com/docs)
- Lenis: [github.com/darkroomengineering/lenis](https://github.com/darkroomengineering/lenis)
- Astro: [docs.astro.build](https://docs.astro.build)

---

*Prime Triskelion — Inspire · Innovate · Impact*
