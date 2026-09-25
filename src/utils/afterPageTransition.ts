// astro:page-load fires as soon as the new DOM is swapped in — BEFORE the
// page View Transition (fade-out, then a whole-page blur-in, see
// Layout.astro) has played. A title that starts its own blur-in on
// page-load therefore gets caught mid-animation by the page blur-in and
// visibly blurs in twice. Run entrance animations through this instead:
// it waits for the running transition to finish (native or Astro's
// fallback — both expose `finished`), and runs immediately on a hard load.
//
// Imported by Layout.astro too, so the before-swap listener is registered
// on every page from the first load — a page script loaded only after
// navigating to it would otherwise miss the swap it needs to wait for.

let pending: Promise<unknown> | null = null;

document.addEventListener('astro:before-swap', (e) => {
	pending = e.viewTransition?.finished.catch(() => {}) ?? null;
});

export function afterPageTransition(fn: () => void): void {
	if (pending) pending.then(fn);
	else fn();
}
