// The opening on PHONES and TABLETS (touch): a stage driven by ONE number, `pos` (a float): 0 = the hero, 1 = the manifesto,
// 2 = hand-off to the page (Services and everything after it stay the plain Lenis scroll). A step is visible while |i - pos| < 1.
// (Desktop keeps the scroll-driven opening; this module does nothing there.)
//
//  - one gesture = one step (swipe / drag, keys); a new gesture interrupts a running step, the input is never locked
//  - the stage always comes to rest ON a step, so nothing is ever left half blurred (the blotches of a finger-scrubbed scroll)
//  - a step is a "focus pull": opacity / translateY / scale / blur of the step's elements from u = 1 - |d| (smoothstep)
//  - the manifesto fills ITSELF on the clock once it is reached (words in reading order, soft edge, white); leaving resets it fast
//  - pos follows its goal with the smoothing of the page's Lenis (its lerp is read from it), so the stage brakes like the scroll
//  - the hero's light / veil / blur follow `pos`
//
// Only the mechanism lives here: the looks (fonts, colours, markup) stay with the sections. Everything tunable is in CFG.
// prefers-reduced-motion: not started (plain flow).

export const CFG = {
	tempo: 0.5,          // speed of a step relative to the page's Lenis (1 = its own lerp, 0.5 = half as fast)
	lerp: 0,             // 0 = take the lerp from Lenis (touch: syncTouchLerp); a number overrides
	handoffAt: 1.5,      // pos at which the manifesto is fully gone and the page takes over
	seamFocus: 0.5,      // where on the screen (share of its height) the first service name comes to rest
	stepBlur: 16,        // px  blur of a step's elements while out of focus
	stepBlurLow: 10,     // px  ... on weaker phones
	overlap: 0.2,        // hero <-> manifesto: a step starts showing this much earlier (share of a step), so at the midpoint both are partly visible and the screen is never empty (0 = the old, empty midpoint)
	reentry: 0.35,       // coming back up from the page: the stage starts this far short of the hand-off, so the manifesto is already coming in (no black gap)
	stagger: 0.035,      // per element index, entering steps only
	fillDelay: 0,        // s   before the fill starts
	fillTime: 2.6,       // s   how long the text takes to fill (inOutSine)
	soft: 0.7,           // softness of the fill edge
	wordBlur: 11,        // px  words the fill has not reached yet
	wordBlurLow: 6,
	grow: 0,             // the whole block pushes in by this much (0 = off; the prototype had 0.05) ...
	growTime: 2.2,       // s   ... this slowly (ease-out)
	red: false,          // the two accent words wipe red after the fill (the prototype did; off: they stay white)
	redDelay: 0.15,      // s   white -> red pause
	redTime: 1.7,        // s   the red wipe
	redStag: 0.35,       // the next accent word starts this much later (share of the wipe)
	glow: 16,            // px  red glow while the wipe runs
	glowLow: 8,
	resetTime: 0.4,      // s   leaving the manifesto: red / grow reset
	emptyTime: 0.7,      // s   leaving the manifesto: the fill empties
	dragSpan: 0.9,       // pos = p0 - dy / (hh * dragSpan)
	edgeResist: 0.25,    // drag beyond the ends
	commitDist: 0.1,     // share of the height that commits a drag ...
	commitSpeed: 0.4,    // ... or this speed, px / ms
	captureAfter: 6,     // px  before a drag on a button / link captures the pointer
	clickBlock: 8,       // px  a drag longer than this blocks the click ...
	clickBlockMs: 350,   // ms  ... for this long
	introGateMs: 4000,   // ms  input waits for the hero's intro, at most this long
	wheelMin: 8,         // wheel / trackpad (iPad with a mouse): smallest delta that counts as a gesture
	wheelCooldownMs: 700, // ms  one wheel gesture = one step; the inertia tail of a trackpad is ignored for this long
};

const LAST = 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const outCubic = (t: number) => 1 - (1 - t) ** 3;
const inOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export const isTouchStage = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

export function initIntroStage(): (() => void) | null {
	if (!isTouchStage() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
	const root = document.documentElement;
	const pin = document.getElementById('hero-pin');
	const hero = document.getElementById('hero');
	const veil = document.getElementById('hero-veil');
	const blurL = document.getElementById('hero-blur');
	const rays = document.getElementById('rays-canvas');
	const man = document.getElementById('manifesto');
	const mStage = man?.querySelector<HTMLElement>(':scope > .sticky') ?? null;
	const copy = mStage?.querySelector<HTMLElement>('h2') ?? null;
	if (!pin || !hero || !veil || !blurL || !man || !mStage || !copy) return null;

	const low = (navigator.hardwareConcurrency || 8) <= 4 || ((navigator as any).deviceMemory || 8) <= 3;
	const STEP_BLUR = low ? CFG.stepBlurLow : CFG.stepBlur;
	const WORD_BLUR = low ? CFG.wordBlurLow : CFG.wordBlur;
	const GLOW = low ? CFG.glowLow : CFG.glow;

	// ── the steps' elements (the sections' own markup; nested ones are left to their parent) ──
	const pick = (sel: string[]) => {
		const all = sel.flatMap((s) => Array.from(document.querySelectorAll<HTMLElement>(s)));
		return all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
	};
	const items: HTMLElement[][] = [pick(['.hero-kicker', '.h-hero-claim__line', '.h-hero-sub', '.hero-cta-row', '#hero-bottom']), [copy]];
	const containers: HTMLElement[] = [hero, mStage];
	const words = Array.from(man.querySelectorAll<HTMLElement>('.mw:not(.br)')).map((el, i, all) => ({
		el, hl: el.classList.contains('mw--accent'), hi: 0, rank: all.length > 1 ? i / (all.length - 1) : 0,
	}));
	let hlN = 0;
	words.forEach((w) => { if (w.hl) w.hi = hlN++; });
	const redRgb = getComputedStyle(root).getPropertyValue('--c-red').trim().split(/\s+/).join(',') || '255,62,30';

	// ── state ──
	const S = { pos: 0, fill: 0, red: 0, grow: 0 };
	let idx = 0, hh = innerHeight, handoffY = 1e9;
	let on = true;                       // the stage holds the page (scrollY stays 0)
	let drag: any = null, suppressClick = false, lastStep = 0;
	let tweenRaf = 0, fillRaf = 0, fillTimer = 0, redRaf = 0, redTimer = 0, growRaf = 0, dead = false;
	let lenis: any = null, weStopped = false, lenisRaf = 0, lenisTries = 0, gateTimer = 0, late = 0;
	let ready = hero.classList.contains('pt-intro-done');
	const shown = [true, false];
	let lightV = 1, lightDark: boolean | null = null, lastFill = -1, lastRed = -1, heroTouched = false;

	const measure = () => {
		hh = hero.clientHeight || innerHeight;
		handoffY = man.getBoundingClientRect().top + window.scrollY + man.offsetHeight - window.innerHeight;
	};
	const menuOpen = () => document.body.classList.contains('oxygen-menu-open');

	// ── lenis / lock (set inline: a stylesheet rule for these did not reliably reach the page) ──
	const flow = man.parentElement;   // the wrapper over everything after the hero: it must not swallow the hero's taps
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
	const attachLenis = () => {
		lenis = (window as any).__lenis;
		if (lenis) { if (on) grab(); return; }
		if (++lenisTries < 120) lenisRaf = requestAnimationFrame(attachLenis);
	};

	// ── RENDER ──
	const applyLight = () => {
		if (!rays) return;
		const dark = lightV <= 0.001;
		if (lightDark !== dark) {
			lightDark = dark;
			rays.dataset.dark = dark ? '1' : '';
			// fully out: the hero stops drawing it (HeroSection's initRays listens), and starts again on the way back
			rays.dispatchEvent(new CustomEvent('pt:rays-dark', { detail: dark }));
		}
		rays.style.filter = lightV < 0.999 ? `brightness(${lightV.toFixed(3)})` : '';
	};

	function render() {
		const v = S.pos;

		// the hero's light, blur and dark follow pos: the light goes first
		const p = clamp(v, 0, 1);
		lightV = 1 - smooth((p - 0.02) / 0.28);
		applyLight();
		const bk = smooth((p - 0.02) / 0.30), a = smooth((p - 0.22) / 0.34), live = v < 1;
		blurL.style.visibility = bk > 0 && live ? 'visible' : 'hidden';
		blurL.style.backdropFilter = blurL.style.webkitBackdropFilter = bk > 0 ? `blur(${(bk * 5.5).toFixed(1)}px)` : '';
		veil.style.visibility = a > 0 && live ? 'visible' : 'hidden';
		veil.style.opacity = a.toFixed(3);

		for (let i = 0; i < 2; i++) {
			const d = i - v, ad = Math.abs(d), box = containers[i];
			// the manifesto going OUT to the page (d < 0, and pos still moving on) keeps the plain timing; every other
			// change overlaps, also the manifesto coming back in from the page (goal < pos): no black stretch on the way up
			const ov = i === 1 && d < 0 && goal >= S.pos ? 0 : CFG.overlap, reach = 0.5 + ov;
			if (ad >= reach) {   // c is 0 from here on: the step is gone (not drawn, not clickable)
				if (shown[i]) { box.style.visibility = 'hidden'; shown[i] = false; }
				continue;
			}
			if (!shown[i]) { box.style.visibility = 'visible'; shown[i] = true; }
			if (i === 0) box.style.pointerEvents = ad < 0.3 ? '' : 'none';   // an out-of-focus hero must not take taps
			// at rest on the hero nothing is written: its own intro owns those styles until the first gesture
			if (i === 0 && ad === 0 && !heroTouched) continue;
			if (i === 0) heroTouched = true;
			const u = 1 - ad, dir = d > 0 ? 1 : -1;
			items[i].forEach((el, k) => {
				const c = smooth((u - (1 - reach) - (d > 0 ? k * CFG.stagger : 0)) / 0.42), st = el.style;
				const g = i === 1 ? 1 + CFG.grow * S.grow : 1;
				if (c >= 0.999) {
					st.opacity = '1'; st.filter = 'none';
					st.transform = i === 1 && g !== 1 ? `scale(${g.toFixed(4)})` : '';
					return;
				}
				st.opacity = c.toFixed(3);
				st.filter = `blur(${((1 - c) * STEP_BLUR).toFixed(1)}px)`;
				st.transform = `translate3d(0,${(dir * (1 - c) * 26).toFixed(1)}px,0) scale(${(g * (1 + dir * 0.05 * (1 - c))).toFixed(4)})`;
			});
		}

		// the fill: a soft edge sweeps through the words in reading order (white), the accent words wipe red afterwards (if on)
		if (S.fill !== lastFill || S.red !== lastRed) {
			lastFill = S.fill; lastRed = S.red;
			for (const w of words) {
				const e = smooth((S.fill * (1 + CFG.soft) - w.rank) / CFG.soft), st = w.el.style;
				let r = 0;
				if (w.hl && CFG.red) {
					r = smooth(clamp(S.red * (1 + CFG.redStag * (hlN - 1)) - w.hi * CFG.redStag, 0, 1));
					st.backgroundPosition = `${((1 - r) * 100).toFixed(1)}% 0`;
				}
				if (e >= 0.999) {
					const g = w.hl && CFG.red ? Math.sin(Math.PI * r) * 0.85 + r * 0.15 : 0;   // glow blooms mid-wipe, a faint halo stays
					st.filter = g > 0.01 ? `drop-shadow(0 0 ${(g * GLOW).toFixed(1)}px rgba(${redRgb},${(g * 0.75).toFixed(2)}))` : 'none';
					st.opacity = '1'; st.transform = '';
				} else {
					st.filter = `blur(${((1 - e) * WORD_BLUR).toFixed(1)}px)`;
					st.opacity = (0.3 + 0.7 * e).toFixed(3);
					st.transform = `translate3d(0,${((1 - e) * 7).toFixed(1)}px,0)`;
				}
			}
		}
	}

	// ── MOTION ──
	// pos follows its goal with the exponential smoothing Lenis uses for the scroll (the same lerp, read from Lenis, times tempo).
	const lerpBase = () => {
		if (CFG.lerp > 0) return CFG.lerp;
		const o = lenis?.options;
		const l = o ? (o.syncTouch ? o.syncTouchLerp : o.lerp) : 0;
		return l > 0 && l < 1 ? l : 0.06;
	};
	let goal = 0, lastT = 0, arrive: (() => void) | undefined, stopAt: number | undefined;
	function follow(g: number, done?: () => void, stop?: number) {
		goal = g; arrive = done; stopAt = stop;
		if (!tweenRaf) { lastT = performance.now(); tweenRaf = requestAnimationFrame(frame); }
	}
	function frame(now: number) {
		const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
		S.pos += (goal - S.pos) * (1 - Math.pow(1 - lerpBase() * CFG.tempo, dt * 60));
		if (Math.abs(goal - S.pos) < 0.003) S.pos = goal;
		render();
		const cb = arrive;
		if (stopAt != null && S.pos >= stopAt && goal >= stopAt) { tweenRaf = 0; arrive = undefined; cb?.(); return; }
		if (S.pos === goal) { tweenRaf = 0; arrive = undefined; cb?.(); return; }
		tweenRaf = requestAnimationFrame(frame);
	}
	const stopFollow = () => { cancelAnimationFrame(tweenRaf); tweenRaf = 0; };

	function redTo(target: number, ms: number, delay: number) {
		clearTimeout(redTimer); cancelAnimationFrame(redRaf);
		redTimer = window.setTimeout(() => {
			const from = S.red, t0 = performance.now();
			const tick = (now: number) => {
				const t = Math.min(1, (now - t0) / ms);
				S.red = from + (target - from) * inOutSine(t); render();
				if (t < 1) redRaf = requestAnimationFrame(tick);
			};
			tick(t0);
		}, delay * 1000);
	}
	function growTo(target: number, ms: number) {
		cancelAnimationFrame(growRaf);
		const from = S.grow, t0 = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - t0) / ms);
			S.grow = from + (target - from) * outCubic(t); render();
			if (t < 1) growRaf = requestAnimationFrame(tick);
		};
		tick(t0);
	}
	function fillTo(target: number, ms: number, delay: number) {
		clearTimeout(fillTimer); cancelAnimationFrame(fillRaf);
		fillTimer = window.setTimeout(() => {
			const from = S.fill, t0 = performance.now();
			const tick = (now: number) => {
				const t = Math.min(1, (now - t0) / ms);
				S.fill = from + (target - from) * inOutSine(t); render();
				if (t < 1) fillRaf = requestAnimationFrame(tick);
				else if (target === 1) { if (CFG.red) redTo(1, CFG.redTime * 1000, CFG.redDelay); if (CFG.grow) growTo(1, CFG.growTime * 1000); }
			};
			tick(t0);
		}, delay * 1000);
	}

	function goTo(n: number) {
		n = clamp(Math.round(n), 0, LAST);
		if (n === idx && Math.abs(S.pos - n) < 0.001) return;
		settle(n);
	}
	// back = the stage takes the page again from the page side (scrolling UP from Services): the manifesto returns as it left,
	// whole (the reverse of its going-out, as on desktop where the scroll simply runs the timeline backwards), not empty and
	// filling itself again like the first time.
	function settle(n: number, back = false) {
		if (n !== idx) lastStep = performance.now();
		idx = n;
		follow(n, n === LAST ? handOff : undefined, n === LAST ? CFG.handoffAt : undefined);
		if (n === 1) {
			redTo(0, 1, 0); growTo(0, 1);
			if (back) { clearTimeout(fillTimer); cancelAnimationFrame(fillRaf); S.fill = 1; render(); }
			else fillTo(1, CFG.fillTime * 1000, CFG.fillDelay);   // arrived at the text: it fills itself
		}
		else if (n === LAST) { /* going out to the page: it leaves as it stands (filled), it does not empty while it blurs away */ }
		else { redTo(0, CFG.resetTime * 1000, 0); growTo(0, 600); fillTo(0, CFG.emptyTime * 1000, 0.25); } // left it for the hero: empties, ready for the next time
	}

	// ── hand-off: past the manifesto the page is the plain scroll (Services on); the stage's own layout stays as it was ──
	function hideAll() {
		for (let i = 0; i < 2; i++) { containers[i].style.visibility = 'hidden'; shown[i] = false; }
		veil.style.visibility = 'hidden'; blurL.style.visibility = 'hidden';
	}
	function jump(y: number) {
		if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y);
	}
	function handOff() {
		if (dead || idx !== LAST) return;
		stopFollow();
		S.pos = LAST; render();
		measure();
		hideAll();
		jump(handoffY);
		letGo();
		// the seam: the page does not stand there empty — a scroll with the page's own smoothing carries the first service name
		// up into focus (the names rise by their own position, so they come in out of the blur by themselves)
		const row = document.querySelector<HTMLElement>('#services .svc__row');
		if (!row) return;
		const r = row.getBoundingClientRect();
		const dist = Math.max(0, r.top + r.height / 2 - window.innerHeight * CFG.seamFocus);
		if (dist < 4) return;
		if (lenis) lenis.scrollTo(handoffY + dist, { lerp: lerpBase(), force: true, lock: false });
		else window.scrollTo({ top: handoffY + dist, behavior: 'smooth' });
	}
	// coming back up from Services (or a jump to the top): the stage takes the page again, from the hand-off step
	function engage(to: number) {
		if (on) return;
		grab();
		jump(0);
		// start where the manifesto is already (faintly) showing, not at the far end where nothing is drawn
		S.pos = LAST - CFG.reentry; goal = to; idx = LAST; heroTouched = true;
		clearTimeout(fillTimer); cancelAnimationFrame(fillRaf); S.fill = 1;   // the manifesto comes back whole
		render();
		lastStep = performance.now();
		settle(to, true);
	}
	function releaseNow() {   // the page came up already past the stage (restored scroll, an anchor): no step, just let go
		stopFollow();
		S.pos = LAST; idx = LAST; render(); hideAll(); letGo();
	}
	const onScroll = () => {
		const y = window.scrollY;
		if (on) {
			if (y > 0.5) { if (y >= handoffY - 12 && !drag) releaseNow(); else window.scrollTo(0, 0); }
		} else if (y < handoffY - 12 && ready) engage(y < window.innerHeight * 0.2 ? 0 : 1);
	};

	// ── INPUT (one gesture = one step) ──
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
		if (!(e.target as HTMLElement).closest('button,a')) capture(e);   // taps on buttons / links must still click
	};
	const onMove = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		drag.ly = e.clientY;
		const d = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.abs(d));
		if (!drag.cap && drag.moved > CFG.captureAfter) capture(e);
		let q = drag.p0 - d / (hh * CFG.dragSpan);
		if (q < 0) q *= CFG.edgeResist; else if (q > LAST) q = LAST + (q - LAST) * CFG.edgeResist;
		follow(q);   // the goal moves with the finger; pos follows it with the page's own smoothing
	};
	const onUp = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		const y = e.type === 'pointercancel' ? drag.ly : e.clientY;   // a cancelled pointer reports y = 0
		const d = y - drag.y, v = d / Math.max(1, performance.now() - drag.t), dir = d < 0 ? 1 : -1;
		if (drag.moved > CFG.clickBlock) { suppressClick = true; setTimeout(() => (suppressClick = false), CFG.clickBlockMs); }
		const moved = drag.moved;
		drag = null;
		try { root.releasePointerCapture(e.pointerId); } catch (_) {}
		if (moved <= 2 && Math.abs(S.pos - idx) < 0.001) return;   // a tap: nothing moved
		const commit = Math.abs(d) > hh * CFG.commitDist || Math.abs(v) > CFG.commitSpeed;
		const n = clamp(commit ? idx + dir : Math.round(goal), 0, LAST);
		if (n === idx && Math.abs(goal - n) < 0.001 && Math.abs(S.pos - n) < 0.001) return;
		settle(n);
	};
	// a mouse wheel / trackpad on a coarse-pointer device (iPad + trackpad): one gesture = one step
	let lastWheel = 0;
	const onWheel = (e: WheelEvent) => {
		if (!free()) return;
		e.preventDefault();
		const now = performance.now();
		const since = now - lastWheel;
		lastWheel = now;   // inertia keeps extending the cooldown, so a trackpad's tail never triggers a second step
		if (Math.abs(e.deltaY) < CFG.wheelMin || since < CFG.wheelCooldownMs) return;
		goTo(idx + (e.deltaY > 0 ? 1 : -1));
	};
	const onClick = (e: MouseEvent) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } };
	const onResize = () => { measure(); render(); };

	// ── start ──
	measure();
	const y0 = window.scrollY;
	if (y0 >= handoffY - 12) { on = false; S.pos = LAST; idx = LAST; render(); hideAll(); }
	else { if (y0 > 0) window.scrollTo(0, 0); grab(); render(); }
	attachLenis();
	if (!ready) {
		const open = () => { ready = true; clearTimeout(gateTimer); };
		gateTimer = window.setTimeout(open, CFG.introGateMs);
		const iv = window.setInterval(() => { if (dead) clearInterval(iv); else if (hero.classList.contains('pt-intro-done')) { open(); clearInterval(iv); } }, 150);
	}
	late = window.setTimeout(() => { measure(); if (on && window.scrollY >= handoffY - 12 && window.scrollY > 0) releaseNow(); }, 400);   // after fonts / layout settle

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
		stopFollow(); cancelAnimationFrame(fillRaf); cancelAnimationFrame(redRaf); cancelAnimationFrame(growRaf); cancelAnimationFrame(lenisRaf);
		clearTimeout(fillTimer); clearTimeout(redTimer); clearTimeout(gateTimer); clearTimeout(late);
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
