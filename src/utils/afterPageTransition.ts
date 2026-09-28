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

// ≈ when the new page is starting to show (its fade-in has a ~0.1s delay).
// Touch: no wait at all — its fade-in starts almost at once (Layout.astro),
// and after the menu the old page is plain black anyway, so any extra beat
// here just read as a black screen hanging before the title.
const START_AFTER_READY_MS = window.matchMedia('(pointer: coarse)').matches ? 0 : 160;

let pending: Promise<unknown> | null = null;

document.addEventListener('astro:before-swap', (e) => {
	const vt = e.viewTransition;
	if (!vt) { pending = null; return; }
	const started = vt.ready
		? vt.ready.then(() => new Promise((r) => setTimeout(r, START_AFTER_READY_MS)))
		: vt.finished;
	// A skipped/aborted transition rejects — run the entrance anyway.
	pending = started.catch(() => {});
});

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
