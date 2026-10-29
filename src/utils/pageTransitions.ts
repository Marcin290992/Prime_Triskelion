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

const IDLE_RUN: RouteRun = {
	kind: 'idle',
	skipNative: false,
	incoming: 'none',
	restoreY: null,
};

let activeRun = { ...IDLE_RUN };
let nativeSkipped = false;
let requestedIncoming: IncomingEffect | null = null;
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
	const incoming = requestedIncoming;
	const isNativeSwipe = nativeHistoryTransition;
	requestedIncoming = null;
	nativeHistoryTransition = false;
	// A sweep whose navigation was overtaken (back/forward pressed mid-exit)
	// would otherwise stay black over the page for good.
	sweepVeil?.remove();
	sweepVeil = null;
	sweepDir = 1;

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
			prepareSweepExit(event);
		}
	}

	nativeSkipped = activeRun.skipNative;
	inlineNewStylesheets(event);
});

// Darkness sweeps over the old page left to right (the About scroll's soft
// cosine edge), and the same darkness is then lifted off the new page in the
// same direction. One black veil on <html> survives the body swap, so there is
// no frame between the two halves.
const SWEEP_W = 40;
const SWEEP_EXIT_SECONDS = 0.95;
const SWEEP_ENTER_SECONDS = 1.15;
let sweepVeil: HTMLElement | null = null;
// 1: the dark travels left to right; -1 (going back): right to left.
let sweepDir: 1 | -1 = 1;

function sweepMask(cover: boolean): string {
	const steps = 16;
	const stops: string[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const fall = 0.5 + 0.5 * Math.cos(Math.PI * t);
		const alpha = cover ? fall : 1 - fall;
		const offset = -SWEEP_W + 2 * SWEEP_W * t;
		stops.push(`rgb(0 0 0 / ${alpha.toFixed(3)}) calc(var(--pc) * 1% ${offset < 0 ? '-' : '+'} ${Math.abs(offset).toFixed(2)}%)`);
	}
	return `linear-gradient(${sweepDir === 1 ? 90 : 270}deg, ${stops.join(', ')})`;
}

function setSweepMask(veil: HTMLElement, cover: boolean): void {
	const mask = sweepMask(cover);
	veil.style.setProperty('mask-image', mask);
	veil.style.setProperty('-webkit-mask-image', mask);
	veil.style.setProperty('--pc', String(-SWEEP_W));
}

function prepareSweepExit(event: PreparationEvent): void {
	sweepDir = event.direction === 'back' ? -1 : 1;
	sweepVeil?.remove();
	const veil = document.createElement('div');
	veil.setAttribute('aria-hidden', 'true');
	veil.style.cssText = 'position:fixed;inset:0;z-index:1001;pointer-events:none;background:#000;will-change:mask-image';
	setSweepMask(veil, true);
	document.documentElement.append(veil);
	sweepVeil = veil;

	const sweep = gsap.to(veil, { '--pc': 100 + SWEEP_W, duration: SWEEP_EXIT_SECONDS, ease: 'sine.inOut' }).then(() => {});
	const load = event.loader;
	event.loader = async () => {
		try {
			await Promise.all([load(), sweep]);
		} catch (error) {
			// Navigation failed: don't leave the page dark.
			veil.remove();
			if (sweepVeil === veil) sweepVeil = null;
			throw error;
		}
	};
}

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
		veil = document.createElement('div');
		veil.setAttribute('aria-hidden', 'true');
		veil.style.cssText = 'position:fixed;inset:0;z-index:1001;pointer-events:none;background:#000;will-change:mask-image';
		document.documentElement.append(veil);
	}
	setSweepMask(veil, false);
	return veil;
}

async function liftVeil(veil: HTMLElement): Promise<void> {
	await nextFrame();
	await nextFrame();
	if (reducedMotion()) {
		veil.style.setProperty('mask-image', 'none');
		veil.style.setProperty('-webkit-mask-image', 'none');
		await gsap.to(veil, { opacity: 0, duration: 0.2, ease: 'none' });
	} else {
		await gsap.to(veil, { '--pc': 100 + SWEEP_W, duration: SWEEP_ENTER_SECONDS, ease: 'sine.inOut' });
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
