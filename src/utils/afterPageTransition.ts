import gsap from 'gsap';
// astro:page-load fires as soon as the new DOM is swapped in — before the
// page View Transition (quick fade-out, then the new page fading in, see
// Layout.astro) has played. Run entrance animations through this so they
// start as the new page begins to appear: shortly after the transition's
// animations kick off (`ready`), not once it has fully finished — waiting
// for `finished` left a noticeable pause of plain page before anything
// moved. The titles start at opacity 0, so the page's own short fade-in
// can't make them read as blurring in twice. Falls back to `finished` (or
// runs immediately) where `ready` isn't available, e.g. on a hard load.
//
// Imported by Layout.astro too, so the before-swap listener is registered
// on every page from the first load — a page script loaded only after
// navigating to it would otherwise miss the swap it needs to wait for.

// No extra wait after the transition is ready: after the menu the old page
// is plain black anyway (see vt-cut below), and any beat here just read as a
// black screen hanging before the title. Same on every device.
const START_AFTER_READY_MS = 0;

let pending: Promise<unknown> | null = null;

// Leaving through the menu: by the time navigate() runs the menu has
// already faded its content out over its black overlay, so the old page is
// plain black and cross-fading it into the new (black, title still hidden)
// page only adds dead time. html.vt-cut switches the root fades off
// (Layout.astro) and the title starts sharpening from the very first frame.
// Re-applied after the swap because Astro replaces <html>'s attributes.
let cutNext = false;
export function cutNextTransition(): void {
	cutNext = true;
	document.documentElement.classList.add('vt-cut');
}
let cutting = false;
document.addEventListener('astro:after-swap', () => {
	if (cutting) document.documentElement.classList.add('vt-cut');
});
document.addEventListener('astro:before-swap', (e) => {
	if (!cutNext) return;
	cutNext = false;
	cutting = true;
	// Keep the class until the transition is over (dropping it earlier would
	// re-apply the root fades mid-transition), then clear it.
	const done = e.viewTransition?.finished ?? Promise.resolve();
	done.catch(() => {}).then(() => {
		cutting = false;
		document.documentElement.classList.remove('vt-cut');
	});
});

document.addEventListener('astro:before-swap', (e) => {
	const vt = e.viewTransition;
	if (!vt) { pending = null; return; }
	const started = vt.ready
		? vt.ready.then(() => new Promise((r) => setTimeout(r, START_AFTER_READY_MS)))
		: vt.finished;
	// A skipped/aborted transition rejects — run the entrance anyway.
	pending = started.catch(() => {});
});

// ── Entrance mode, per page view ──
// 'full'  first time this page is seen in the session — the whole entrance;
// 'short' seen before in this session (or a reload) — one quick, light
//         focus pull, no choreography, so going round the site doesn't mean
//         sitting through the same intro again;
// 'none'  arrived with the browser's back/forward — straight to the finished
//         page, nobody expects an intro when returning to where they were.
// Decided once per page view, on the swap (or at load), before the page's
// own scripts ask for it.
export type EntranceMode = 'full' | 'short' | 'none';

// System "reduce motion" setting: every entrance becomes a plain, short
// fade — no blur, no scale, no sweeps. Read live, so toggling it applies
// from the next page view.
export function reducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const SEEN_KEY = 'pt-seen-pages';
const seenMem = new Set<string>();
function readSeen(): Set<string> {
	try {
		const raw = sessionStorage.getItem(SEEN_KEY);
		if (raw) (JSON.parse(raw) as string[]).forEach((p) => seenMem.add(p));
	} catch {}
	return seenMem;
}
function markSeen(path: string): void {
	seenMem.add(path);
	try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenMem])); } catch {}
}
const pathKey = () => location.pathname.replace(/\/$/, '') || '/';
function decide(traverse: boolean, reload = false): EntranceMode {
	const path = pathKey();
	const seen = readSeen().has(path);
	markSeen(path);
	if (traverse) return 'none';
	return seen || reload ? 'short' : 'full';
}
let mode: EntranceMode = (() => {
	const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
	return decide(nav?.type === 'back_forward', nav?.type === 'reload');
})();
let traverseNext = false;
document.addEventListener('astro:before-preparation', (e: any) => {
	traverseNext = e.navigationType === 'traverse';
});
document.addEventListener('astro:after-swap', () => {
	mode = decide(traverseNext);
	traverseNext = false;
});
export function entranceMode(): EntranceMode {
	return mode;
}

// Subpages (titles, leads, hints — everything but the home hero): the
// short entrance is the only one, first visit included, on every device —
// the full choreography read as too long there. Back/forward still 'none'.
// The home hero keeps all three (entranceMode).
export function subpageMode(): EntranceMode {
	return mode === 'full' ? 'short' : mode;
}

// Page-title entrance, shared by the subpage heroes (every device) — a
// camera focus pull rather than a pop: each word rises out of the black as
// a soft shape first (opacity, ~0.9s), focus lands after (blur, ~1.8s),
// and it settles from a hair oversized to 100% meanwhile. Gentle in/out
// curves throughout — power4.out did ~70% of the change in the first
// third of a second, so it read as a snap however long it ran. Words are
// 0.3s apart so the next one arrives as the previous one finds focus.
// Starts at once: the wait before it already felt long. The words start
// hidden (opacity 0, blur 18px) in each page's CSS.
export function titleIn(tl: gsap.core.Timeline, words: ArrayLike<Element>, at = 0, speed = 1): gsap.core.Timeline {
	if (!words.length) return tl;
	const mode = subpageMode();
	if (mode === 'none') { gsap.set(words, { opacity: 1, filter: 'none' }); return tl; }
	if (reducedMotion()) {
		gsap.set(words, { filter: 'none' });
		return tl.to(words, { opacity: 1, duration: 0.3, ease: 'none' }, 0);
	}
	if (mode === 'short') {
		// All words together, lighter blur, ~0.8s.
		gsap.set(words, { filter: 'blur(8px)' });
		// End on an explicit filter:none, never clearProps — that drops back to
		// the page CSS's starting blur(18px) and leaves the title blurred.
		return tl.to(words, { opacity: 1, filter: 'blur(0px)', duration: 0.8 * speed, ease: 'power2.out',
			onComplete: () => { gsap.set(words, { filter: 'none' }); } }, 0);
	}
	const stagger = 0.3 * speed;
	return tl
		.to(words, { opacity: 1, duration: 0.9 * speed, ease: 'sine.inOut', stagger }, at)
		.to(words, { filter: 'blur(0px)', duration: 1.8 * speed, ease: 'power2.inOut', stagger }, at)
		.fromTo(words, { scale: 1.04 }, { scale: 1, duration: 2 * speed, ease: 'power2.out', stagger, clearProps: 'scale' }, at);
}

// Supporting line under a title (lead / intro), same focus pull but
// softer. Mobile places it after the title has found focus — its centred
// first screen is just title + lead, and a lead already sharp while the
// title is still blurring read as out of order.
export function supportIn(tl: gsap.core.Timeline, el: Element | null, at: number, speed = 1): gsap.core.Timeline {
	if (!el) return tl;
	const mode = subpageMode();
	if (mode === 'none') { gsap.set(el, { opacity: 1, y: 0, filter: 'none' }); return tl; }
	if (reducedMotion()) {
		gsap.set(el, { y: 0, filter: 'none' });
		return tl.to(el, { opacity: 1, duration: 0.3, ease: 'none' }, 0.1);
	}
	if (mode === 'short') {
		gsap.set(el, { filter: 'blur(6px)' });
		return tl.to(el, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7 * speed, ease: 'power2.out',
			onComplete: () => { gsap.set(el, { filter: 'none' }); } }, 0.15);
	}
	gsap.set(el, { filter: 'blur(10px)' });
	return tl
		.to(el, { opacity: 1, duration: 0.8 * speed, ease: 'sine.inOut' }, at)
		.to(el, { filter: 'blur(0px)', y: 0, duration: 1.2 * speed, ease: 'power2.inOut',
			onComplete: () => { gsap.set(el, { filter: 'none' }); } }, at);
}

export function afterPageTransition(fn: () => void): void {
	if (pending) pending.then(fn);
	else fn();
}

// Mobile subpage entrance order: the hero title blurs in first, then the
// page content below it ([data-after-hero], hidden by global.css on
// mobile only) fades in. Call from inside the page's afterPageTransition
// callback, right after starting the title's own animation.
export function revealAfterHero(delayMs = 400): void {
	const mode = subpageMode();
	if (mode !== 'full') delayMs = mode === 'none' ? 0 : Math.min(delayMs, 200);
	setTimeout(() => {
		document.querySelectorAll('[data-after-hero]').forEach((el) => el.classList.add('is-in'));
	}, delayMs);
}
