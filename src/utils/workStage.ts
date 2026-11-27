// Selected work on PHONES and TABLETS (touch): one gesture = one picture, on a clock.
//
// The section is a tall page with a pinned (sticky) stage; on desktop the scroll position drives the light across the
// pictures. On touch the scroll is only the way IN and OUT:
//   - scrolling down, as soon as the title has pinned, the stage takes the page (Lenis stopped, the scroll position held)
//   - a swipe / drag / key / wheel then moves the light one picture on, in the same time whatever the force of the flick;
//     a new gesture takes over a running one; a short drag settles back, anything past 5 % of the height or quick steps on
//   - one more gesture past the last picture (or back past the title) hands the page to Lenis again, which glides on
//   - coming back up from the panel after the pictures, one flick down brings the stage back at the last picture
//
// The glides of the page itself (leaving, coming back) are our own tween with Lenis stopped: the inertia of the finger's own
// flick arrives after the touch ends and would take a Lenis glide over, so a weak first flick would carry the page only a
// little way. The scroll position is the stage's to hold while it has the page; a jump well outside the zone (an anchor, a
// link) is deliberate and lets it go.
//
// Only the mechanism lives here: the section supplies the pictures, the render and the scroll geometry (WorkStageHost).

import ScrollTrigger from 'gsap/ScrollTrigger';

export interface WorkStageHost {
	n: number;                              // number of pictures
	lenis: any;                             // the page's Lenis
	trigger: ScrollTrigger;                 // the pinned zone (start .. end)
	stop(k: number): number;                // scroll position where picture k rests (0 = the title)
	unit(): number;                         // one screen of scroll inside the zone
	setPos(p: number): void;                // move the light (and all that follows it) to p: 0 = title, k = picture k
	syncFromScroll(): void;                 // hand the light back to the scroll position
}

export interface WorkStage {
	goTo(k: number): void;                  // a key / button: go to picture k (only while the stage has the page)
	holding(): boolean;                     // the stage (or its glide) owns the light: the scroll must not drive it
	destroy(): void;
}

const CFG = {
	// stepping the light
	stepBaseMs: 450,        // a step takes this + stepPerUnitMs * distance (a whole picture ~1.1 s, the rest of a drag quicker)
	stepPerUnitMs: 650,
	// the page's glides
	leaveMs: 950,
	leaveBelow: 0.7,        // screens past the zone the page glides to when it leaves downward ...
	leaveAbove: 0.8,        // ... and before it when it leaves upward
	assistMs: 900,
	assistReach: 0.9,       // screens below the zone from which a flick down is turned into a glide back in
	assistMin: 40,          // px  a flick down shorter than this is no flick
	assistPast: 0.06,       // screens: the glide ends a little inside the catch line, or it never crosses it
	glideFailsafeMs: 1800,
	// where the stage takes the page
	catchAbove: 0.12,       // coming down: this much (screens) before the title's rest
	catchBelow: 0.02,       // coming up: this much before the end of the zone
	releaseOutside: 0.3,    // a jump this far (screens) outside the zone lets the stage go
	// input
	dragSpan: 0.9,          // light = start - dy / (height * dragSpan)
	edgeResist: 0.25,       // a drag beyond the ends
	commitDist: 0.05,       // share of the height that commits a drag to the next picture ...
	commitSpeed: 0.25,      // ... or this speed (px / ms, over the last speedWindowMs)
	speedWindowMs: 120,
	flickMin: 0.2,          // px / ms: above this the flick's own direction counts, else where the finger ended up
	captureAfter: 6,        // px  a drag on a button / link captures the pointer only after this
	tap: 2,                 // px  less than this is a tap
	clickBlock: 8,          // px  a drag longer than this blocks the click that follows ...
	clickBlockMs: 350,      // ms  ... for this long
	wheelMin: 8,            // smallest wheel delta that counts as a gesture (an iPad with a trackpad)
	wheelCooldownMs: 700,   // ms  one wheel gesture = one step; a trackpad's inertia tail extends this
};

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const inOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const outCubic = (t: number) => 1 - (1 - t) ** 3;

export function createWorkStage(host: WorkStageHost): WorkStage {
	const { n, lenis, trigger, stop, unit, setPos, syncFromScroll } = host;
	const root = document.documentElement;
	const vh = () => window.innerHeight;
	const menuOpen = () => document.body.classList.contains('oxygen-menu-open');

	let P = 0;                          // the light's position, 0 .. n
	let idx = 0;                        // the picture the stage is at, or going to
	let on = false;                     // the stage holds the page
	let gliding = false;                // the page is gliding out of (or back into) the zone
	let weStopped = false;              // we stopped Lenis and must start it again
	let lockY = 0;                      // the scroll position held while the stage has the page
	let lastY = window.scrollY;
	let lastWheel = 0;
	let drag: any = null;
	let touch: { id: number; y: number; y0: number } | null = null;   // the finger that is down, tracked all the time
	let suppressClick = false;
	let tweenRaf = 0, glideRaf = 0, glideTimer = 0;

	// ── holding the page ──
	const holdLenis = () => { if (!lenis.isStopped) { lenis.stop(); weStopped = true; } };
	const releaseLenis = () => { if (weStopped) { lenis.start(); weStopped = false; } };
	const lock = (yes: boolean) => {
		for (const el of [root.style, document.body.style] as any[]) {
			el.touchAction = yes ? 'none' : '';
			el.overscrollBehavior = yes ? 'none' : '';
			el.userSelect = yes ? 'none' : '';
			el.webkitUserSelect = yes ? 'none' : '';
			el.webkitTouchCallout = yes ? 'none' : '';
		}
	};
	const grab = () => { on = true; lock(true); holdLenis(); };
	const letGo = () => { on = false; lock(false); releaseLenis(); };
	const jumpTo = (y: number) => lenis.scrollTo(y, { immediate: true, force: true });

	// ── the light ──
	const show = (v: number) => { P = v; setPos(v); };
	const tweenTo = (target: number) => {
		cancelAnimationFrame(tweenRaf);
		const from = P, t0 = performance.now();
		if (from === target) { tweenRaf = 0; return; }
		const ms = CFG.stepBaseMs + CFG.stepPerUnitMs * Math.min(1, Math.abs(target - from));
		const tick = (now: number) => {
			const t = Math.min(1, (now - t0) / ms);
			show(from + (target - from) * inOutSine(t));
			tweenRaf = t < 1 ? requestAnimationFrame(tick) : 0;
		};
		tweenRaf = requestAnimationFrame(tick);
	};
	const stopTween = () => { cancelAnimationFrame(tweenRaf); tweenRaf = 0; };

	// ── the page's glides ──
	const stopGlide = () => { cancelAnimationFrame(glideRaf); glideRaf = 0; };
	// out-cubic: sets off at full speed like a flick, then brakes. Lenis is held for the glide and started again at its end.
	const glideScroll = (target: number, ms: number, done?: () => void) => {
		stopGlide();
		const from = window.scrollY, t0 = performance.now();
		holdLenis();
		const tick = (now: number) => {
			if (on) { glideRaf = 0; return; }   // the stage took the page meanwhile
			const t = Math.min(1, (now - t0) / ms);
			jumpTo(from + (target - from) * outCubic(t));
			if (t < 1) { glideRaf = requestAnimationFrame(tick); return; }
			glideRaf = 0; releaseLenis(); done?.();
		};
		glideRaf = requestAnimationFrame(tick);
	};
	const endGlide = () => {
		clearTimeout(glideTimer);
		gliding = false;
		lastY = window.scrollY;
		syncFromScroll();
	};

	// ── taking and handing over the page ──
	// the stage takes the page at picture k; jumpY: where to put the scroll (undefined = where it is)
	const engage = (k: number, jumpY?: number) => {
		if (on) return;
		stopTween();
		grab();
		if (jumpY !== undefined) jumpTo(jumpY);
		lockY = jumpY !== undefined ? jumpY : window.scrollY;
		lastY = lockY;
		idx = k;
		show(k);
	};
	// 1 = on past the last picture to the panel, -1 = back up past the title
	const leave = (dir: 1 | -1) => {
		stopTween();
		on = false; lock(false);            // the stage lets go; Lenis stays stopped, the glide owns it until it ends
		gliding = true;
		glideTimer = window.setTimeout(endGlide, CFG.glideFailsafeMs);
		// The page was held at the title's rest while the pictures changed, and the stage stands still over the whole zone: move
		// the scroll to the edge of it at once (nothing on screen changes), so the glide starts moving the page immediately.
		jumpTo(dir > 0 ? trigger.end - 1 : trigger.start + 1);
		const target = dir > 0 ? trigger.end + CFG.leaveBelow * vh() : Math.max(0, trigger.start - CFG.leaveAbove * vh());
		glideScroll(target, CFG.leaveMs, endGlide);
	};
	// One flick down from the panel is enough: the page itself would only move part of the way (the panel is long), so the
	// flick becomes a glide to the last picture; the stage takes the page when the glide crosses its catch line (onScroll).
	const assistBack = () => {
		const edge = trigger.end, y = window.scrollY;
		if (on || y <= edge - CFG.catchBelow * unit() || y > edge + CFG.assistReach * vh()) return;
		requestAnimationFrame(() => {
			if (on) return;
			gliding = false;
			glideScroll(edge - CFG.assistPast * unit(), CFG.assistMs);
		});
	};

	const stepBy = (dir: number) => {
		const k = idx + dir;
		if (k > n) { if (idx === n) leave(1); return; }
		if (k < 0) { if (idx === 0) leave(-1); return; }
		idx = k;
		tweenTo(k);
	};

	// ── input ──
	const free = () => on && !menuOpen();
	const capture = (e: PointerEvent) => { drag.cap = true; try { root.setPointerCapture(e.pointerId); } catch (_) {} };

	// the finger that is down (always); a finger down during a glide takes the page over at once, so the stage can catch it again
	const trackDown = (e: PointerEvent) => {
		touch = e.pointerType === 'mouse' ? null : { id: e.pointerId, y: e.clientY, y0: e.clientY };
		if (touch && (gliding || glideRaf)) { stopGlide(); releaseLenis(); endGlide(); }
	};
	const trackMove = (e: PointerEvent) => { if (touch && e.pointerId === touch.id) touch.y = e.clientY; };
	const trackUp = (e: PointerEvent) => {
		if (!touch || e.pointerId !== touch.id) return;
		const t = touch; touch = null;
		const endY = e.type === 'pointercancel' ? t.y : e.clientY;   // a cancelled pointer reports y = 0
		if (!on && endY - t.y0 > CFG.assistMin) assistBack();
	};

	const onDown = (e: PointerEvent) => {
		if (!free() || e.pointerType === 'mouse') return;
		stopTween();
		const now = performance.now();
		drag = { y: e.clientY, ly: e.clientY, id: e.pointerId, moved: 0, p0: P, cap: false, hist: [[now, e.clientY]] };
		if (!(e.target as HTMLElement).closest('button,a')) capture(e);   // taps on the name / Explore must still click
	};
	const onMove = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		drag.ly = e.clientY;
		const now = performance.now();
		drag.hist.push([now, e.clientY]);   // the last moments only: the speed of the flick at its END, not averaged over the touch
		while (drag.hist.length > 2 && now - drag.hist[0][0] > CFG.speedWindowMs) drag.hist.shift();
		const d = e.clientY - drag.y;
		drag.moved = Math.max(drag.moved, Math.abs(d));
		if (!drag.cap && drag.moved > CFG.captureAfter) capture(e);
		let q = drag.p0 - d / (vh() * CFG.dragSpan);
		if (q < 0) q *= CFG.edgeResist; else if (q > n) q = n + (q - n) * CFG.edgeResist;
		show(q);   // the light follows the finger; on release it settles on a picture
	};
	const onUp = (e: PointerEvent) => {
		if (!drag || e.pointerId !== drag.id) return;
		const y = e.type === 'pointercancel' ? drag.ly : e.clientY;
		const d = y - drag.y;
		const h0 = drag.hist[0];
		const v = h0 ? (y - h0[1]) / Math.max(1, performance.now() - h0[0]) : 0;   // recent speed, px / ms
		const dir = (Math.abs(v) > CFG.flickMin ? v : d) < 0 ? 1 : -1;
		const moved = drag.moved;
		drag = null;
		try { root.releasePointerCapture(e.pointerId); } catch (_) {}
		if (moved > CFG.clickBlock) { suppressClick = true; setTimeout(() => (suppressClick = false), CFG.clickBlockMs); }
		if (moved <= CFG.tap) { if (Math.abs(P - idx) > 0.001) tweenTo(idx); return; }   // a tap: carry on to where it was going
		if (Math.abs(d) > vh() * CFG.commitDist || Math.abs(v) > CFG.commitSpeed) { stepBy(dir); return; }
		idx = clamp(Math.round(P), 0, n);   // a touch too light: settle back on the nearest picture
		tweenTo(idx);
	};
	const onClick = (e: MouseEvent) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } };
	// a wheel / trackpad on a touch-class device (an iPad with a trackpad)
	const onWheel = (e: WheelEvent) => {
		if (!free()) return;
		e.preventDefault();
		const now = performance.now(), since = now - lastWheel;
		lastWheel = now;   // inertia keeps extending the cooldown, so a trackpad's tail never makes a second step
		if (Math.abs(e.deltaY) < CFG.wheelMin || since < CFG.wheelCooldownMs) return;
		stepBy(e.deltaY > 0 ? 1 : -1);
	};

	// ── the scroll position: when the stage takes the page, and what it does to a jump while it has it ──
	const onScroll = () => {
		const y = window.scrollY, u = unit();
		if (on) {
			if (Math.abs(y - lockY) > 1) {
				// A jump well outside the zone is deliberate (an anchor, a link, the status bar): the stage lets go and the page
				// goes where it was sent. Inside the zone it is the menu closing (it started Lenis again): the page is put back.
				if (y > trigger.end + CFG.releaseOutside * vh() || y < trigger.start - CFG.releaseOutside * vh()) {
					stopTween();
					letGo();
					lastY = y;
					syncFromScroll();
					return;
				}
				jumpTo(lockY);
			}
			lastY = y;
			return;
		}
		if (!gliding && !root.classList.contains('pt-restoring')) {
			const top = stop(0) - CFG.catchAbove * u, bottom = trigger.end - CFG.catchBelow * u;
			if (lastY < top && y >= top) engage(0, stop(0));                                          // coming down: the title's rest
			else if (lastY >= bottom && y < bottom) engage(n, y < stop(n) ? stop(n) : undefined);    // coming back up: the last picture
		}
		lastY = y;
	};
	const onRefresh = () => { if (on) lockY = clamp(lockY, stop(0), trigger.end - 1); };

	// ── lifecycle ──
	document.addEventListener('pointerdown', trackDown, true);
	document.addEventListener('pointermove', trackMove, true);
	document.addEventListener('pointerup', trackUp, true);
	document.addEventListener('pointercancel', trackUp, true);
	document.addEventListener('pointerdown', onDown);
	document.addEventListener('pointermove', onMove);
	document.addEventListener('pointerup', onUp);
	document.addEventListener('pointercancel', onUp);
	document.addEventListener('click', onClick, true);
	addEventListener('wheel', onWheel, { passive: false });
	addEventListener('scroll', onScroll, { passive: true });
	ScrollTrigger.addEventListener('refresh', onRefresh);

	// a page that opens already inside the zone (a restored scroll): the stage takes it at the nearest picture
	{
		const y = window.scrollY, u = unit();
		if (y >= stop(0) - CFG.catchAbove * u && y < trigger.end - CFG.catchBelow * u) {
			let k = 0;
			for (let i = 1; i <= n; i++) if (Math.abs(stop(i) - y) < Math.abs(stop(k) - y)) k = i;
			engage(k, stop(k));
		}
	}

	return {
		goTo(k) { if (on) { idx = clamp(k, 0, n); tweenTo(idx); } },
		holding: () => on || gliding,
		destroy() {
			stopTween(); stopGlide();
			clearTimeout(glideTimer);
			document.removeEventListener('pointerdown', trackDown, true);
			document.removeEventListener('pointermove', trackMove, true);
			document.removeEventListener('pointerup', trackUp, true);
			document.removeEventListener('pointercancel', trackUp, true);
			document.removeEventListener('pointerdown', onDown);
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
			document.removeEventListener('pointercancel', onUp);
			document.removeEventListener('click', onClick, true);
			removeEventListener('wheel', onWheel);
			removeEventListener('scroll', onScroll);
			ScrollTrigger.removeEventListener('refresh', onRefresh);
			if (on) letGo(); else releaseLenis();
			on = false; gliding = false;
		},
	};
}
