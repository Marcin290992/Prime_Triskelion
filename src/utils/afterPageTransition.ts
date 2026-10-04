import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
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

// Into a case study (links in a data-case element; desktop only — touch
// keeps the fade to black below, the user preferred it there): the
// project's picture opens up from its card to the whole screen — a frame
// (clip-path, card's corner radius easing to square) widening over a
// full-screen picture, which settles from the card's own crop to the full
// one with a slight push in and back out on the way, like the scroll-expand
// reveals; a scrim deepens and the page behind goes to black. The case study
// loads meanwhile. The picture lives on <html>, outside <body>, so it
// survives the swap (the router only replaces <body>); on the new page it
// fades down to black, and then the title focuses in like every other
// hero. A cut otherwise (no browser view transition), so it plays the
// same everywhere. The chrome (logo, menu, z-index 1002) stays above it.
const CASE_OPEN_S = 1.2;
const CASE_PUSH = 0.12;  // extra zoom at the middle of the move
const CASE_SCRIM = 0.4;
let caseShot: HTMLElement | null = null;
const casePreloaded = new Set<string>();
document.addEventListener('astro:before-preparation', (e: any) => {
	const link = (e.sourceElement as Element | undefined)?.closest?.('[data-case]');
	const img = link?.querySelector<HTMLImageElement>('img');
	if (!link || !img || reducedMotion()) return;
	if (window.matchMedia('(pointer: coarse)').matches) return;
	const media = img.closest<HTMLElement>('[data-case-media]') ?? img;
	if (!media.offsetWidth || !media.offsetHeight || !img.naturalWidth) return;

	// A navigation that never swapped (superseded by this one) mustn't
	// leave its picture over the page.
	caseShot?.remove();
	const shot = document.createElement('div');
	shot.setAttribute('aria-hidden', 'true');
	shot.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none;visibility:hidden';
	document.documentElement.append(shot);
	caseShot = shot;

	// Everything is measured in the layer's own box — on iOS Safari a fixed
	// inset:0 layer isn't always innerWidth x innerHeight (toolbar), and a
	// mismatch showed as the picture jumping on the first frame.
	const sr = shot.getBoundingClientRect();
	const W = sr.width;
	const H = sr.height;
	const ir = img.getBoundingClientRect();
	const mr = media.getBoundingClientRect();

	// Start: the full-screen picture scaled and moved so that, seen through
	// the card-sized window, it's exactly the card's picture — measured on
	// the <img> itself (Home's cards zoom it for their parallax), with its
	// crop (object-position, e.g. Projects' "center 30%" on mobile).
	const iw = img.naturalWidth;
	const ih = img.naturalHeight;
	const cover = (w: number, h: number) => Math.max(w / iw, h / ih);
	const kv = cover(W, H);
	const kc = cover(ir.width, ir.height);
	const s0 = kc / kv;
	const [posX, posY] = getComputedStyle(img).objectPosition.split(' ');
	const offset = (pos: string | undefined, free: number) =>
		!pos ? free / 2 : pos.endsWith('%') ? free * parseFloat(pos) / 100 : parseFloat(pos) || 0;
	const ox = offset(posX, ir.width - iw * kc);
	const oy = offset(posY ?? posX, ir.height - ih * kc);
	const dx = ir.left - sr.left + ox + (iw * kc) / 2 - W / 2;
	const dy = ir.top - sr.top + oy + (ih * kc) / 2 - H / 2;
	const inset = [mr.top - sr.top, sr.right - mr.right, sr.bottom - mr.bottom, mr.left - sr.left];
	const radius = parseFloat(getComputedStyle(media).borderTopLeftRadius) || 0;

	shot.innerHTML = '<div style="position:absolute;inset:0;overflow:hidden;will-change:clip-path">'
		// The stage is the whole picture at its full-screen cover size (not
		// the screen's), so scaled down to the card nothing of it is cut.
		+ `<div style="position:absolute;left:${(W - iw * kv) / 2}px;top:${(H - ih * kv) / 2}px;width:${iw * kv}px;height:${ih * kv}px;will-change:transform"></div>`
		+ '<div style="position:absolute;inset:0;opacity:0;background:linear-gradient(to top,rgb(0 0 0 / .75),rgb(0 0 0 / .1) 45%,rgb(0 0 0 / .35))"></div>'
		+ '</div>';
	const frame = shot.firstElementChild as HTMLElement;
	const stage = frame.firstElementChild as HTMLElement;
	const scrim = frame.lastElementChild as HTMLElement;
	const addPic = (src: string) => {
		const pic = document.createElement('img');
		pic.src = src;
		pic.alt = '';
		pic.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block';
		stage.append(pic);
		return pic;
	};
	// Starts as the card's own picture (same pixels, same crop). It's a
	// thumbnail, soft once blown up to the whole screen, so the full-size
	// version (data-case-src, preloaded on first hover, below) is
	// laid over it and fades in as soon as it's decoded — within the first
	// moments of the move when preloaded. Same centre crop, so no shift.
	const first = addPic(img.currentSrc || img.src);
	const fullSrc = link.getAttribute('data-case-src');
	if (fullSrc) {
		const sharp = addPic(fullSrc);
		sharp.style.opacity = '0';
		sharp.decode().then(() => gsap.to(sharp, { opacity: 1, duration: 0.25, ease: 'none' }), () => {});
	}

	const apply = (p: number) => {
		const k = 1 - p;
		frame.style.clipPath = `inset(${inset.map((v) => (v * k).toFixed(1) + 'px').join(' ')} round ${(radius * k).toFixed(1)}px)`;
		const scale = (s0 + (1 - s0) * p) * (1 + CASE_PUSH * Math.sin(Math.PI * p));
		stage.style.transform = `translate3d(${(dx * k).toFixed(1)}px,${(dy * k).toFixed(1)}px,0) scale(${scale.toFixed(4)})`;
		scrim.style.opacity = String(CASE_SCRIM * p);
		shot.style.backgroundColor = `rgb(0 0 0 / ${Math.min(1, p * 1.6).toFixed(3)})`;
	};
	apply(0);
	// Shown and started only once the picture can paint: a freshly made
	// <img> can take a frame or two even from cache, and until then the
	// card itself is still there underneath, identical.
	const v = { p: 0 };
	const open = Promise.race([first.decode().catch(() => {}), new Promise((r) => setTimeout(r, 250))])
		.then(() => {
			shot.style.visibility = '';
			return gsap.to(v, { p: 1, duration: CASE_OPEN_S, ease: 'power2.inOut', onUpdate: () => apply(v.p) }).then();
		});
	const load = e.loader;
	e.loader = async () => { await Promise.all([load(), open]); };
	cutNextTransition();
});
const preloadCase = (e: Event) => {
	const src = (e.target as Element | null)?.closest?.('[data-case]')?.getAttribute('data-case-src');
	if (!src || casePreloaded.has(src)) return;
	casePreloaded.add(src);
	new Image().src = src;
};
document.addEventListener('pointerover', preloadCase, { passive: true });
document.addEventListener('astro:after-swap', () => {
	const shot = caseShot;
	if (!shot) return;
	caseShot = null;
	// The picture goes down to black; only then does the new page's own
	// entrance (the title's focus pull, like every other hero) start —
	// afterPageTransition() waits on this instead of the skipped
	// transition. The page underneath is black with its title still hidden,
	// so dropping the layer after the fade shows nothing new.
	const out = gsap.to(shot.firstElementChild, { opacity: 0, duration: 0.7, ease: 'power2.inOut' })
		.then(() => { shot.remove(); });
	pending = out;
});

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
// 'none'  arrived with the browser's back/forward — straight to the finished
//         page; the whole content comes in with one light blur-in instead
//         (below), or is simply there after Safari's own swipe animation.
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
let blurInNext = false;
let restoreY: number | null = null;
document.addEventListener('astro:before-preparation', (e: any) => {
	traverseNext = e.navigationType === 'traverse';
	blurInNext = traverseNext && !uaVisualNext;
	uaVisualNext = false;
	// On popstate history.state is already the entry being returned to —
	// the router saved its scroll there when the page was left.
	const y = history.state?.scrollY;
	restoreY = traverseNext && typeof y === 'number' ? y : null;
});

// Back/forward: the router restores the scroll right after the swap, but
// the page's scripts only build its layout after that (Process moves its
// title into the pinned rail, ScrollTriggers pin and set their states,
// reveals switch on) — scroll-driven parts slid into place and the page
// shifted under the restored position, in plain view. Wait for them, put
// the scroll back to where it was in the finished layout and finish any
// entrance already started, all while the veil below is still black.
let restoring = false;
const restoreHolds: Promise<unknown>[] = [];

// Work a page still has queued for itself (onReady()'s deferred inits,
// afterPageTransition() entrances): the veil waits for it, however long it
// takes on a slow phone — a reveal that only set itself up after the veil
// had cleared hid its text and played it in again, a visible blink.
export function holdRestore(): () => void {
	if (!restoring) return () => {};
	let release!: () => void;
	restoreHolds.push(new Promise<void>((r) => { release = r; }));
	return release;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function settleRestoredPage(y: number | null): Promise<void> {
	const root = document.documentElement;
	root.classList.add('pt-restoring');
	restoring = true;
	restoreHolds.length = 0;
	const swapAt = gsap.globalTimeline.time();
	const toSaved = () => {
		if (y === null) return;
		const lenis = (window as any).__lenis;
		if (lenis) {
			lenis.resize?.();
			lenis.scrollTo(y, { immediate: true, force: true });
		} else {
			window.scrollTo(0, y);
		}
		ScrollTrigger.update();
	};
	const pageLoaded = new Promise<void>((r) => document.addEventListener('astro:page-load', () => r(), { once: true }));
	const ready = (async () => {
		await pageLoaded;
		// Scripts that are new to this visit add their page-load listeners
		// after this module's, so let them run first.
		await wait(0);
		// Holds can queue more holds (an init that waits for the transition).
		let seen = -1;
		while (seen !== restoreHolds.length) {
			seen = restoreHolds.length;
			await Promise.all(restoreHolds);
			await nextFrame();
		}
		// The display fonts (the Process title's measurements depend on them).
		await document.fonts?.ready.catch(() => {});
		// Reveals fire from ScrollTrigger at the real position; give the short
		// timers they chain (the CTA button follows its title by 130ms) time.
		toSaved();
		await wait(200);
		await nextFrame();
	})();
	// Never leave the page behind the veil.
	return Promise.race([ready, wait(2500)]).then(async () => {
		toSaved();
		// Entrances started since the swap jump to their end (not loops,
		// scroll-linked tweens or delayed calls).
		gsap.globalTimeline.getChildren(false, true, true).forEach((t) => {
			if (t.startTime() < swapAt - 0.01 || t.paused() || t.repeat() === -1) return;
			if ((t as any).scrollTrigger || t.totalDuration() > 20) return;
			if (t instanceof gsap.core.Tween && !t.targets().length) return;
			t.progress(1);
		});
		restoring = false;
		void root.offsetHeight;
		await nextFrame();
		root.classList.remove('pt-restoring');
	});
}

// Back/forward (not the Safari swipe): the page comes in out of the black
// with one light focus pull — the same blur as the subpage titles' short
// entrance — wherever the restored scroll lands. Done with a veil over the
// page (below the chrome) that clears, not by filtering the page itself,
// so nothing on it (About's fluid canvas, fixed layers) is touched.
document.addEventListener('astro:after-swap', () => {
	if (!blurInNext) return;
	blurInNext = false;
	const veil = document.createElement('div');
	veil.style.cssText = 'position:fixed;inset:0;z-index:997;pointer-events:none;background:#000';
	document.body.append(veil);
	const blur = reducedMotion() ? 0 : 8;
	const v = { t: 1 };
	const paint = () => {
		veil.style.opacity = String(v.t);
		if (!blur) return;
		const f = `blur(${(blur * v.t).toFixed(2)}px)`;
		veil.style.backdropFilter = f;
		veil.style.setProperty('-webkit-backdrop-filter', f);
	};
	paint();
	const settled = settleRestoredPage(restoreY);
	restoreY = null;
	// Two frames later: a heavy page's first frames (About's fluid sim
	// starting up) would otherwise swallow the start of the clear. Not
	// through afterPageTransition(): that would hold the settle it waits for.
	Promise.all([pending, settled]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
		gsap.to(v, { t: 0, duration: blur ? 0.8 : 0.3, ease: 'power2.out', onUpdate: paint, onComplete: () => veil.remove() });
	})));
});

document.addEventListener('astro:after-swap', () => {
	mode = decide(traverseNext);
	traverseNext = false;
	// Back/forward lands mid-page (restored scroll) — on mobile right in the
	// content below the hero, which starts hidden and fades in 0.8s after
	// the title (revealAfterHero). Show it now, before the first paint and
	// without its own fade: the page-wide blur-in above brings it in (and
	// under Safari's swipe the page is simply there).
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
	const release = holdRestore();
	const run = () => { try { fn(); } finally { release(); } };
	if (pending) pending.then(run);
	else run();
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
