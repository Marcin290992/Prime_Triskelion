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

// Back/forward that the browser already animated itself — the iOS / macOS
// Safari swipe gesture slides the previous page in (hasUAVisualTransition,
// Astro then skips its own transition). Playing ours on top would run a
// second transition after the page is already there, so those keep the old
// behaviour: no exit fade, finished page at once (mode 'none'). A capture
// listener runs before the router's own popstate handler on window.
let uaVisualNext = false;
window.addEventListener('popstate', (e: any) => {
	uaVisualNext = !!e.hasUAVisualTransition;
}, true);

// Touch, in-page links and back/forward (not the menu): the same shape as
// leaving through the menu — the page fades down to black (while the next
// one loads, so it costs no extra wait when that takes longer), then a cut
// and the new title focuses in. The quick root cross-fade they used to get
// read as abrupt next to the menu's exit. Only the page content fades —
// the logo, menu and edge strips stay (the set html.ox-menu-covered hides).
document.addEventListener('astro:before-preparation', (e: any) => {
	if (cutNext || (e.navigationType === 'traverse' && uaVisualNext)) return;
	if (!window.matchMedia('(pointer: coarse)').matches) return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const content = document.querySelectorAll<HTMLElement>(
		'body > :not(#oxygen-menu-root):not(#h-title):not(.edge-tint)'
	);
	const fade = new Promise<void>((resolve) => {
		gsap.to(content, { opacity: 0, duration: 0.5, ease: 'power2.inOut', onComplete: () => resolve() });
	});
	const load = e.loader;
	e.loader = async () => { await Promise.all([load(), fade]); };
	cutNextTransition();
});
document.addEventListener('astro:before-swap', (e) => {
	if (!cutNext) return;
	cutNext = false;
	cutting = true;
	// A cut animates nothing, so skip the browser's view transition outright.
	// Left running, iOS Safari showed the new page as a frozen snapshot for
	// its duration — and when the toolbar re-expanded after the scroll reset
	// (it had collapsed from scrolling the previous page), that snapshot slid
	// up and down before the live page replaced it.
	e.viewTransition?.skipTransition?.();
	// Keep the class until the transition is over (dropping it earlier would
	// re-apply the root fades mid-transition), then clear it.
	const done = e.viewTransition?.finished ?? Promise.resolve();
	done.catch(() => {}).then(() => {
		cutting = false;
		document.documentElement.classList.remove('vt-cut');
	});
});

// Unstyled flash fix. Before the swap, the new page's stylesheets that this
// page doesn't already have are inlined as <style> (their text comes from
// the HTTP cache — the router has just preloaded them). A <style> applies
// in the same frame it's inserted, where a newly inserted <link> — even a
// cached one — applies asynchronously on iOS Safari: the swapped-in page
// painted a frame or two unstyled (on back navigations under the view
// transition too, as a flicker). The CSS only uses absolute url()s, so it
// reads the same inlined. The guard below stays as a fallback for a sheet
// that couldn't be inlined.
document.addEventListener('astro:before-preparation', (e: any) => {
	const load = e.loader;
	e.loader = async () => {
		await load();
		const doc: Document | undefined = e.newDocument;
		if (!doc) return;
		const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"][href]'))
			.filter((l) => !document.querySelector(`head link[rel="stylesheet"][href="${l.getAttribute('href')}"]`));
		await Promise.all(links.map(async (l) => {
			const href = l.getAttribute('href')!;
			try {
				const res = await fetch(href);
				if (!res.ok) return;
				const style = doc.createElement('style');
				style.setAttribute('data-pt-href', href);
				style.textContent = await res.text();
				l.replaceWith(style);
			} catch {}
		}));
	};
});

// Unstyled flash guard. The router waits for a new page's stylesheets to
// download before swapping, not for them to apply — iOS Safari can paint the
// swapped-in page a frame or two before its (cached) sheet is in effect,
// and with the menu's cut there's no view-transition snapshot covering
// that anymore. Until every new sheet has loaded, html.pt-styles-wait
// hides the page content (global.css) — logo, menu and the black stay.
document.addEventListener('astro:after-swap', () => {
	const waiting = Array.from(document.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]'))
		.filter((l) => !l.sheet);
	if (!waiting.length) return;
	const root = document.documentElement;
	root.classList.add('pt-styles-wait');
	Promise.all(waiting.map((l) => new Promise<void>((r) => {
		l.addEventListener('load', () => r(), { once: true });
		l.addEventListener('error', () => r(), { once: true });
		setTimeout(r, 1500); // never leave the page hidden
	}))).then(() => requestAnimationFrame(() => root.classList.remove('pt-styles-wait')));
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
// 'short' seen before in this session (a reload restarts: 'full') — one quick, light
//         focus pull, no choreography, so going round the site doesn't mean
//         sitting through the same intro again;
// 'none'  arrived with a back/forward the browser animated itself (Safari's
//         swipe) or a hard back/forward load — straight to the finished page.
//         A client-side back/forward (button, browser arrow) plays the same
//         'short' entrance as going forward to a page seen before.
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
	// A reload is a restart: back at the top (Layout.astro) with the full
	// entrance, as on a first visit.
	if (reload) return 'full';
	return seen ? 'short' : 'full';
}
let mode: EntranceMode = (() => {
	const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
	return decide(nav?.type === 'back_forward', nav?.type === 'reload');
})();
let traverseNext = false;
document.addEventListener('astro:before-preparation', (e: any) => {
	traverseNext = e.navigationType === 'traverse' && uaVisualNext;
	uaVisualNext = false;
});
document.addEventListener('astro:after-swap', () => {
	mode = decide(traverseNext);
	traverseNext = false;
	// Swipe-back lands mid-page (restored scroll) — on mobile right in the
	// content below the hero, which starts hidden and fades in 0.8s after
	// the title (revealAfterHero). Show it now, before the first paint and
	// without the fade: under the browser's own slide it read as a blink.
	if (mode === 'none') {
		document.querySelectorAll<HTMLElement>('[data-after-hero]').forEach((el) => {
			el.style.transition = 'none';
			el.classList.add('is-in');
			void el.offsetHeight;
			el.style.transition = '';
		});
	}
});
export function entranceMode(): EntranceMode {
	return mode;
}

// Subpages (titles, leads, hints — everything but the home hero): the
// short entrance is the only one, first visit included, on every device —
// the full choreography read as too long there. Swipe-back still 'none'.
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
		// Ends on an inline blur(0px) and leaves it there. Never clearProps —
		// that drops back to the page CSS's starting blur(18px) and leaves the
		// title blurred — and no switch to filter:none at the end either:
		// iOS Safari re-rasterizes the text on that switch, a visible blink.
		return tl.to(words, { opacity: 1, filter: 'blur(0px)', duration: 0.8 * speed, ease: 'power2.out' }, 0);
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
		// Stays on blur(0px) — see titleIn.
		return tl.to(el, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7 * speed, ease: 'power2.out' }, 0.15);
	}
	gsap.set(el, { filter: 'blur(10px)' });
	return tl
		.to(el, { opacity: 1, duration: 0.8 * speed, ease: 'sine.inOut' }, at)
		.to(el, { filter: 'blur(0px)', y: 0, duration: 1.2 * speed, ease: 'power2.inOut' }, at);
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
