// The opening on PHONES and TABLETS (touch): a stage of steps driven by ONE number, `pos`:
//   0 = the hero, 1 = the manifesto, 2 = hand-off to the page (Services and everything after it is the plain Lenis scroll).
// A step is on screen while |i - pos| is under its reach (see render). Desktop keeps the scroll-driven opening; this module
// does nothing there, and nothing with prefers-reduced-motion (plain flow).
//
//  - one gesture = one step (swipe, drag, key, wheel); a new gesture takes over a running step, input is never locked
//  - the stage always comes to rest ON a step, so nothing is left half blurred
//  - a step is a focus pull: opacity / rise / scale / blur of its elements, from how far the step is from `pos` (smoothstep)
//  - the manifesto fills itself on the clock when it is reached (words in reading order, soft edge); leaving for the hero
//    empties it, leaving for the page does not (it goes out as it stands), and coming back from the page it returns whole
//  - `pos` follows its goal with the smoothing of the page's Lenis (its lerp, read from it), so the stage brakes like the scroll
//  - the hero's light, veil and blur follow `pos`
//
// Only the mechanism lives here: looks (fonts, colours, markup) stay with the sections. Everything tunable is in CFG.

import { createWheelGesture } from './wheelGesture';

export const CFG = {
	// motion
	tempo: 0.5,           // speed of a step relative to the page's Lenis (1 = its own lerp)
	handoffAt: 1.5,       // pos at which the manifesto is gone and the page takes over
	reentry: 0.35,        // coming back from the page the stage starts this far short of the hand-off (the manifesto is already coming in)
	seamFocus: 0.5,       // where on the screen (share of its height) the first service name comes to rest after the hand-off
	// looks
	overlap: 0.2,         // neighbouring steps start showing this much earlier (share of a step): at the midpoint both are partly there
	stagger: 0.035,       // per element index, for the step coming in
	stepBlur: 16,         // px  blur of a step's elements out of focus
	stepBlurLow: 10,      // px  ... on weaker phones
	wordBlur: 11,         // px  blur of manifesto words the fill has not reached
	wordBlurLow: 6,
	fillTime: 2.6,        // s   the manifesto filling itself
	soft: 0.7,            // softness of the fill's edge
	emptyTime: 0.7,       // s   the fill emptying when leaving for the hero
	// input
	dragSpan: 0.9,        // pos = start - dy / (height * dragSpan)
	edgeResist: 0.25,     // a drag beyond the ends
	commitDist: 0.1,      // share of the height that commits a drag to the next step ...
	commitSpeed: 0.4,     // ... or this speed, px / ms
	captureAfter: 6,      // px  a drag on a button / link captures the pointer only after this
	clickBlock: 8,        // px  a drag longer than this blocks the click that follows ...
	clickBlockMs: 350,    // ms  ... for this long
	// gate: input waits for the hero's text to land
	introGraceMs: 600,    // ms  at least this long after the stage started (the text's own fade-in must not be fought)
	introGateMs: 2500,    // ms  at most this long
};

const LAST = 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const inOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export const isTouchStage = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

export function initIntroStage(): (() => void) | null {
	if (!isTouchStage() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
	const root = document.documentElement;
	const pin = document.getElementById('hero-pin');
	const hero = document.getElementById('hero');
	const veil = document.getElementById('hero-veil');
	const blurLayer = document.getElementById('hero-blur');
	const rays = document.getElementById('rays-canvas');
	const man = document.getElementById('manifesto');
	const manStage = man?.querySelector<HTMLElement>(':scope > .sticky') ?? null;
	const copy = manStage?.querySelector<HTMLElement>('h2') ?? null;
	if (!pin || !hero || !veil || !blurLayer || !man || !manStage || !copy) return null;

	const weak = (navigator.hardwareConcurrency || 8) <= 4 || ((navigator as any).deviceMemory || 8) <= 3;
	const STEP_BLUR = weak ? CFG.stepBlurLow : CFG.stepBlur;
	const WORD_BLUR = weak ? CFG.wordBlurLow : CFG.wordBlur;

	// ── the steps: the sections' own elements (nested ones are left to their parent) ──
	const outermost = (selectors: string[]) => {
		const all = selectors.flatMap((s) => Array.from(document.querySelectorAll<HTMLElement>(s)));
		return all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
	};
	const items: HTMLElement[][] = [outermost(['.hero-kicker', '.h-hero-claim__line', '.h-hero-sub', '.hero-cta-row', '#hero-bottom']), [copy]];
	const containers: HTMLElement[] = [hero, manStage];
	const words = Array.from(man.querySelectorAll<HTMLElement>('.mw:not(.br)')).map((el, i, all) => ({
		el, rank: all.length > 1 ? i / (all.length - 1) : 0,
	}));
	const flow = man.parentElement;   // the wrapper over everything after the hero: while the stage holds the page it must not swallow the hero's taps

	// ── state ──
	const S = { pos: 0, fill: 0 };
	let idx = 0;                        // the step the stage is at, or going to
	let goal = 0;                       // where `pos` is heading
	let height = innerHeight, handoffY = 1e9;
	let on = true;                      // the stage holds the page (scrollY stays 0)
	let ready = hero.classList.contains('pt-intro-done');   // the hero's text has landed: input is taken
	let heroTouched = false;            // the stage has written the hero's styles (until then the hero's own intro owns them)
	let drag: any = null, suppressClick = false;
	let lenis: any = null, weStopped = false;
	let dead = false;
	const shown = [true, false];
	let lightDark: boolean | null = null, lastFill = -1;
	let motionRaf = 0, motionT = 0, arrive: (() => void) | undefined, stopAt: number | undefined;
	let fillRaf = 0, fillTimer = 0, lenisRaf = 0, lenisTries = 0, gateTimer = 0, layoutTimer = 0;

	const measure = () => {
		height = hero.clientHeight || innerHeight;
		handoffY = man.getBoundingClientRect().top + window.scrollY + man.offsetHeight - window.innerHeight;
	};
	const menuOpen = () => document.body.classList.contains('oxygen-menu-open');

	// ── holding the page (inline styles: a stylesheet rule for these did not reliably reach the page) ──
	const lock = (yes: boolean) => {
		root.classList.toggle('intro-on', yes);
		for (const el of [root.style, document.body.style] as any[]) {
			el.touchAction = yes ? 'none' : '';
			el.overscrollBehavior = yes ? 'none' : '';
			el.userSelect = yes ? 'none' : '';
			el.webkitUserSelect = yes ? 'none' : '';
			el.webkitTouchCallout = yes ? 'none' : '';
		}
		if (flow) flow.style.pointerEvents = yes ? 'none' : '';
	};
	const grab = () => {
		on = true;
		lock(true);
		if (lenis && !lenis.isStopped) { lenis.stop(); weStopped = true; }
	};
	const letGo = () => {
		on = false;
		lock(false);
		if (lenis && weStopped) { lenis.start(); weStopped = false; }
	};
	// Lenis is created a frame or so after the page loads: picked up when it appears
	const attachLenis = () => {
		lenis = (window as any).__lenis;
		if (lenis) { if (on) grab(); return; }
		if (++lenisTries < 120) lenisRaf = requestAnimationFrame(attachLenis);
	};
	const jump = (y: number) => { if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y); };

	// ── render ──
	// the hero's light: brightness, and fully dark it stops being drawn (HeroSection's initRays listens)
	const applyLight = (level: number) => {
		if (!rays) return;
		const dark = level <= 0.001;
		if (lightDark !== dark) {
			lightDark = dark;
			rays.dataset.dark = dark ? '1' : '';
			rays.dispatchEvent(new CustomEvent('pt:rays-dark', { detail: dark }));
		}
		rays.style.filter = level < 0.999 ? `brightness(${level.toFixed(3)})` : '';
	};

	function render() {
		const v = S.pos;

		// the hero's light goes out first, then the blur and the veil take what is left
		const p = clamp(v, 0, 1);
		applyLight(1 - smooth((p - 0.02) / 0.28));
		const blur = smooth((p - 0.02) / 0.30), dark = smooth((p - 0.22) / 0.34), live = v < 1;
		blurLayer.style.visibility = blur > 0 && live ? 'visible' : 'hidden';
		blurLayer.style.backdropFilter = blurLayer.style.webkitBackdropFilter = blur > 0 ? `blur(${(blur * 5.5).toFixed(1)}px)` : '';
		veil.style.visibility = dark > 0 && live ? 'visible' : 'hidden';
		veil.style.opacity = dark.toFixed(3);

		for (let i = 0; i < 2; i++) {
			const d = i - v, ad = Math.abs(d), box = containers[i];
			// The manifesto going OUT to the page (d < 0 with pos still moving on) keeps the plain timing; every other change
			// overlaps with its neighbour, the manifesto coming back in from the page included (no black stretch on the way up).
			const overlap = i === 1 && d < 0 && goal >= S.pos ? 0 : CFG.overlap;
			const reach = 0.5 + overlap;
			if (ad >= reach) {   // the step is gone: not drawn, not clickable
				if (shown[i]) { box.style.visibility = 'hidden'; shown[i] = false; }
				continue;
			}
			if (!shown[i]) { box.style.visibility = 'visible'; shown[i] = true; }
			if (i === 0) box.style.pointerEvents = ad < 0.3 ? '' : 'none';   // an out-of-focus hero must not take taps
			if (i === 0 && ad === 0 && !heroTouched) continue;               // at rest on the hero its own intro owns the styles
			if (i === 0) heroTouched = true;
			const u = 1 - ad, dir = d > 0 ? 1 : -1;
			items[i].forEach((el, k) => {
				const c = smooth((u - (1 - reach) - (d > 0 ? k * CFG.stagger : 0)) / 0.42);
				const st = el.style;
				if (c >= 0.999) { st.opacity = '1'; st.filter = 'none'; st.transform = ''; return; }
				st.opacity = c.toFixed(3);
				st.filter = `blur(${((1 - c) * STEP_BLUR).toFixed(1)}px)`;
				st.transform = `translate3d(0,${(dir * (1 - c) * 26).toFixed(1)}px,0) scale(${(1 + dir * 0.05 * (1 - c)).toFixed(4)})`;
			});
		}

		// the fill: a soft edge sweeps through the words in reading order
		if (S.fill !== lastFill) {
			lastFill = S.fill;
			for (const w of words) {
				const e = smooth((S.fill * (1 + CFG.soft) - w.rank) / CFG.soft), st = w.el.style;
				if (e >= 0.999) { st.filter = 'none'; st.opacity = '1'; st.transform = ''; continue; }
				st.filter = `blur(${((1 - e) * WORD_BLUR).toFixed(1)}px)`;
				st.opacity = (0.3 + 0.7 * e).toFixed(3);
				st.transform = `translate3d(0,${((1 - e) * 7).toFixed(1)}px,0)`;
			}
		}
	}

	// ── motion ──
	// `pos` follows `goal` with the exponential smoothing Lenis uses for the scroll (its own lerp, read from it, times tempo)
	const lerpBase = () => {
		const o = lenis?.options;
		const l = o ? (o.syncTouch ? o.syncTouchLerp : o.lerp) : 0;
		return l > 0 && l < 1 ? l : 0.06;
	};
	function follow(g: number, done?: () => void, until?: number) {
		goal = g; arrive = done; stopAt = until;
		if (!motionRaf) { motionT = performance.now(); motionRaf = requestAnimationFrame(frame); }
	}
	function frame(now: number) {
		const dt = Math.min(0.05, (now - motionT) / 1000);
		motionT = now;
		S.pos += (goal - S.pos) * (1 - Math.pow(1 - lerpBase() * CFG.tempo, dt * 60));
		if (Math.abs(goal - S.pos) < 0.003) S.pos = goal;
		render();
		const cb = arrive;
		if ((stopAt != null && S.pos >= stopAt && goal >= stopAt) || S.pos === goal) { motionRaf = 0; arrive = undefined; cb?.(); return; }
		motionRaf = requestAnimationFrame(frame);
	}
	const stopFollow = () => { cancelAnimationFrame(motionRaf); motionRaf = 0; };

	function fillTo(target: number, ms: number, delay: number) {
		clearTimeout(fillTimer); cancelAnimationFrame(fillRaf);
		fillTimer = window.setTimeout(() => {
			const from = S.fill, t0 = performance.now();
			const tick = (now: number) => {
				const t = Math.min(1, (now - t0) / ms);
				S.fill = from + (target - from) * inOutSine(t);
				render();
				if (t < 1) fillRaf = requestAnimationFrame(tick);
			};
			tick(t0);
		}, delay * 1000);
	}
	const setFill = (v: number) => { clearTimeout(fillTimer); cancelAnimationFrame(fillRaf); S.fill = v; };

	// Go to step n. `back`: the stage takes the page again from the page side (scrolling UP from Services): the manifesto
	// returns as it left, whole, not empty and filling itself again.
	function settle(n: number, back = false) {
		idx = n;
		follow(n, n === LAST ? handOff : undefined, n === LAST ? CFG.handoffAt : undefined);
		if (n === 1) {
			if (back) { setFill(1); render(); }
			else fillTo(1, CFG.fillTime * 1000, 0);   // reached the text: it fills itself
		} else if (n !== LAST) {
			fillTo(0, CFG.emptyTime * 1000, 0.25);    // left it for the hero: it empties, ready for the next time
		}
		// n === LAST: going out to the page, the text leaves as it stands
	}
	function goTo(n: number) {
		n = clamp(Math.round(n), 0, LAST);
		if (n === idx && Math.abs(S.pos - n) < 0.001) return;
		settle(n);
	}

	// ── hand-off ──
	// Past the manifesto the page is the plain scroll (Services on); the stage's own layout stays as it was.
	function hideAll() {
		for (let i = 0; i < 2; i++) { containers[i].style.visibility = 'hidden'; shown[i] = false; }
		veil.style.visibility = 'hidden';
		blurLayer.style.visibility = 'hidden';
	}
	function handOff() {
		if (dead || idx !== LAST) return;
		stopFollow();
		S.pos = LAST; render();
		measure();
		hideAll();
		jump(handoffY);
		letGo();
		// the seam: the page does not stand there empty, a scroll with the page's own smoothing carries the first service
		// name up into focus (the names rise by their own position, so they come out of the blur by themselves)
		const row = document.querySelector<HTMLElement>('#services .svc__row');
		if (!row) return;
		const r = row.getBoundingClientRect();
		const dist = Math.max(0, r.top + r.height / 2 - window.innerHeight * CFG.seamFocus);
		if (dist < 4) return;
		if (lenis) lenis.scrollTo(handoffY + dist, { lerp: lerpBase(), force: true, lock: false });
		else window.scrollTo({ top: handoffY + dist, behavior: 'smooth' });
	}
	// coming back up from Services (or a jump to the top): the stage takes the page again
	function engage(to: number) {
		if (on) return;
		grab();
		jump(0);
		S.pos = LAST - CFG.reentry; goal = to; idx = LAST; heroTouched = true;
		setFill(1);   // the manifesto comes back whole
		render();
		settle(to, true);
	}
	// the page came up already past the stage (a restored scroll, an anchor): no step, just let go
	function releaseNow() {
		stopFollow();
		S.pos = LAST; idx = LAST; render(); hideAll(); letGo();
	}
	const onScroll = () => {
		const y = window.scrollY;
		if (on) {
			if (y > 0.5) { if (y >= handoffY - 12 && !drag) releaseNow(); else window.scrollTo(0, 0); }
		} else if (y < handoffY - 12 && ready) engage(y < window.innerHeight * 0.2 ? 0 : 1);
	};

	// ── input: one gesture = one step ──
	const free = () => on && ready && !menuOpen();
	const onKey = (e: KeyboardEvent) => {
		if (!free() || e.altKey || e.ctrlKey || e.metaKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); goTo(idx + 1); }
		else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); goTo(idx - 1); }
		else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
		else if (e.key === 'End') { e.preventDefault(); goTo(LAST); }
	};
	const capture = (e: PointerEvent) => { drag.cap = true; try { root.setPointerCapture(e.pointerId); } catch (_) {} };
	const onDown = (e: PointerEvent) => {
		if (!free() || e.pointerType === 'mouse') return;
		drag = { y: e.clientY, ly: e.clientY, t: performance.now(), id: e.pointerId, moved: 0, p0: S.pos, cap: false };
		if (!(e.target as HTMLElement).closest('button,a')) capture(e);   // taps on buttons and links must still click
	};
	const onMove = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		drag.ly = e.clientY;
		const d = e.clientY - drag.y;
		drag.moved = Math.max(drag.moved, Math.abs(d));
		if (!drag.cap && drag.moved > CFG.captureAfter) capture(e);
		let q = drag.p0 - d / (height * CFG.dragSpan);
		if (q < 0) q *= CFG.edgeResist; else if (q > LAST) q = LAST + (q - LAST) * CFG.edgeResist;
		follow(q);   // the goal moves with the finger; pos follows it with the page's own smoothing
	};
	const onUp = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		const y = e.type === 'pointercancel' ? drag.ly : e.clientY;   // a cancelled pointer reports y = 0
		const d = y - drag.y, v = d / Math.max(1, performance.now() - drag.t), dir = d < 0 ? 1 : -1;
		const moved = drag.moved;
		drag = null;
		try { root.releasePointerCapture(e.pointerId); } catch (_) {}
		if (moved > CFG.clickBlock) { suppressClick = true; setTimeout(() => (suppressClick = false), CFG.clickBlockMs); }
		if (moved <= 2 && Math.abs(S.pos - idx) < 0.001) return;   // a tap: nothing moved
		const commit = Math.abs(d) > height * CFG.commitDist || Math.abs(v) > CFG.commitSpeed;
		const n = clamp(commit ? idx + dir : Math.round(goal), 0, LAST);
		if (n === idx && Math.abs(goal - n) < 0.001 && Math.abs(S.pos - n) < 0.001) return;
		settle(n);
	};
	const onClick = (e: MouseEvent) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } };
	// a wheel / trackpad (an iPad with a trackpad, a narrow window with a mouse): one gesture = one step
	const wheelStep = createWheelGesture((dir) => goTo(idx + dir));
	const onWheel = (e: WheelEvent) => {
		if (!free()) return;
		e.preventDefault();
		wheelStep(e);
	};
	const onResize = () => { measure(); render(); };

	// ── start ──
	measure();
	const y0 = window.scrollY;
	if (y0 >= handoffY - 12) { on = false; S.pos = LAST; idx = LAST; render(); hideAll(); }
	else { if (y0 > 0) window.scrollTo(0, 0); grab(); render(); }
	attachLenis();
	if (!ready) {
		// Input opens when the hero's TEXT has landed (HeroSection sets __ptHeroTextReady), not when its light has finished:
		// on a page reached by going back the light takes ~4 s, and the swipes would be ignored all that time.
		const open = () => { ready = true; clearTimeout(gateTimer); };
		gateTimer = window.setTimeout(open, CFG.introGateMs);
		const t0 = performance.now();
		const poll = window.setInterval(() => {
			if (dead) { clearInterval(poll); return; }
			const textLanded = (window as any).__ptHeroTextReady === true && performance.now() - t0 > CFG.introGraceMs;
			if (textLanded || hero.classList.contains('pt-intro-done')) { open(); clearInterval(poll); }
		}, 100);
	}
	// after fonts and layout settle
	layoutTimer = window.setTimeout(() => { measure(); if (on && window.scrollY >= handoffY - 12 && window.scrollY > 0) releaseNow(); }, 400);

	addEventListener('keydown', onKey);
	addEventListener('wheel', onWheel, { passive: false });
	document.addEventListener('pointerdown', onDown);
	document.addEventListener('pointermove', onMove);
	document.addEventListener('pointerup', onUp);
	document.addEventListener('pointercancel', onUp);
	document.addEventListener('click', onClick, true);
	addEventListener('scroll', onScroll, { passive: true });
	addEventListener('resize', onResize, { passive: true });

	return () => {
		dead = true;
		stopFollow();
		cancelAnimationFrame(fillRaf); cancelAnimationFrame(lenisRaf);
		clearTimeout(fillTimer); clearTimeout(gateTimer); clearTimeout(layoutTimer);
		removeEventListener('keydown', onKey);
		removeEventListener('wheel', onWheel);
		document.removeEventListener('pointerdown', onDown);
		document.removeEventListener('pointermove', onMove);
		document.removeEventListener('pointerup', onUp);
		document.removeEventListener('pointercancel', onUp);
		document.removeEventListener('click', onClick, true);
		removeEventListener('scroll', onScroll);
		removeEventListener('resize', onResize);
		lock(false);
		if (lenis && weStopped) lenis.start();
		if (rays) { rays.style.filter = ''; rays.dataset.dark = ''; }
	};
}
