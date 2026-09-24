/**
 * OxygenMenu controller — extracted verbatim from OxygenMenu.astro's inline
 * <script> so that component file stays HTML/CSS-focused. No behavior
 * change: this is the same module-execution semantics (top-level code runs
 * once per page, via ESM singleton import instead of Astro's inline-script
 * dedup), same DOM ids, same event wiring, same timing.
 */
import gsap from 'gsap';
import { navigate } from 'astro:transitions/client';
import { SpecularButton } from './specularButtonFx';

// Mobile menu chip's fully-shrunk scale (iOS Safari toolbar-style
// compacting on scroll, see handleScroll() below). Must match
// --ox-contact-btn-size's multiplier in OxygenMenu.astro AND the
// .hud-contact-link .hud-icon-btn svg multiplier in global.css, so the
// contact icon (button + glyph) that swaps in is sized identically to the
// chip's own shrunk state — there's no shared source of truth across the
// .ts/.astro/.css boundary, so this value is duplicated by hand in all
// three places; keep them in sync if it's ever tuned.
const MENU_SHRINK_SCALE = 0.68;

// Chromium can render backdrop-filter as solid white during the native
// View Transition (used by Astro's <ClientRouter/>) instead of blurring
// correctly — most visible on these glassy HUD buttons during
// back/forward navigation. Swap to a plain opaque fill for the brief
// transition window instead (see the .ox-vt-active rule in OxygenMenu.astro);
// guarded on window so re-running this module on every page load doesn't
// stack duplicate listeners.
if (!(window as any).__oxVtFlashFixInit) {
  (window as any).__oxVtFlashFixInit = true;
  document.addEventListener('astro:before-swap', () => {
    document.documentElement.classList.add('ox-vt-active');
  });
  document.addEventListener('astro:after-swap', () => {
    document.documentElement.classList.remove('ox-vt-active');
  });
}

// The menu button itself is torn down and rebuilt on every navigation
// (it lives inside the page content Astro swaps), and its click listener
// only gets reattached once initOxygenMenu() runs on astro:page-load —
// which fires after the swap is already visible, and after the page's
// own module script has loaded on a hard refresh. That leaves a short
// window where the button is on screen but not yet wired up (why it can
// feel dead right after going back or reloading). A single delegated
// listener on `document`, bound once and never torn down, closes that
// gap: it always resolves the current #hud-menu-btn / #ox-menu-overlay
// live (see openMenu/closeMenu below), so it works the instant the new
// button exists in the DOM, regardless of which generation of
// initOxygenMenu() last ran.
if (!(window as any).__oxMenuBtnDelegated) {
  (window as any).__oxMenuBtnDelegated = true;
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (!target?.closest('#hud-menu-btn')) return;
    (window as any).__oxygenMenuToggle?.();
  });
}

// Same reasoning as above, and also sidesteps a real bug it would
// otherwise have: Astro fires astro:page-load on the very first load
// too (not just SPA navigations), and this component's own
// readyState-based immediate-call path ALSO runs on first load — so
// initOxygenMenu() genuinely runs twice back to back before any
// navigation has happened at all. A listener bound directly to
// #hud-contact-toggle each init would end up attached twice on that
// same, not-yet-replaced button, so every tap toggled it open then
// immediately closed again (net: looked like the button did nothing).
// hud-menu-btn never showed this because __oxygenMenuToggle is
// reassigned, not appended to, on every init — same fix here.
if (!(window as any).__oxContactDockDelegated) {
  (window as any).__oxContactDockDelegated = true;
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const dock = document.getElementById('hud-contact-dock');
    if (!dock) return;
    if (target?.closest('#hud-contact-toggle')) {
      e.stopPropagation();
      (window as any).__oxygenContactSetOpen?.(!dock.classList.contains('is-open'));
    } else if (dock.classList.contains('is-open') && !dock.contains(target)) {
      (window as any).__oxygenContactSetOpen?.(false);
    }
  });
}

// Generation-independent safety net against "both hamburger AND contact
// button visible/unclickable at once" on mobile. The scroll-swap itself is
// now a single class (.hud-scroll-hidden on #ox-hud-mobile — see
// setBarHidden() and the matching CSS in OxygenMenu.astro) instead of two
// separately GSAP-animated elements, specifically so this reset can be one
// atomic classList.remove() with nothing left to desync. Runs on
// astro:after-swap (fires unconditionally on every navigation, including
// back/forward, before astro:page-load) rather than depending on any
// generation's closure re-running.
if (!(window as any).__oxAfterSwapReset) {
  (window as any).__oxAfterSwapReset = true;
  document.addEventListener('astro:after-swap', () => {
    document.getElementById('ox-hud-mobile')?.classList.remove('hud-scroll-hidden');
    // Same defensive purge as resetHudMenuBtn() below — leftover inline
    // opacity/pointer-events from the old GSAP-driven swap would otherwise
    // permanently outrank the new CSS-class-driven approach.
    const menuBtn = document.getElementById('hud-menu-btn');
    const contactBtn = document.querySelector<HTMLElement>('.hud-contact-link');
    menuBtn?.style.removeProperty('opacity');
    menuBtn?.style.removeProperty('pointer-events');
    menuBtn?.style.removeProperty('filter');
    contactBtn?.style.removeProperty('opacity');
    contactBtn?.style.removeProperty('pointer-events');
  });
}

function initOxygenMenu() {
  const state = {
    isMenuOpen: false,
    // True for the whole open/close GSAP timeline, not just isMenuOpen's
    // instant flip — closeMenu() only removes the overlay's "active" class
    // in its onComplete, so a toggle click fired mid-close still reads
    // "active" and re-triggers ANOTHER closeMenu() on top of the one
    // already running instead of opening back up, and the same happens in
    // reverse for a close fired mid-open. toggleMenu() below just ignores
    // clicks while this is true instead of trying to interrupt/reconcile
    // two overlapping timelines — same reasoning as the .hud-scroll-hidden
    // single-class approach elsewhere in this file: fewer pieces of
    // simultaneously-animating state that can end up half-applied.
    menuAnimating: false,
    lastScrollTop: 0,
    barHidden: false,
    scrollAccum: 0,
    // Continuous 0→1 shrink progress for the mobile menu chip (iOS Safari
    // toolbar-style compacting as you scroll down), independent of the
    // barHidden swap above — see handleScroll().
    menuShrink: 0,
    timeInterval: null as ReturnType<typeof setInterval> | null,
    scrollPosition: 0,
    releaseScrollLock: null as (() => void) | null,
  };
  const menuOverlay = document.getElementById('ox-menu-overlay');
  const menuLocation = document.getElementById('hud-location');
  const menuTime    = document.getElementById('hud-time');
  const hudMenuBtn    = document.getElementById('hud-menu-btn') as HTMLButtonElement | null;
  const hudContactBtn = document.querySelector<HTMLElement>('.hud-contact-link');

  if (!menuOverlay || !hudMenuBtn) return;

  // ── Cleanup previous instance (View Transitions) ──
  if ((window as any).__oxygenMenuCleanup) {
    (window as any).__oxygenMenuCleanup();
  }

  function getLenis() {
    return (window as any).__lenis;
  }

  function getCurrentScrollY() {
    const lenis = getLenis();
    const lenisPos = Number(lenis?.animatedScroll ?? lenis?.scroll ?? lenis?.targetScroll);
    return Number.isFinite(lenisPos) ? lenisPos : window.scrollY;
  }

  function createScrollLockRelease() {
    const scrollKeys = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);

    const shouldIgnoreTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    };

    const onWheel = (e: WheelEvent) => {
      if (state.isMenuOpen) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (state.isMenuOpen) e.preventDefault();
    };
    const onKeyScroll = (e: KeyboardEvent) => {
      if (!state.isMenuOpen) return;
      if (shouldIgnoreTarget(e.target)) return;
      if (scrollKeys.has(e.key)) e.preventDefault();
    };

    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('keydown', onKeyScroll, { capture: true });

    return () => {
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('keydown', onKeyScroll, true);
    };
  }

  // iOS Safari (esp. 26+, where the page runs edge-to-edge behind the
  // floating toolbar and status bar) doesn't let a position:fixed layer
  // reach those strips, no matter how it's sized — so whatever page content
  // is scrolled under them shows through as a sliver above and below the
  // open overlay. Instead of fighting the overlay's size, hide the page
  // itself once the overlay has fully faded in: the strips then show
  // <html>'s own black background. visibility (not display) keeps layout
  // and scroll position untouched.
  let coverTimer: ReturnType<typeof setTimeout> | null = null;
  function setPageCovered(covered: boolean) {
    if (coverTimer) { clearTimeout(coverTimer); coverTimer = null; }
    if (!covered) {
      document.documentElement.classList.remove('ox-menu-covered');
      return;
    }
    // Matches .ox-menu-overlay's 0.6s opacity transition — hiding earlier
    // would snap the page to black instead of letting the overlay fade over it.
    coverTimer = setTimeout(() => {
      coverTimer = null;
      if (state.isMenuOpen) document.documentElement.classList.add('ox-menu-covered');
    }, 600);
  }

  function lockBodyScroll() {
    state.scrollPosition = getCurrentScrollY();
    document.body.classList.add('oxygen-menu-open');
    setPageCovered(true);

    if (!state.releaseScrollLock) {
      state.releaseScrollLock = createScrollLockRelease();
    }

    const lenis = getLenis();
    if (lenis) {
      lenis.scrollTo(state.scrollPosition, { immediate: true });
      lenis.stop();
    }
  }

  function unlockBodyScroll() {
    document.body.classList.remove('oxygen-menu-open');
    setPageCovered(false);

    if (state.releaseScrollLock) {
      state.releaseScrollLock();
      state.releaseScrollLock = null;
    }

    const lenis = getLenis();
    if (lenis) {
      lenis.start();
      requestAnimationFrame(() => {
        lenis.scrollTo(state.scrollPosition, { immediate: true });
      });
    } else {
      window.scrollTo(0, state.scrollPosition);
    }
  }

  function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
    });
    if (menuTime) menuTime.textContent = timeString;
  }

  function showHeader() {
    const hudEl = document.getElementById('ox-hud-mobile');
    const hudRightCol = document.getElementById('hud-right-col');
    const hudTimeEl = document.getElementById('hud-time');
    if (hudEl) {
      gsap.set(hudEl, { y: 12 });
      // hud-menu-btn rides along with this fade (it's a child of hudEl,
      // and persists across navigations — see transition:persist on it
      // in the markup) — keep its backdrop-filter off for the duration,
      // see the --settling rule in OxygenMenu.astro for why.
      hudMenuBtn?.classList.add('hud-menu-btn--settling');
      // On the homepage, HeroSection's own reveal timeline owns hud-menu-btn
      // specifically — it stages the button in alongside the hero title/
      // claim/CTA instead of letting it fade in with the rest of this bar
      // (see the "Owned here" comment in HeroSection.astro's runReveal()).
      // That ownership lives in a separate <script>, which is still loading
      // when this runs — this component's own script always executes first,
      // since it appears earlier in the document (module scripts execute in
      // document order) — so without this, the button has no inline opacity
      // yet and rides up fully visible with hudEl's fade the instant it
      // starts, well before HeroSection's script gets a chance to pin it
      // back down to 0 for its own, later (1.6s) reveal. Pinning it here too
      // closes that gap; HeroSection's gsap.set(.... {opacity:0}) right
      // after is then just a harmless no-op restate of the same value.
      if (document.getElementById('hero') && hudMenuBtn) {
        // .hud-icon-btn.hud-menu-btn has `transition: opacity 0.25s ease`
        // (for the scroll show/hide swap) — with no CSS default opacity of
        // its own (only the #ox-hud-mobile wrapper has one), the button's
        // very first computed opacity is 1 until *something* sets it, and
        // that same transition rule then animates this first 1→0 set over
        // 0.25s instead of applying it instantly — a visible flash-then-
        // fade at the very start of every load. Suspend the transition for
        // just this one, one-time hide (nothing else is changing on the
        // button in this same tick, so nothing else needs it gone) and
        // force a reflow so the 0 is committed before restoring it, leaving
        // the scroll show/hide swap's own transition intact afterward.
        const prevTransition = hudMenuBtn.style.transition;
        hudMenuBtn.style.transition = 'none';
        gsap.set(hudMenuBtn, { opacity: 0 });
        void hudMenuBtn.offsetHeight;
        hudMenuBtn.style.transition = prevTransition;
      }
      gsap.to(hudEl, {
        opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', delay: 0.3,
        onComplete: () => hudMenuBtn?.classList.remove('hud-menu-btn--settling'),
      });
    }
    if (hudRightCol) {
      gsap.set(hudRightCol, { x: 30 });
      gsap.to(hudRightCol, { opacity: 1, x: 0, duration: 0.75, ease: 'power3.out', delay: 0.45 });
    }
    if (hudTimeEl) {
      gsap.to(hudTimeEl, { opacity: 1, duration: 0.6, ease: 'power2.out', delay: 0.55 });
    }
    // Fade in left location label (desktop only, no-op if hidden via CSS) —
    // skipped on the homepage, where HeroSection's own reveal timeline
    // already owns #hud-location so the two don't race each other.
    if (!document.getElementById('hero')) {
      setTimeout(() => {
        if (menuLocation) { menuLocation.style.opacity = '1'; }
      }, 700);
    }
  }

  const isMobile = window.matchMedia('(max-width: 1024px)').matches;

  // ── Mobile contact flyout (WhatsApp / email / call tucked behind the
  // contact button) ──
  let contactDockCloseTimer: ReturnType<typeof setTimeout> | null = null;

  // Live-looked-up rather than closed over hudContactBtn — this is called
  // from the permanent, module-level delegated listener near the top of
  // this file (window.__oxygenContactSetOpen), which can outlive this
  // exact generation of initOxygenMenu() the same way toggleMenu() has to
  // for the hamburger button (see the comment up there for why).
  function setContactDockOpen(open: boolean) {
    const dock = document.getElementById('hud-contact-dock');
    const toggle = document.getElementById('hud-contact-toggle');
    if (!dock || !toggle) return;
    if (contactDockCloseTimer) { clearTimeout(contactDockCloseTimer); contactDockCloseTimer = null; }
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      // Has to happen BEFORE the class toggle below (same tick is fine —
      // both land in the same style recalc) so the items sliding out
      // aren't clipped by the closed-state overflow:hidden.
      dock.style.overflow = 'visible';
      dock.style.height = 'auto';
      dock.classList.add('is-open');
    } else {
      dock.classList.remove('is-open');
      // Keep overflow:visible/height:auto until the retreat animation
      // (0.38s + up to 0.09s stagger delay) has actually finished —
      // reverting them immediately would hard-clip the items mid-slide
      // instead of letting them visibly tuck back behind the main button.
      contactDockCloseTimer = setTimeout(() => {
        dock.style.overflow = '';
        dock.style.height = '';
        contactDockCloseTimer = null;
      }, 480);
    }
  }
  (window as any).__oxygenContactSetOpen = setContactDockOpen;

  // HUD swap: one class on the shared #ox-hud-mobile ancestor, driving both
  // buttons purely via CSS (see .hud-scroll-hidden in OxygenMenu.astro).
  // Replaces an earlier version that ran a GSAP timeline touching each
  // element's opacity/pointer-events independently — under interruption
  // (fast repeated scroll, navigating mid-animation) that left the two
  // elements able to desync: one stuck visible-but-unclickable, or both
  // visible at once, because there were two separate pieces of animated
  // state that could each land half-applied. A single toggled class can't
  // be "half on" — the browser's own CSS transition engine handles
  // interruption/reversal natively, and resetting to baseline is one
  // classList.remove() (see resetHudMenuBtn() and the astro:after-swap
  // listener at the top of this file), with nothing left that can get stuck.
  function setBarHidden(hidden: boolean) {
    document.getElementById('ox-hud-mobile')?.classList.toggle('hud-scroll-hidden', hidden);
  }

  function handleScroll() {
    if (!isMobile) return; // Desktop: nothing hides on scroll
    // Any scroll intent closes the flyout first — it shouldn't stay
    // open while the bar itself is about to swap/hide underneath it.
    if (hudContactBtn?.classList.contains('is-open')) setContactDockOpen(false);
    const scrollTop = window.scrollY;
    if (state.isMenuOpen) {
      state.lastScrollTop = scrollTop;
      state.scrollAccum = 0;
      return;
    }

    const delta = scrollTop - state.lastScrollTop;
    state.lastScrollTop = scrollTop;

    // Reset accumulator on direction change, otherwise keep adding
    if ((delta > 0 && state.scrollAccum < 0) || (delta < 0 && state.scrollAccum > 0)) {
      state.scrollAccum = delta;
    } else {
      state.scrollAccum += delta;
    }

    const THRESHOLD = isMobile ? 20 : 30;

    // Shrink continuously with scroll (same range as the swap THRESHOLD, so
    // the chip finishes compacting to MENU_SHRINK_SCALE right as it hands
    // off to the contact icon — see --ox-contact-btn-size in
    // OxygenMenu.astro, which derives from the same ratio). Kept separate
    // from scrollAccum (which resets on direction change) so this tracks
    // smoothly instead of snapping. Same scrollTop > 50 near-top guard as
    // the swap below, so it can't shrink (with nothing to hand off to) from
    // a small bounce right at the top.
    state.menuShrink = scrollTop > 50
      ? Math.min(1, Math.max(0, state.menuShrink + delta / THRESHOLD))
      : 0;
    // GSAP tween (not a CSS transform, not gsap.set) for two separate
    // reasons: (1) hudMenuBtn already carries a permanent inline transform
    // from HeroSection's entrance reveal (that tween only clearProps's
    // opacity, not transform/y — see its comment), and an inline style
    // always wins over any stylesheet rule, so routing the scale through
    // GSAP's own transform cache is what makes it compose with that
    // existing inline value instead of losing to it; (2) a plain gsap.set
    // snaps straight to the target every scroll tick, tracking raw scroll
    // delta 1:1 — every little stutter in the input (touch/wheel deltas
    // are rarely perfectly even) reads directly as visible jitter. A short
    // eased retarget instead smooths that out into the gradual, decelerated
    // compacting iOS Safari's own toolbar has; overwrite: true keeps
    // rapid-fire calls from stacking up competing tweens on the same prop.
    if (hudMenuBtn) {
      gsap.to(hudMenuBtn, {
        scale: 1 - state.menuShrink * (1 - MENU_SHRINK_SCALE),
        duration: 0.35,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }

    if (state.scrollAccum > THRESHOLD && !state.barHidden && scrollTop > 50) {
      state.barHidden = true;
      setBarHidden(true); // Scroll down: menu btn hides, contact materializes
    } else if (state.scrollAccum < -THRESHOLD && state.barHidden) {
      state.barHidden = false;
      setBarHidden(false); // Scroll up: contact hides, menu btn returns
    }
  }

  function openMenu() {
    // Resolved live (not the hudMenuBtn/menuOverlay captured when this
    // closure was created) so this still targets the right elements even
    // if a stale generation ends up calling it — see the delegated
    // listener above.
    const btn = document.getElementById('hud-menu-btn');
    const overlay = document.getElementById('ox-menu-overlay');
    state.isMenuOpen = true;
    state.menuAnimating = true;
    state.scrollAccum = 0;
    state.menuShrink = 0;
    // Eased tween back to full size (matches the shrink tween in
    // handleScroll — same duration/ease), not gsap.set: this fires right
    // when the user taps the shrunk chip to open the menu, so snapping it
    // to scale 1 instantly reads as an abrupt jolt at the exact moment
    // they're looking right at it, undercutting the smooth compacting the
    // scroll-down direction already has.
    if (btn) gsap.to(btn, { scale: 1, duration: 0.35, ease: 'power2.out', overwrite: 'auto' });
    btn?.classList.add('active');
    btn?.setAttribute('aria-expanded', 'true');
    overlay?.classList.add('active');

    // If menu btn was hidden (user scrolled down), restore it when opening menu
    if (state.barHidden) {
      state.barHidden = false;
      setBarHidden(false);
    }
    lockBodyScroll();

    // Hide HUD labels, right col and start btn so they don't overlap the overlay
    const hudEl = document.getElementById('ox-hud-mobile');
    if (hudEl) gsap.to(hudEl.querySelectorAll('.hud-side'), { opacity: 0, duration: 0.2 });
    const hudRightCol = document.getElementById('hud-right-col');
    if (hudRightCol) gsap.to(hudRightCol, { opacity: 0, duration: 0.2 });
    const hudTimeHide = document.getElementById('hud-time');
    if (hudTimeHide) gsap.to(hudTimeHide, { opacity: 0, duration: 0.2 });
    gsap.set('.ox-menu-link', { y: '100%', opacity: 0 });
    gsap.timeline({ onComplete: () => { state.menuAnimating = false; } })
      .to('.ox-menu-topbar', { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out', delay: 0.05 })
      .to('.ox-menu-link', { y: 0, opacity: 1, duration: 0.75, stagger: 0.07, ease: 'power4.out' }, '-=0.2')
      .to('.ox-menu-bottom', { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }, '-=0.3');
  }

  // blurOut is the nav-link-click path: instead of sliding the topbar/
  // links/bottom out individually, the whole menu content blurs+fades as
  // one block (matching the ::view-transition-new(root) blur-in Layout.astro
  // does right after) while the clicked link stays frozen in its red hover
  // state — see the .ox-link--active class added in the click handler below.
  function closeMenu(keepOverlay = false, blurOut = false): Promise<void> {
    return new Promise((resolve) => {
      const btn = document.getElementById('hud-menu-btn');
      const overlay = document.getElementById('ox-menu-overlay');
      const content = overlay?.querySelector<HTMLElement>('.ox-menu-content') ?? null;
      state.isMenuOpen = false;
      state.menuAnimating = true;
      // Unhide the page now, while the overlay is still opaque, so it's
      // already there once the overlay starts fading out.
      setPageCovered(false);
      btn?.classList.remove('active');
      btn?.setAttribute('aria-expanded', 'false');

      if (!keepOverlay) {
        // Restore HUD side labels and right col
        const hudEl = document.getElementById('ox-hud-mobile');
        if (hudEl) gsap.to(hudEl.querySelectorAll('.hud-side'), { opacity: 1, duration: 0.4, delay: 0.3 });
        const hudRightCol = document.getElementById('hud-right-col');
        if (hudRightCol) gsap.to(hudRightCol, { opacity: 1, duration: 0.4, delay: 0.3 });
        const hudTimeRestore = document.getElementById('hud-time');
        if (hudTimeRestore) gsap.to(hudTimeRestore, { opacity: 1, duration: 0.4, delay: 0.35 });
      }

      if (blurOut && content) {
        // Plain fade, not a blur, on every device: an animated filter on
        // this full-screen block steps visibly on touch Safari, and the menu
        // should feel identical everywhere.
        gsap.timeline({
          onComplete: () => {
            if (!keepOverlay) {
              overlay?.classList.remove('active');
            }
            // No idle-state reset here (unlike the branch below): this
            // path is only ever used right before navigate() — see the
            // click handlers — and #ox-menu-overlay is NOT
            // transition:persist, so this whole DOM node is torn down by
            // the page swap a moment later anyway. Resetting content back
            // to opacity:1/no-blur here used to snap the right-panel
            // <aside> (never given its own closed state, unlike
            // .ox-menu-link/.ox-menu-topbar/.ox-menu-bottom) back to
            // fully visible for one frame before teardown — a visible
            // flash right as the page was navigating away.
            state.menuAnimating = false;
            unlockBodyScroll();
            resolve();
          },
        }).to(content, { opacity: 0, duration: 0.3, ease: 'power2.inOut' });
        return;
      }

      const links = gsap.utils.toArray('.ox-menu-link') as HTMLElement[];

      gsap.timeline({
        onComplete: () => {
          if (!keepOverlay) {
            overlay?.classList.remove('active');
          }
          gsap.set('.ox-menu-link', { y: '100%', opacity: 0 });
          gsap.set('.ox-menu-topbar, .ox-menu-bottom', {
            y: 20, opacity: 0,
          });
          state.menuAnimating = false;
          unlockBodyScroll();
          resolve();
        },
      })
        // Same shape as before (topbar out, links reversed-stagger out,
        // bottom out), just tightened to ~60% of the original durations —
        // this timeline has to finish before navigate() fires (see the
        // nav-link click handler below), so it was directly adding to how
        // long "click a link" took to actually leave the page.
        .to('.ox-menu-topbar', { y: -15, opacity: 0, duration: 0.24, ease: 'power3.inOut' })
        .to(links.reverse(), { y: 80, opacity: 0, duration: 0.3, stagger: 0.024, ease: 'power3.inOut' }, '-=0.15')
        .to('.ox-menu-bottom', { y: 20, opacity: 0, duration: 0.21, ease: 'power3.inOut' }, '-=0.18');
    });
  }

  function toggleMenu() {
    // Ignore taps while the previous open/close is still animating — see
    // state.menuAnimating above for why interrupting/reconciling mid-flight
    // is worse than a beat of an unresponsive-looking button.
    if (state.menuAnimating) return;
    // Read the live overlay's class rather than state.isMenuOpen so this
    // stays correct even when called via the permanently-delegated click
    // listener from a stale generation (see top of file).
    const overlay = document.getElementById('ox-menu-overlay');
    overlay?.classList.contains('active') ? closeMenu() : openMenu();
  }

  // ── Events ──
  // The actual click → toggle wiring lives in the single delegated
  // listener registered once at the top of this file; we just keep the
  // pointer to this generation's toggleMenu fresh.
  (window as any).__oxygenMenuToggle = toggleMenu;

  menuOverlay.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMenu();
  });

  // Shared by the main nav links AND the right-panel featured-project
  // link (.ox-featured-link) — previously only .ox-menu-link got this
  // treatment, so clicking the featured card fell through to Astro's
  // default link interception and skipped the close+blur-out entirely
  // (the overlay just jump-cut instead of blurring away with everything
  // else).
  function bindMenuNavLink(link: HTMLAnchorElement, activeClass: string) {
    // Mobile: touchstart gives immediate visual feedback before click fires
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStartX = 0;
    let touchStartY = 0;
    // Set when touchend itself decides this was a tap and drives the
    // navigation directly — tells the click listener below to skip
    // (both the synthetic click iOS still dispatches after a
    // preventDefault()'d touchend, AND, as a defensive fallback on
    // whatever browser doesn't send one, a stray real click on the same
    // gesture) instead of running the whole sequence a second time.
    let handledByTouch = false;

    async function activate() {
      link.classList.add(activeClass);
      const href = link.getAttribute('href');
      // On touch: hold the active state briefly so the user sees the highlight
      // Every device: long enough for the text roll + sibling dim
      // (OxygenMenu.astro) to mostly play out before the fade-out starts,
      // instead of cutting them off mid-motion.
      await new Promise(r => setTimeout(r, 280));
      await closeMenu(true, true);  // keep black overlay visible, blur out
      if (href) navigate(href); // View Transition starts from black screen
    }

    link.addEventListener('touchstart', (e) => {
      // No highlight here — it flashed on every touch, including the start
      // of a scroll. activate() highlights on a confirmed tap instead.
      const t = e.touches[0];
      if (t) { touchStartX = t.clientX; touchStartY = t.clientY; }
    }, { passive: true });

    link.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t ? Math.abs(t.clientX - touchStartX) : Infinity;
      const dy = t ? Math.abs(t.clientY - touchStartY) : Infinity;
      // iOS Safari can silently drop the click event that's supposed to
      // follow touchstart/touchend if the finger moved at all during the
      // gesture — even a couple pixels, well short of an intentional
      // scroll — misreading it as a swipe instead of a tap. Waiting for
      // that click (the old approach) meant navigation just silently
      // never happened maybe 1 time in 5 on iOS: the link flashed red
      // then faded back to white via the releaseTimer below, with nothing
      // else occurring. Android/Chrome doesn't have this quirk, which is
      // why it only ever showed up on iPhones. Driving the tap ourselves
      // off touchend (small-movement = tap) sidesteps waiting on a click
      // event that may not come at all.
      if (dx < 10 && dy < 10) {
        e.preventDefault();
        handledByTouch = true;
        void activate();
        return;
      }
      // Real scroll/swipe, not a tap — just a tap-feedback release, same
      // as before. Was unconditional pre-fix: this timer and the click
      // handler's own ~120ms wait + ~300ms blur-out (~420ms total before
      // navigate() even fires) were racing on the same clock, and 400ms
      // usually won — the link flashed back to white while the menu was
      // still visibly closing.
      releaseTimer = setTimeout(() => link.classList.remove(activeClass), 400);
    }, { passive: false }); // not passive: this path calls preventDefault()

    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (handledByTouch) { handledByTouch = false; return; }
      if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
      void activate();
    });
  }

  document.querySelectorAll<HTMLAnchorElement>('.ox-menu-link').forEach((link) => {
    bindMenuNavLink(link, 'ox-link--active');
  });
  document.querySelectorAll<HTMLAnchorElement>('.ox-featured-link').forEach((link) => {
    bindMenuNavLink(link, 'ox-featured-link--active');
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (state.isMenuOpen) closeMenu();
    if (hudContactBtn?.classList.contains('is-open')) setContactDockOpen(false);
  }
  document.addEventListener('keydown', onKeyDown);

  let ticking = false;
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(() => {
        handleScroll();
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Init ──
  // #ox-hud-mobile carries the .hud-scroll-hidden class across navigations
  // wherever the browser/Astro happens to preserve it (bfcache restore,
  // stale state left on a shared element) — force it back to the
  // state.barHidden === false baseline explicitly on every init rather
  // than trusting whatever's already there. One classList.remove(), no
  // tweens to kill, nothing that can be "half" reset.
  function resetHudMenuBtn() {
    // Defensive: purge any inline opacity/pointer-events/filter left on
    // these two elements by the OLD GSAP-driven swap this replaced. An
    // inline style always wins over a CSS class rule, no matter how
    // specific — if either element still carries one from before this
    // page last picked up the new code (e.g. hud-menu-btn's
    // transition:persist DOM node surviving from an older script version
    // in the same tab), the new .hud-scroll-hidden class can never
    // override it and the button would look permanently stuck.
    hudMenuBtn?.style.removeProperty('opacity');
    hudMenuBtn?.style.removeProperty('pointer-events');
    hudMenuBtn?.style.removeProperty('filter');
    if (hudMenuBtn) gsap.set(hudMenuBtn, { scale: 1 });
    hudContactBtn?.style.removeProperty('opacity');
    hudContactBtn?.style.removeProperty('pointer-events');
    setBarHidden(false);
    state.barHidden = false;
    state.scrollAccum = 0;
    state.menuShrink = 0;
  }
  resetHudMenuBtn();
  showHeader();
  updateClock();
  state.timeInterval = setInterval(updateClock, 1000);
  handleScroll();

  // Mobile bfcache restore (e.g. swiping back mid-scroll, while
  // .hud-scroll-hidden was applied) freezes the page as-is and thaws it
  // later WITHOUT re-running this script, so the reset above never gets a
  // second chance to run on its own. pageshow with event.persisted is the
  // one signal that fires on that restore; this closure (state,
  // resetHudMenuBtn) is still alive since bfcache freezes JS memory rather
  // than tearing it down, so re-running the same reset here is enough.
  function onPageShow(e: PageTransitionEvent) {
    if (e.persisted) {
      resetHudMenuBtn();
      handleScroll();
    }
  }
  window.addEventListener('pageshow', onPageShow);

  // hud-menu-btn carries transition:persist (see markup above), so this
  // is the SAME DOM node across every navigation — Astro never tears it
  // down and Chromium never has to snapshot it into a View Transition
  // frame, which is what was rendering it as a flat gray box for a
  // moment (a browser-level snapshot bug, not something fixable from
  // this script alone). That only pays off if the canvas riding along
  // inside it also stays put: build the beam effect once per page
  // session and leave it running, instead of destroying and recreating
  // its WebGL context on every init like the rest of this component does.
  // Skipped at ≤1024px: OxygenMenu.astro hides .specular-button__fx there
  // (display:none), but the WebGL2 context and its per-frame rAF draw would
  // otherwise keep running invisibly for the whole session on every phone.
  if (hudMenuBtn && !(window as any).__oxMenuSpecular && !isMobile) {
    (window as any).__oxMenuSpecular = new SpecularButton(hudMenuBtn, {
      radius: 0,
      lineColor: '#ffffff',
      baseColor: '#525252',
      intensity: 1,
      shineSize: 10,
      shineFade: 40,
      thickness: 1,
      speed: 0.35,
      proximity: 250,
    });
  }

  // ── Cleanup for View Transitions ──
  function cleanup() {
    if (state.isMenuOpen) {
      menuOverlay?.classList.remove('active');
      hudMenuBtn?.classList.remove('active');
      unlockBodyScroll();
    }
    if (state.releaseScrollLock) {
      state.releaseScrollLock();
      state.releaseScrollLock = null;
    }
    if (state.timeInterval) clearInterval(state.timeInterval);
    if (contactDockCloseTimer) { clearTimeout(contactDockCloseTimer); contactDockCloseTimer = null; }
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('keydown', onKeyDown);
    // menuSpecular is intentionally NOT destroyed here — see above.
  }

  (window as any).__oxygenMenuCleanup = cleanup;
  document.addEventListener('astro:before-swap', cleanup, { once: true });
}

// Run on first load & after View Transitions
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOxygenMenu);
} else {
  initOxygenMenu();
}
document.addEventListener('astro:page-load', initOxygenMenu);
