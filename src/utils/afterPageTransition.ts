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

// Page-title blur-in, shared by the subpage heroes (every device): starts at
// once (no lead-in, the wait before it already felt long) but sharpens
// slowly, so it reads as a deliberate reveal rather than a snap.
export const TITLE_IN = { duration: 1.7, stagger: 0.2, at: 0 };

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
