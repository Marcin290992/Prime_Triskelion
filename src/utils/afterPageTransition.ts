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
	gsap.set(el, { filter: 'blur(10px)' });
	return tl
		.to(el, { opacity: 1, duration: 0.8 * speed, ease: 'sine.inOut' }, at)
		.to(el, { filter: 'blur(0px)', y: 0, duration: 1.2 * speed, ease: 'power2.inOut', clearProps: 'filter' }, at);
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
	setTimeout(() => {
		document.querySelectorAll('[data-after-hero]').forEach((el) => el.classList.add('is-in'));
	}, delayMs);
}
