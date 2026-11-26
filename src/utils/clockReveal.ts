import gsap from 'gsap';

// Scroll only FIRES the reveal; it never scrubs it. Each element is either shown (sharp) or hidden (in blur),
// flips when its centre crosses a line on the screen, and the change plays on the clock (same length however
// fast you scroll), in and out alike. So the page is never stopped half-way in a mush of blur.
// Fast scroll: tweens get shorter, and elements that flip while off-screen jump straight to their end state.

export interface ClockItemsOptions {
	/** Centre of the element, as a share of the viewport height, at which it comes in from below (e.g. 0.82). */
	inAt: number;
	/** ...and at which it goes out at the top (e.g. 0.18). */
	outAt: number;
	/** Blur radius in px in the hidden state. */
	blur: number;
	/** Rise in px when coming in (and lift when going out, 2/3 of it). */
	rise?: number;
	/** Seconds on the clock for one change. */
	dur?: number;
	/** Extra scroll distance (share of vh) before it flips back, so it can't flicker on the line. */
	hysteresis?: number;
}

type State = 'below' | 'shown' | 'above';

export function clockScrollItems(els: HTMLElement[], o: ClockItemsOptions): () => void {
	const rise = o.rise ?? 14;
	const dur = o.dur ?? 0.8;
	const hys = o.hysteresis ?? 0.04;
	const state = new Map<HTMLElement, State>();

	const hiddenVars = (s: State) => ({
		opacity: 0,
		filter: `blur(${o.blur}px)`,
		y: s === 'below' ? rise : -rise * 0.66,
	});
	const apply = (el: HTMLElement, s: State, instant: boolean, d: number) => {
		el.dataset.scrub = '1';
		el.style.pointerEvents = s === 'shown' ? '' : 'none';
		if (s === 'shown') {
			if (instant) gsap.set(el, { opacity: 1, y: 0, clearProps: 'filter' });
			else gsap.to(el, { opacity: 1, y: 0, filter: 'blur(0px)', duration: d, ease: 'power3.out', overwrite: 'auto', onComplete: () => { gsap.set(el, { clearProps: 'filter' }); } });
		} else if (instant) {
			gsap.set(el, hiddenVars(s));
		} else {
			gsap.to(el, { ...hiddenVars(s), duration: d * 0.85, ease: 'power2.inOut', overwrite: 'auto' });
		}
	};

	let lastY = window.scrollY, lastT = performance.now(), speed = 0; // px per ms
	const place = (first = false) => {
		const vh = window.innerHeight;
		const d = speed > 3 ? dur * 0.45 : speed > 1.5 ? dur * 0.7 : dur;
		els.forEach((el) => {
			const r = el.getBoundingClientRect();
			const c = (r.top + r.height / 2) / vh;
			const prev = state.get(el);
			let next: State;
			if (prev === 'shown') next = c > o.inAt + hys ? 'below' : c < o.outAt - hys ? 'above' : 'shown';
			else next = c > o.inAt ? 'below' : c < o.outAt ? 'above' : 'shown';
			if (next === prev) return;
			state.set(el, next);
			const offscreen = r.bottom < -vh * 0.2 || r.top > vh * 1.2;
			apply(el, next, first || offscreen, d);
		});
	};

	let ticking = false;
	const onScroll = () => {
		const now = performance.now();
		speed = Math.abs(window.scrollY - lastY) / Math.max(1, now - lastT);
		lastY = window.scrollY; lastT = now;
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => { ticking = false; place(); });
	};
	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', onScroll, { passive: true });
	place(true);

	return () => {
		window.removeEventListener('scroll', onScroll);
		window.removeEventListener('resize', onScroll);
		els.forEach((el) => {
			gsap.killTweensOf(el);
			delete el.dataset.scrub;
			['opacity', 'filter', 'transform', 'pointer-events'].forEach((k) => el.style.removeProperty(k));
		});
	};
}
