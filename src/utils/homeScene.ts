// The home page's opening as a scene of steps, the same on phones, tablets and desktops:
//
//   0 hero  ->  1 the manifesto (comes up out of the dark and fills itself, the two words turn red)  ->  2 the services
//   ->  3 the "Selected work" title
//
// One gesture (a wheel flick, a swipe, a key) is one step, and every step is a movement on the CLOCK, not something the
// finger scrubs: the page is carried from one resting place to the next by a timed scroll (Lenis scrollTo), and the
// sections' own scroll-driven animations (the hero's exit, the manifesto's fill, the services, the title) play along it.
// While the scene is on, the user's own scrolling is taken over (wheel, touch and keys are turned into steps), so a
// hard fling can never skip anything or rush through it. After the last step one more gesture down hands the page to
// the pictures (the Selected work's own mechanism); one up, from the first picture's title, takes the scene back.
//
// The resting places are asked of the sections themselves (window.__manifestoST / __manifestoHold from the manifesto,
// window.__swStops from Selected work), so they follow the layout.
//
// ?scene=off in the address turns the scene off (the plain scroll), for comparing.

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const inOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export function initHomeScene(): (() => void) | null {
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
	if (new URLSearchParams(window.location.search).get('scene') === 'off') return null;

	const root = document.documentElement;
	const vh = () => window.innerHeight;
	let lenis: any = null;
	let weStopped = false;
	let dead = false;
	let moving = false;      // a timed step is running
	let moveTimer = 0;
	let idx = 0;
	let lastWheel = 0;
	let lastKey = 0;

	// the resting places (px of scroll), or null while the sections are not ready
	const stops = (): number[] | null => {
		const man = document.getElementById('manifesto');
		const svc = document.querySelector<HTMLElement>('#services .svc__list');
		const st = (window as any).__manifestoST;
		const hold = (window as any).__manifestoHold;
		const sw = (window as any).__swStops;
		if (!man || !svc || !st || typeof hold !== 'number' || !sw) return null;
		const y1 = st.start + hold * (st.end - st.start);
		const r = svc.getBoundingClientRect();
		const y2 = r.top + window.scrollY + r.height / 2 - vh() / 2;
		const y3 = sw.s0();
		const list = [0, y1, y2, y3];
		for (let i = 1; i < list.length; i++) if (!(list[i] > list[i - 1] + 8)) return null;
		return list;
	};
	const firstPicture = (): number | null => {
		const sw = (window as any).__swStops;
		return sw ? sw.s1() : null;
	};
	const nearest = (list: number[], y: number) => {
		let b = 0;
		for (let k = 1; k < list.length; k++) if (Math.abs(list[k] - y) < Math.abs(list[b] - y)) b = k;
		return b;
	};

	const grab = () => {
		if (!lenis) return;
		if (!lenis.isStopped) { lenis.stop(); weStopped = true; }
		root.classList.add('scene-on');
	};
	const let_go = () => {
		root.classList.remove('scene-on');
		if (lenis && weStopped) { lenis.start(); weStopped = false; }
	};

	// a timed movement of the page to y
	const moveTo = (y: number, seconds: number, after?: () => void) => {
		if (!lenis) return;
		moving = true;
		window.clearTimeout(moveTimer);
		lenis.scrollTo(y, {
			duration: seconds,
			easing: inOutSine,
			force: true,
			lock: false,
			onComplete: () => { moving = false; after?.(); },
		});
		// never stay marked as moving (an interrupted movement does not report its end)
		moveTimer = window.setTimeout(() => { moving = false; }, seconds * 1000 + 300);
	};

	// the time of a step: the first one is long (the manifesto comes up and fills on it), the others are one soft movement
	const seconds = (from: number, to: number, list: number[]) => {
		if (from === 0 && to === 1) return 3.2;
		if (from === 1 && to === 0) return 1.9;
		return 1.15 + Math.min(1.1, (Math.abs(list[to] - list[from]) / vh()) * 0.7);
	};

	const stepTo = (n: number, list: number[]) => {
		n = clamp(n, 0, list.length - 1);
		const from = idx;
		idx = n;
		moveTo(list[n], seconds(from, n, list));
	};

	// the page is handed to the pictures: one timed step to the first one, then the pictures' own mechanism
	const release = () => {
		const y = firstPicture();
		let_go();
		if (y != null && lenis) moveTo(y, 1.7);
	};

	const inScene = (list: number[], y: number) => y < list[list.length - 1] - 3;
	const atEnd = (list: number[], y: number) => Math.abs(y - list[list.length - 1]) <= 3;

	// ── wheel ──
	const onWheel = (e: WheelEvent) => {
		if (dead || !lenis || e.ctrlKey) return;
		const list = stops();
		if (!list) return;
		if (lenis.isStopped && !weStopped) return;   // the menu has the page
		const now = performance.now();
		const fresh = now - lastWheel > 140;       // a new flick, not the tail of the last one (a trackpad keeps sending)
		lastWheel = now;
		// the tail of a flick (a trackpad keeps sending for a second) must not touch a step that is running: Lenis would take
		// the wheel as the user's own scroll and cut the timed movement short
		if (moving && !fresh) { e.preventDefault(); e.stopImmediatePropagation(); return; }
		const y = window.scrollY;
		const dir = e.deltaY > 0 ? 1 : -1;
		if (inScene(list, y)) {
			grab();
			e.preventDefault();
			e.stopImmediatePropagation();
			if (!fresh || Math.abs(e.deltaY) < 8) return;
			if (!moving) idx = nearest(list, y);
			stepTo(idx + dir, list);
			return;
		}
		if (atEnd(list, y)) {
			if (dir < 0) {          // back into the scene
				grab();
				e.preventDefault();
				e.stopImmediatePropagation();
				if (!fresh) return;
				idx = list.length - 1;
				stepTo(idx - 1, list);
			} else {                // on to the pictures (one step to the first one)
				e.preventDefault();
				e.stopImmediatePropagation();
				if (fresh && !moving) release();
			}
			return;
		}
		// below: the pictures and the rest of the page, as they are
		if (weStopped || root.classList.contains('scene-on')) let_go();
	};

	// ── keys ──
	const onKey = (e: KeyboardEvent) => {
		if (dead || !lenis || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)) return;
		const down = ['ArrowDown', 'PageDown', ' '].includes(e.key);
		const up = ['ArrowUp', 'PageUp'].includes(e.key);
		if (!down && !up) return;
		const list = stops();
		if (!list) return;
		const y = window.scrollY;
		const dir = down ? 1 : -1;
		const now = performance.now();
		if (inScene(list, y) || (atEnd(list, y) && dir < 0)) {
			grab();
			e.preventDefault();
			e.stopImmediatePropagation();
			if (now - lastKey < 250) return;
			lastKey = now;
			if (!moving) idx = nearest(list, y);
			if (atEnd(list, y)) idx = list.length - 1;
			stepTo(idx + dir, list);
		} else if (atEnd(list, y) && dir > 0) {
			e.preventDefault();
			if (!moving) release();
		}
	};

	// ── touch: the page follows the finger a little (a peek), and a swipe or a short flick takes the step ──
	let drag: { y0: number; t0: number; y: number; moved: number; from: number; list: number[]; base: number; mode: 'scene' | 'end' | 'free' } | null = null;
	const onTouchStart = (e: TouchEvent) => {
		if (dead || !lenis || e.touches.length !== 1) { drag = null; return; }
		const list = stops();
		if (!list) { drag = null; return; }
		if (lenis.isStopped && !weStopped) { drag = null; return; }
		const y = window.scrollY;
		let mode: 'scene' | 'end' | 'free' = 'free';
		if (inScene(list, y)) mode = 'scene';
		else if (atEnd(list, y)) mode = 'end';
		if (mode === 'free') { if (weStopped || root.classList.contains('scene-on')) let_go(); drag = null; return; }
		grab();
		if (!moving) idx = nearest(list, y);
		if (mode === 'end') idx = list.length - 1;
		const t = e.touches[0];
		drag = { y0: t.clientY, t0: performance.now(), y: t.clientY, moved: 0, from: idx, list, base: y, mode };
		// a finger on the page takes over a movement still running
		if (moving) { lenis.scrollTo(window.scrollY, { immediate: true, force: true }); moving = false; drag.base = window.scrollY; }
	};
	const onTouchMove = (e: TouchEvent) => {
		if (!drag) return;
		const t = e.touches[0];
		drag.y = t.clientY;
		const d = t.clientY - drag.y0;
		drag.moved = Math.max(drag.moved, Math.abs(d));
		if (drag.moved > 6) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); }
		const { list, from } = drag;
		const dir = d < 0 ? 1 : -1;                 // a finger moving up takes the next step
		const to = from + dir;
		if (drag.mode === 'end' && dir > 0) return; // at the end the downward drag is only a release (on touchend)
		if (to < 0 || to > list.length - 1) {
			// beyond the ends: a small resistance
			const y = list[from] + (-d) * 0.12;
			lenis.scrollTo(Math.max(0, y), { immediate: true, force: true });
			return;
		}
		const p = clamp(Math.abs(d) / (vh() * 0.9), 0, 1);
		const y = list[from] + (list[to] - list[from]) * p;
		lenis.scrollTo(y, { immediate: true, force: true });
	};
	const onTouchEnd = () => {
		if (!drag) return;
		const g = drag;
		drag = null;
		const d = g.y - g.y0;
		const dt = Math.max(1, performance.now() - g.t0);
		const v = d / dt;
		const commit = Math.abs(d) > vh() * 0.1 || Math.abs(v) > 0.4;
		const dir = d < 0 ? 1 : -1;
		const list = g.list;
		if (g.mode === 'end' && dir > 0) { if (commit) release(); return; }
		if (g.moved < 6) return;   // a tap: nothing to do
		if (!commit) { idx = g.from; moveTo(list[g.from], 0.6); return; }
		stepTo(g.from + dir, list);
	};

	// ── the first moments: the lenis appears a frame after the page, the sections after it ──
	let tries = 0;
	let raf = 0;
	const attach = () => {
		if (dead) return;
		lenis = (window as any).__lenis;
		const list = lenis ? stops() : null;
		if (lenis && list) {
			const y = window.scrollY;
			if (inScene(list, y)) { grab(); idx = nearest(list, y); }
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
