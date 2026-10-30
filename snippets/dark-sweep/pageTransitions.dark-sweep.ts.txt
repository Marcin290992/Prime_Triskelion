import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type RouteKind = 'idle' | 'standard' | 'menu' | 'history' | 'native-history';
type IncomingEffect = 'blur' | 'none';

interface RouteRun {
	kind: RouteKind;
	skipNative: boolean;
	incoming: IncomingEffect;
	restoreY: number | null;
}

interface PreparationEvent extends Event {
	loader: () => Promise<void>;
	newDocument?: Document;
	navigationType?: string;
	sourceElement?: Element;
	direction?: string;
}

interface TransitionView {
	ready?: Promise<unknown>;
	finished?: Promise<unknown>;
	skipTransition?: () => void;
}

interface SwapEvent extends Event {
	viewTransition?: TransitionView;
}

interface LenisController {
	resize?: () => void;
	scrollTo: (y: number, options?: { immediate?: boolean; force?: boolean }) => void;
}

declare global {
	interface Window {
		__lenis?: LenisController | null;
	}
}

const CASE_OPEN_SECONDS = 1.2;
const CASE_MIDPOINT_PUSH = 0.12;
const CASE_SCRIM_OPACITY = 0.4;

const IDLE_RUN: RouteRun = {
	kind: 'idle',
	skipNative: false,
	incoming: 'none',
	restoreY: null,
};

let activeRun = { ...IDLE_RUN };
let caseShot: HTMLElement | null = null;
const preloadedCaseImages = new Set<string>();
let nativeSkipped = false;
let requestedIncoming: IncomingEffect | null = null;
let requestedAt = 0;
let transitionReady: Promise<void> = Promise.resolve();
let nativeHistoryTransition = false;
let restoring = false;
let cutSwapComplete = false;
let cutTransitionComplete = false;
const restoreHolds: Promise<void>[] = [];

export function reducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function cutNextTransition(blurIn = true): void {
	requestedIncoming = blurIn ? 'blur' : 'none';
	requestedAt = performance.now();
	document.documentElement.classList.add('vt-cut');
}

// True from the start of a navigation whose native View Transition is skipped
// (a cut). Persistent chrome must not get a view-transition-name then: the
// transition is still "active" for a few frames before the skip lands, and a
// named element is lifted out of the page into its own snapshot layer, above
// the film grain and with its beam frozen/blank.
export function skipsNativeTransition(): boolean {
	return nativeSkipped;
}

export function waitForPageTransition(): Promise<void> {
	return transitionReady;
}

export function holdRestore(): () => void {
	if (!restoring) return () => {};

	let release!: () => void;
	restoreHolds.push(new Promise<void>((resolve) => { release = resolve; }));
	return release;
}

window.addEventListener('popstate', (event) => {
	nativeHistoryTransition = !!(event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
}, true);

document.addEventListener('astro:before-preparation', (rawEvent) => {
	const event = rawEvent as PreparationEvent;
	// Astro can dispatch this event twice for one navigation (the first is
	// aborted), so the menu's request and its veil are kept until the swap.
	const incoming = performance.now() - requestedAt < 4000 ? requestedIncoming : null;
	const isNativeSwipe = nativeHistoryTransition;
	nativeHistoryTransition = false;
	caseShot?.remove();
	caseShot = null;
	// A sweep whose navigation was overtaken (back/forward pressed mid-exit)
	// would otherwise stay black over the page for good.
	if (!(menuHandoff && incoming !== null)) {
		sweepVeil?.remove();
		sweepVeil = null;
		sweepDir = 1;
		menuHandoff = false;
	}

	if (incoming !== null) {
		activeRun = { kind: 'menu', skipNative: true, incoming, restoreY: null };
		document.documentElement.classList.add('vt-cut');
	} else if (event.navigationType === 'traverse') {
		activeRun = {
			kind: isNativeSwipe ? 'native-history' : 'history',
			skipNative: !isNativeSwipe,
			incoming: 'none',
			restoreY: typeof history.state?.scrollY === 'number' ? history.state.scrollY : null,
		};
		if (!isNativeSwipe) {
			document.documentElement.classList.add('vt-cut');
			if (!reducedMotion()) prepareSweepExit(event);
		}
	} else {
		if (reducedMotion()) {
			activeRun = { ...IDLE_RUN };
		} else {
			activeRun = { kind: 'standard', skipNative: true, incoming: 'blur', restoreY: null };
			document.documentElement.classList.add('vt-cut');
			// A project card first grows its photo to full screen, then sweeps.
			if (!prepareCaseStudy(event)) prepareSweepExit(event);
		}
	}

	nativeSkipped = activeRun.skipNative;
	inlineNewStylesheets(event);
});

// Darkness sweeps over the old page left to right (the About scroll's soft
// cosine edge), and the same darkness is then lifted off the new page in the
// same direction. One black veil on <html> survives the body swap, so there is
// no frame between the two halves.
// Soft-edge half-width (% of the width) and times. On a narrow screen a wide
// edge is mostly a fade, so phones and tablets get a tighter edge and a
// faster sweep: the dark reads as something crossing the screen, not a slow fade.
let SWEEP_W = 40;
let SWEEP_EXIT_SECONDS = 0.6;
let SWEEP_ENTER_SECONDS = 0.75;
// Phones/tablets: a much softer, tilted edge. On a tall narrow screen a
// vertical edge is over in a blink; a wide slanted penumbra crosses the whole
// frame diagonally, like the light on the About page.
let SWEEP_SKEW = 0;
function tuneSweep(): void {
	const small = window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches;
	SWEEP_W = small ? 55 : 40;
	SWEEP_EXIT_SECONDS = small ? 0.6 : 0.6;
	SWEEP_ENTER_SECONDS = small ? 0.75 : 0.75;
	SWEEP_SKEW = small ? -16 : 0;
}
// How far a skewed bar's edge is pushed sideways at the top and bottom.
const skewPad = () => Math.ceil(Math.abs(Math.tan(SWEEP_SKEW * Math.PI / 180)) * window.innerHeight / 2) + 4;
let sweepVeil: HTMLElement | null = null;
// 1: the dark travels left to right; -1 (going back): right to left.
let sweepDir: 1 | -1 = 1;
// The menu's own sweep, already covering the page when navigate() runs.
let menuHandoff = false;

// The veil is a full-screen clip holding one wide bar (solid black with the
// soft cosine edge on one end) that is only ever translated: a composited
// transform, so it stays smooth on phones, unlike animating a mask.
const barOf = (veil: HTMLElement) => veil.firstElementChild as HTMLElement;

function makeVeil(z: number): HTMLElement {
	const veil = document.createElement('div');
	veil.setAttribute('aria-hidden', 'true');
	veil.style.cssText = `position:fixed;inset:0;z-index:${z};pointer-events:none;overflow:hidden;${sweepDir === -1 ? 'transform:scaleX(-1);' : ''}`;
	const bar = document.createElement('div');
	bar.style.cssText = 'position:absolute;top:0;bottom:0;left:0;will-change:transform';
	veil.append(bar);
	document.documentElement.append(veil);
	return veil;
}

// cover: solid, then the edge fading out on the right (it comes in from the
// left). Otherwise the mirror: the edge on the left, solid after it (the dark
// leaves to the right).
function paintBar(veil: HTMLElement, cover: boolean): void {
	const iw = window.innerWidth;
	const pad = skewPad();
	const soft = (2 * SWEEP_W) / 100 * iw;
	const solidPx = iw + 2 * pad;
	const barW = solidPx + soft;
	const solid = solidPx / barW;
	const steps = 16;
	const stops: string[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const fall = 0.5 + 0.5 * Math.cos(Math.PI * t);
		stops.push(cover
			? `rgb(0 0 0 / ${fall.toFixed(3)}) ${((solid + (1 - solid) * t) * 100).toFixed(2)}%`
			: `rgb(0 0 0 / ${(1 - fall).toFixed(3)}) ${((1 - solid) * t * 100).toFixed(2)}%`);
	}
	const bar = barOf(veil);
	bar.style.width = `${barW}px`;
	bar.style.background = cover
		? `linear-gradient(90deg, #000 0, #000 ${solid * 100 - 0.01}%, ${stops.join(', ')})`
		: `linear-gradient(90deg, ${stops.join(', ')}, #000 100%)`;
	// Cover: starts wholly off to the left, ends with its solid part over the
	// screen. Reveal: starts with the solid part over the screen.
	gsap.set(bar, { x: cover ? -barW - pad : -soft - pad, skewX: SWEEP_SKEW });
}

function sweepIn(veil: HTMLElement): Promise<void> {
	return Promise.resolve(gsap.to(barOf(veil), { x: -skewPad(), duration: SWEEP_EXIT_SECONDS, ease: 'sine.inOut' })).then(() => {});
}

// Choosing a menu link: the dark sweeps over the open menu itself (the menu
// overlay is z-index 999; the logo and top-bar CTA, 1002, stay above the
// veil on every page and in the menu), then the navigation starts under full black.
export function sweepOverMenu(): Promise<void> {
	tuneSweep();
	sweepVeil?.remove();
	sweepDir = 1;
	const veil = makeVeil(1001);
	sweepVeil = veil;
	menuHandoff = true;
	if (reducedMotion()) {
		barOf(veil).style.display = 'none';
		veil.style.background = '#000';
		veil.style.opacity = '0';
		return Promise.resolve(gsap.to(veil, { opacity: 1, duration: 0.25, ease: 'none' })).then(() => {});
	}
	paintBar(veil, true);
	return sweepIn(veil);
}

function startSweepCover(back: boolean): Promise<void> {
	tuneSweep();
	sweepDir = back ? -1 : 1;
	sweepVeil?.remove();
	const veil = makeVeil(1001);
	paintBar(veil, true);
	sweepVeil = veil;
	return sweepIn(veil);
}

// Navigation failed or was overtaken: don't leave the page dark.
function dropSweep(): void {
	sweepVeil?.remove();
	sweepVeil = null;
}

function prepareSweepExit(event: PreparationEvent): void {
	const sweep = startSweepCover(event.direction === 'back');
	const load = event.loader;
	event.loader = async () => {
		try {
			await Promise.all([load(), sweep]);
		} catch (error) {
			dropSweep();
			throw error;
		}
	};
}

function prepareCaseStudy(event: PreparationEvent): boolean {
	const link = event.sourceElement?.closest('[data-case]');
	const image = link?.querySelector<HTMLImageElement>('img');
	if (!link || !image || reducedMotion() || matchMedia('(pointer: coarse)').matches) return false;

	const media = image.closest<HTMLElement>('[data-case-media]') ?? image;
	if (!media.offsetWidth || !media.offsetHeight || !image.naturalWidth) return false;

	caseShot?.remove();
	const shot = document.createElement('div');
	shot.setAttribute('aria-hidden', 'true');
	shot.style.cssText = 'position:fixed;inset:0;z-index:1000;pointer-events:none;visibility:hidden';
	document.documentElement.append(shot);
	caseShot = shot;

	const screen = shot.getBoundingClientRect();
	const imageRect = image.getBoundingClientRect();
	const mediaRect = media.getBoundingClientRect();
	const imageWidth = image.naturalWidth;
	const imageHeight = image.naturalHeight;
	const cover = (width: number, height: number) => Math.max(width / imageWidth, height / imageHeight);
	const screenScale = cover(screen.width, screen.height);
	const cardScale = cover(imageRect.width, imageRect.height);
	const initialScale = cardScale / screenScale;
	const [positionX, positionY] = getComputedStyle(image).objectPosition.split(' ');
	const offset = (position: string | undefined, free: number) =>
		!position ? free / 2 : position.endsWith('%') ? free * parseFloat(position) / 100 : parseFloat(position) || 0;
	const cropX = offset(positionX, imageRect.width - imageWidth * cardScale);
	const cropY = offset(positionY ?? positionX, imageRect.height - imageHeight * cardScale);
	const moveX = imageRect.left - screen.left + cropX + (imageWidth * cardScale) / 2 - screen.width / 2;
	const moveY = imageRect.top - screen.top + cropY + (imageHeight * cardScale) / 2 - screen.height / 2;
	const inset = [
		mediaRect.top - screen.top,
		screen.right - mediaRect.right,
		screen.bottom - mediaRect.bottom,
		mediaRect.left - screen.left,
	];
	const radius = parseFloat(getComputedStyle(media).borderTopLeftRadius) || 0;

	shot.innerHTML = [
		'<div style="position:absolute;inset:0;overflow:hidden;will-change:clip-path">',
		`<div style="position:absolute;left:${(screen.width - imageWidth * screenScale) / 2}px;top:${(screen.height - imageHeight * screenScale) / 2}px;width:${imageWidth * screenScale}px;height:${imageHeight * screenScale}px;will-change:transform"></div>`,
		'<div style="position:absolute;inset:0;opacity:0;background:linear-gradient(to top,rgb(0 0 0 / .75),rgb(0 0 0 / .1) 45%,rgb(0 0 0 / .35))"></div>',
		'</div>',
	].join('');
	const frame = shot.firstElementChild as HTMLElement;
	const stage = frame.firstElementChild as HTMLElement;
	const scrim = frame.lastElementChild as HTMLElement;

	const addImage = (src: string) => {
		const element = document.createElement('img');
		element.src = src;
		element.alt = '';
		element.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block';
		stage.append(element);
		return element;
	};
	const thumbnail = addImage(image.currentSrc || image.src);
	const fullSource = link.getAttribute('data-case-src');
	if (fullSource) {
		const fullImage = addImage(fullSource);
		fullImage.style.opacity = '0';
		void fullImage.decode().then(
			() => gsap.to(fullImage, { opacity: 1, duration: 0.25, ease: 'none' }),
			(error) => console.warn('[pageTransitions] Could not decode the full case-study image.', error),
		);
	}

	const paint = (progress: number) => {
		const remaining = 1 - progress;
		frame.style.clipPath = `inset(${inset.map((value) => `${(value * remaining).toFixed(1)}px`).join(' ')} round ${(radius * remaining).toFixed(1)}px)`;
		const push = (initialScale + (1 - initialScale) * progress) * (1 + CASE_MIDPOINT_PUSH * Math.sin(Math.PI * progress));
		stage.style.transform = `translate3d(${(moveX * remaining).toFixed(1)}px,${(moveY * remaining).toFixed(1)}px,0) scale(${push.toFixed(4)})`;
		scrim.style.opacity = String(CASE_SCRIM_OPACITY * progress);
		shot.style.backgroundColor = `rgb(0 0 0 / ${Math.min(1, progress * 1.6).toFixed(3)})`;
	};

	paint(0);
	const progress = { value: 0 };
	const open = Promise.race([
		thumbnail.decode().catch((error) => {
			console.warn('[pageTransitions] Could not decode the case-study thumbnail.', error);
		}),
		delay(250),
	]).then(() => {
		shot.style.visibility = '';
		return gsap.to(progress, {
			value: 1,
			duration: CASE_OPEN_SECONDS,
			ease: 'power2.inOut',
			onUpdate: () => paint(progress.value),
		}).then(() => {});
	});

	// Once the photo has grown to fill the screen, the dark sweep carries the
	// navigation (the same transition as every other page).
	const load = event.loader;
	event.loader = async () => {
		try {
			await Promise.all([load(), open.then(() => startSweepCover(false))]);
		} catch (error) {
			dropSweep();
			caseShot?.remove();
			caseShot = null;
			throw error;
		}
	};
	return true;
}

const preloadCaseImage = (event: Event) => {
	const source = (event.target as Element | null)?.closest('[data-case]')?.getAttribute('data-case-src');
	if (!source || preloadedCaseImages.has(source)) return;
	preloadedCaseImages.add(source);
	new Image().src = source;
};
document.addEventListener('pointerover', preloadCaseImage, { passive: true });


function inlineNewStylesheets(event: PreparationEvent): void {
	const load = event.loader;
	event.loader = async () => {
		await load();
		const nextDocument = event.newDocument;
		if (!nextDocument) return;

		const links = Array.from(nextDocument.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"][href]'))
			.filter((link) => !document.querySelector(`head link[rel="stylesheet"][href="${link.getAttribute('href')}"]`));

		await Promise.all(links.map(async (link) => {
			const href = link.getAttribute('href');
			if (!href) return;
			try {
				const response = await fetch(href);
				if (!response.ok) {
					console.warn(`[pageTransitions] Could not inline stylesheet ${href}: ${response.status}`);
					return;
				}
				const style = nextDocument.createElement('style');
				style.setAttribute('data-pt-href', href);
				style.textContent = await response.text();
				link.replaceWith(style);
			} catch (error) {
				console.warn(`[pageTransitions] Could not inline stylesheet ${href}.`, error);
			}
		}));
	};
}

document.addEventListener('astro:before-swap', (rawEvent) => {
	const event = rawEvent as SwapEvent;
	const view = event.viewTransition;

	if (activeRun.skipNative) {
		view?.skipTransition?.();
		holdCutClass(view);
	}

	const ready = view?.ready ?? view?.finished;
	transitionReady = ready
		? Promise.resolve(ready).then(() => {}, () => {})
		: Promise.resolve();
});

function holdCutClass(view?: TransitionView): void {
	cutSwapComplete = false;
	cutTransitionComplete = false;

	const complete = () => {
		cutTransitionComplete = true;
		clearCutClassWhenReady();
	};
	if (view?.finished) {
		void view.finished.then(complete, complete);
	} else {
		document.addEventListener('astro:page-load', complete, { once: true });
	}
}

function clearCutClassWhenReady(): void {
	if (cutSwapComplete && cutTransitionComplete) document.documentElement.classList.remove('vt-cut');
}

document.addEventListener('astro:after-swap', (rawEvent) => {
	const event = rawEvent as SwapEvent;
	const run = activeRun;
	requestedIncoming = null;
	menuHandoff = false;

	// The grown project photo (if any) is under the full-black veil by now.
	caseShot?.remove();
	caseShot = null;

	if (run.skipNative) {
		document.documentElement.classList.add('vt-cut');
		cutSwapComplete = true;
		clearCutClassWhenReady();
	}

	if (run.kind !== 'history' && run.kind !== 'native-history') {
		ScrollTrigger.clearScrollMemory();
		ScrollTrigger.update();
	}

	if (run.kind === 'history') beginHistoryTransition(run.restoreY);
	else if (run.incoming === 'blur') beginBlurIn();

	waitForStylesheets();
	activeRun = { ...IDLE_RUN };
});

// The veil that is lifted off the new page: the one the exit sweep left on
// <html>, or (menu close, a cut) a fresh one that starts fully dark.
function takeVeil(): HTMLElement {
	let veil = sweepVeil;
	sweepVeil = null;
	if (!veil) {
		veil = makeVeil(1001);
	}
	veil.style.zIndex = '1001';
	veil.style.opacity = '';
	barOf(veil).style.display = '';
	veil.style.background = '';
	paintBar(veil, false);
	return veil;
}

async function liftVeil(veil: HTMLElement): Promise<void> {
	await nextFrame();
	await nextFrame();
	if (reducedMotion()) {
		barOf(veil).style.display = 'none';
		veil.style.background = '#000';
		await gsap.to(veil, { opacity: 0, duration: 0.2, ease: 'none' });
	} else {
		await gsap.to(barOf(veil), { x: window.innerWidth + skewPad(), duration: SWEEP_ENTER_SECONDS, ease: 'sine.inOut' });
	}
	veil.remove();
}

function beginBlurIn(): void {
	const veil = takeVeil();
	void Promise.all([transitionReady, oncePageLoad()]).then(() => liftVeil(veil));
}

function beginHistoryTransition(scrollY: number | null): void {
	// Lifted once the restored page is settled (scroll back in place, inits run).
	const veil = takeVeil();
	const settled = settleRestoredPage(scrollY);
	void Promise.all([transitionReady, settled]).then(() => liftVeil(veil));
}

function settleRestoredPage(scrollY: number | null): Promise<void> {
	const root = document.documentElement;
	root.classList.add('pt-restoring');
	restoring = true;
	restoreHolds.length = 0;
	const swapTime = gsap.globalTimeline.time();
	const restoreScroll = () => {
		if (scrollY === null) return;
		const lenis = window.__lenis;
		if (lenis) {
			lenis.resize?.();
			lenis.scrollTo(scrollY, { immediate: true, force: true });
		} else {
			window.scrollTo(0, scrollY);
		}
		ScrollTrigger.update();
	};

	const ready = (async () => {
		await oncePageLoad();
		await delay(0);
		let holdCount = -1;
		while (holdCount !== restoreHolds.length) {
			holdCount = restoreHolds.length;
			await Promise.all(restoreHolds);
			await nextFrame();
		}
		await document.fonts.ready;
		restoreScroll();
		await delay(200);
		await nextFrame();
	})();

	return Promise.race([ready, delay(2500)]).then(async () => {
		restoreScroll();
		gsap.globalTimeline.getChildren(false, true, true).forEach((tween) => {
			if (tween.startTime() < swapTime - 0.01 || tween.paused() || tween.repeat() === -1) return;
			if ((tween as gsap.core.Tween & { scrollTrigger?: unknown }).scrollTrigger || tween.totalDuration() > 20) return;
			if (tween instanceof gsap.core.Tween && !tween.targets().length) return;
			tween.progress(1);
		});
		restoring = false;
		void root.offsetHeight;
		await nextFrame();
		root.classList.remove('pt-restoring');
	});
}

function waitForStylesheets(): void {
	const waiting = Array.from(document.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]'))
		.filter((link) => !link.sheet);
	if (!waiting.length) return;

	const root = document.documentElement;
	root.classList.add('pt-styles-wait');
	void Promise.all(waiting.map(waitForStylesheet))
		.then(() => nextFrame())
		.then(() => root.classList.remove('pt-styles-wait'));
}

function waitForStylesheet(link: HTMLLinkElement): Promise<void> {
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(finish, 1500);
		link.addEventListener('load', finish, { once: true });
		link.addEventListener('error', () => {
			console.warn(`[pageTransitions] Could not load stylesheet ${link.href}.`);
			finish();
		}, { once: true });
	});
}

function oncePageLoad(): Promise<void> {
	return new Promise((resolve) => document.addEventListener('astro:page-load', () => resolve(), { once: true }));
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
