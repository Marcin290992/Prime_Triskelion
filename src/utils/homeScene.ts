// Steps: one gesture (a wheel flick, a swipe, a key) is one step, and every step is a movement on the CLOCK, not something
// the finger scrubs. The page is carried from one resting place (a "stop") to the next by a timed scroll (Lenis scrollTo);
// the sections' own scroll-driven animations (the hero's exit, the manifesto's fill, the pictures' beam, ...) play along it.
//
// A scene is made of ZONES. In a zone the user's own scrolling is taken over (wheel, touch and keys are turned into
// steps), so a hard fling can never skip anything or rush through it; outside a zone the page scrolls as usual. Past the
// last stop of a zone one more gesture hands the page back to the plain scroll (and a gesture the other way from the
// first stop of a zone with room above it does the same), and in the other direction a gesture takes the zone back.
//
//   home page, phones and tablets: one zone: hero, manifesto, services, the Selected work title, the pictures
//   home page, desktop: two zones: the hero (the manifesto and the services are then the user's own scroll), and the
//                       Selected work (its title and the pictures)
//   /projects, everywhere: one zone: the hero and every project
//
// The resting places are asked of the sections themselves (window.__manifestoST / __manifestoHold from the manifesto,
// window.__swStops from Selected work), so they follow the layout.
//
// ?scene=off in the address turns the steps off (the plain scroll), for comparing.

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const inOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export interface Zone {
	stops: number[];   // the resting places, px of scroll, ascending
	start: number;     // the zone takes the scrolling over from here ...
	end: number;       // ... to here
}
interface Cfg {
	zones: () => Zone[] | null;
	seconds: (zone: Zone, from: number, to: number) => number;   // the time of a step (indexes into zone.stops)
}

export function sceneEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
	return new URLSearchParams(window.location.search).get('scene') !== 'off';
}

function createScene(cfg: Cfg): (() => void) | null {
	if (!sceneEnabled()) return null;

	const root = document.documentElement;
	const vh = () => window.innerHeight;
	let lenis: any = null;
	let weStopped = false;
	let dead = false;
	let moving = false;      // a timed step is running
	let target: number | null = null;   // ... and where it is going: the next gesture counts on from there, not from where the page is now
	let lastStep = 0;
	let moveTimer = 0;
	let lastWheel = 0;      // when the last wheel event came ...
	let lastAbs = 0;        // ... and how strong it was
	let lastKey = 0;
	let raf = 0;
	let tries = 0;

	const zoneAt = (zs: Zone[], y: number) => zs.find((z) => y >= z.start - 3 && y <= z.end + 3) ?? null;
	const nextStop = (z: Zone, y: number) => z.stops.find((s) => s > y + 3) ?? null;
	const prevStop = (z: Zone, y: number) => { let r: number | null = null; for (const s of z.stops) if (s < y - 3) r = s; return r; };
	const nearestIdx = (z: Zone, y: number) => { let b = 0; for (let k = 1; k < z.stops.length; k++) if (Math.abs(z.stops[k] - y) < Math.abs(z.stops[b] - y)) b = k; return b; };

	const holding = () => weStopped || root.classList.contains('scene-on');
	const grab = () => {
		if (!lenis) return;
		if (!lenis.isStopped) { lenis.stop(); weStopped = true; }
		root.classList.add('scene-on');
	};
	const letGo = () => {
		root.classList.remove('scene-on');
		if (lenis && weStopped) { lenis.start(); weStopped = false; }
	};

	// a timed movement of the page to y. A step that takes over a running one starts quickly (out-cubic, no stand-still at its
	// start), so a fast succession of gestures runs on without a stall between the steps.
	const outCubic = (t: number) => 1 - (1 - t) ** 3;
	const moveTo = (y: number, seconds: number) => {
		if (!lenis) return;
		const quick = moving;
		moving = true;
		target = y;
		lastStep = performance.now();
		window.clearTimeout(moveTimer);
		lenis.scrollTo(y, {
			duration: quick ? Math.min(seconds, 1.0) : seconds,
			easing: quick ? outCubic : inOutSine,
			force: true,
			lock: false,
			onComplete: () => { moving = false; target = null; },
		});
		// never stay marked as moving (an interrupted movement does not report its end)
		moveTimer = window.setTimeout(() => { moving = false; target = null; }, seconds * 1000 + 300);
	};
	// where the next gesture counts on from: the end of the running step, or where the page stands
	const base = () => (moving && target != null ? target : window.scrollY);
	const step = (z: Zone, y: number, to: number) => moveTo(to, cfg.seconds(z, nearestIdx(z, y), z.stops.indexOf(to)));

	// what a gesture in this direction does here: a step to a stop, or the end of the zone (the plain scroll takes over)
	type Verdict = { kind: 'step'; to: number } | { kind: 'release' } | { kind: 'wall' };
	const verdict = (z: Zone, dir: number, y: number): Verdict => {
		const to = dir > 0 ? nextStop(z, y) : prevStop(z, y);
		if (to != null) return { kind: 'step', to };
		// the top of the page is a wall; any other end of a zone lets the page go
		if (dir < 0 && z.start <= 3 && y <= z.stops[0] + 3) return { kind: 'wall' };
		return { kind: 'release' };
	};

	// ── wheel ──
	// A gesture is never made to wait for the step before it: a new one while a step runs takes the next stop on from the
	// step's end, and the page runs on to it. What is held back is only the tail of a flick (a trackpad keeps sending small
	// deltas for a second after the finger has gone) and a second step within a moment of the first.
	const onWheel = (e: WheelEvent) => {
		if (dead || !lenis || e.ctrlKey) return;
		const zs = cfg.zones();
		if (!zs) return;
		if (lenis.isStopped && !weStopped) return;   // the menu has the page
		const now = performance.now();
		// a NEW push, not the fading tail of the last one: after a pause, or clearly stronger than the event before it (the
		// deltas of a trackpad's tail only get smaller)
		const abs = Math.abs(e.deltaY);
		const push = now - lastWheel > 90 || abs > lastAbs * 1.3;
		lastWheel = now;
		lastAbs = abs;
		const y = base();
		const z = zoneAt(zs, y);
		if (!z) { if (holding() && !moving) letGo(); return; }
		const v = verdict(z, e.deltaY > 0 ? 1 : -1, y);
		if (v.kind === 'release') {
			if (moving) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // the step is still on its way to the end
			if (holding()) letGo();
			return;
		}
		grab();
		e.preventDefault();
		e.stopImmediatePropagation();
		if (v.kind !== 'step') return;
		// a step is taken on a clear flick: (a) at rest any real delta; (b) while one runs, a strong one at least 260 ms after
		// the last step began (so a spin of the wheel runs through the stops, and a trackpad's fading tail does not)
		const strong = abs >= (moving ? 40 : 8);
		if (!push || !strong || now - lastStep < (moving ? 260 : 120)) return;
		step(z, window.scrollY, v.to);
	};

	// ── keys ──
	const onKey = (e: KeyboardEvent) => {
		if (dead || !lenis || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)) return;
		const down = ['ArrowDown', 'PageDown', ' '].includes(e.key);
		const up = ['ArrowUp', 'PageUp'].includes(e.key);
		if (!down && !up) return;
		const zs = cfg.zones();
		if (!zs) return;
		if (lenis.isStopped && !weStopped) return;
		const y = base();
		const z = zoneAt(zs, y);
		if (!z) return;
		const v = verdict(z, down ? 1 : -1, y);
		if (v.kind === 'release') { if (moving) { e.preventDefault(); e.stopImmediatePropagation(); return; } if (holding()) letGo(); return; }
		grab();
		e.preventDefault();
		e.stopImmediatePropagation();
		const now = performance.now();
		if (v.kind === 'step' && now - lastKey >= 200) { lastKey = now; step(z, window.scrollY, v.to); }
	};

	// ── touch: the page follows the finger a little (a peek at the next stop), and a swipe or a short flick takes the step ──
	let drag: { y0: number; t0: number; y: number; moved: number; z: Zone; base: number } | null = null;
	const onTouchStart = (e: TouchEvent) => {
		if (dead || !lenis || e.touches.length !== 1) { drag = null; return; }
		const zs = cfg.zones();
		if (!zs) { drag = null; return; }
		if (lenis.isStopped && !weStopped) { drag = null; return; }
		const z = zoneAt(zs, base());
		if (!z) { if (holding() && !moving) letGo(); drag = null; return; }
		grab();
		// a finger on the page while a step runs does not stop it: the swipe counts on from where that step is going
		const t = e.touches[0];
		drag = { y0: t.clientY, t0: performance.now(), y: t.clientY, moved: 0, z, base: base() };
	};
	const onTouchMove = (e: TouchEvent) => {
		if (!drag) return;
		const t = e.touches[0];
		drag.y = t.clientY;
		const d = t.clientY - drag.y0;
		drag.moved = Math.max(drag.moved, Math.abs(d));
		if (drag.moved > 6) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); }
		const dir = d < 0 ? 1 : -1;                  // a finger moving up takes the next step
		const v = verdict(drag.z, dir, drag.base);
		if (v.kind !== 'step') return;               // the end of the zone: only a release, on touchend
		if (moving) return;                          // a step is running: no peek, the swipe is only counted on touchend
		const p = clamp(Math.abs(d) / (vh() * 0.9), 0, 1);
		lenis.scrollTo(drag.base + (v.to - drag.base) * p, { immediate: true, force: true });
	};
	const onTouchEnd = () => {
		if (!drag) return;
		const g = drag;
		drag = null;
		if (g.moved < 6) return;   // a tap: nothing to do
		const d = g.y - g.y0;
		const dt = Math.max(1, performance.now() - g.t0);
		const v = d / dt;
		const commit = Math.abs(d) > vh() * 0.1 || Math.abs(v) > 0.4;
		const dir = d < 0 ? 1 : -1;
		const ver = verdict(g.z, dir, g.base);
		if (ver.kind === 'wall') return;
		if (ver.kind === 'release') {
			if (moving) return;   // the step is still on its way to the end
			// the end of the zone: the page is let go, with a nudge in the direction of the swipe to start it
			if (commit) { letGo(); moveTo(window.scrollY + dir * vh() * 0.5, 0.9); }
			return;
		}
		if (!commit) { if (!moving) moveTo(g.base, 0.6); return; }
		step(g.z, window.scrollY, ver.to);
	};

	// ── the first moments: the lenis appears a frame after the page, the sections after it ──
	const attach = () => {
		if (dead) return;
		lenis = (window as any).__lenis;
		const zs = lenis ? cfg.zones() : null;
		if (lenis && zs) {
			if (zoneAt(zs, window.scrollY)) grab();
			return;
		}
		if (++tries < 400) raf = requestAnimationFrame(attach);
	};
	attach();

	window.addEventListener('wheel', onWheel, { passive: false, capture: true });
	window.addEventListener('keydown', onKey, { capture: true });
	window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
	window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
	window.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
	window.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });

	return () => {
		dead = true;
		cancelAnimationFrame(raf);
		window.clearTimeout(moveTimer);
		window.removeEventListener('wheel', onWheel, { capture: true } as any);
		window.removeEventListener('keydown', onKey, { capture: true } as any);
		window.removeEventListener('touchstart', onTouchStart, { capture: true } as any);
		window.removeEventListener('touchmove', onTouchMove, { capture: true } as any);
		window.removeEventListener('touchend', onTouchEnd, { capture: true } as any);
		window.removeEventListener('touchcancel', onTouchEnd, { capture: true } as any);
		root.classList.remove('scene-on');
		if (lenis && weStopped) lenis.start();
	};
}

const isCoarse = () => window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches;
const ascending = (list: number[]) => list.every((v, i) => i === 0 || v > list[i - 1] + 8);

// ── the home page ──
export function initHomeScene(): (() => void) | null {
	const vh = () => window.innerHeight;
	const zones = (): Zone[] | null => {
		const man = document.getElementById('manifesto');
		const svc = document.querySelector<HTMLElement>('#services .svc__list');
		const st = (window as any).__manifestoST;
		const hold = (window as any).__manifestoHold;
		const sw = (window as any).__swStops;
		if (!man || !svc || !st || typeof hold !== 'number' || !sw) return null;
		const pics: number[] = sw.stops();
		if (!pics.length || !ascending(pics)) return null;
		if (isCoarse()) {
			// phones and tablets: hero, manifesto (whole and red), services, then the title and the pictures: one zone
			const y1 = st.start + hold * (st.end - st.start);
			const r = svc.getBoundingClientRect();
			const y2 = r.top + window.scrollY + r.height / 2 - vh() / 2;
			const list = [0, y1, y2, ...pics];
			return ascending(list) ? [{ stops: list, start: 0, end: list[list.length - 1] }] : null;
		}
		// desktop: the hero (up to where the manifesto begins to fill), and the pictures; the manifesto and the services between
		// are the user's own scroll
		const a = [0, st.start];
		if (!ascending(a) || !(pics[0] > st.start + 8)) return null;
		return [
			{ stops: a, start: 0, end: st.start },
			{ stops: pics, start: pics[0] - 0.6 * vh(), end: pics[pics.length - 1] },
		];
	};
	return createScene({
		zones,
		seconds: (z, i, j) => {
			const to = z.stops[j], from = z.stops[i];
			if (from === 0 && j === 1) return isCoarse() ? 3.2 : 2.2;      // the hero goes out (and the manifesto fills)
			if (to === 0 && i === 1) return isCoarse() ? 1.9 : 1.5;
			return 1.15 + Math.min(1.1, (Math.abs(to - from) / vh()) * 0.7);
		},
	});
}

// ── /projects: the hero and every project (getStops gives the scroll position of each project's name in the middle) ──
export function initProjectsScene(getStops: () => number[]): (() => void) | null {
	const vh = () => window.innerHeight;
	return createScene({
		zones: () => {
			const rows = getStops();
			const list = [0, ...rows];
			if (!rows.length || !ascending(list)) return null;
			return [{ stops: list, start: 0, end: list[list.length - 1] }];
		},
		seconds: (z, i, j) => {
			const to = z.stops[j], from = z.stops[i];
			if (from === 0 && j === 1) return 2.8;                      // the header goes out, the first beam crosses
			if (to === 0 && i === 1) return 1.8;
			return 1.3 + Math.min(0.9, (Math.abs(to - from) / vh()) * 0.6);
		},
	});
}
