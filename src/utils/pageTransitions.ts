import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type RouteKind = 'idle' | 'standard' | 'menu' | 'case-study' | 'history' | 'native-history';
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
let nativeSkipped = false;
let requestedIncoming: IncomingEffect | null = null;
let transitionReady: Promise<void> = Promise.resolve();
let caseShot: HTMLElement | null = null;
let nativeHistoryTransition = false;
let restoring = false;
let cutSwapComplete = false;
let cutTransitionComplete = false;
const restoreHolds: Promise<void>[] = [];
const preloadedCaseImages = new Set<string>();

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
	caseShot?.remove();
	caseShot = null;

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
			if (!reducedMotion()) preparePageExit(event);
		}
	} else {
		const caseTransition = prepareCaseStudy(event);
		if (caseTransition) {
			activeRun = { kind: 'case-study', skipNative: true, incoming: 'none', restoreY: null };
			document.documentElement.classList.add('vt-cut');
		} else if (reducedMotion()) {
			activeRun = { ...IDLE_RUN };
		} else {
			activeRun = { kind: 'standard', skipNative: true, incoming: 'blur', restoreY: null };
			document.documentElement.classList.add('vt-cut');
			preparePageExit(event);
		}
	}

	nativeSkipped = activeRun.skipNative;
	inlineNewStylesheets(event);
});

function preparePageExit(event: PreparationEvent): void {
	const content = Array.from(document.querySelectorAll<HTMLElement>(
		'body > :not(#oxygen-menu-root):not(#h-title):not(#site-cta-wrap):not(#hero-nav-cta-wrap):not(.edge-tint):not(.film-grain):not([data-leave-keep])'
	));
	const keptContent = Array.from(document.querySelectorAll<HTMLElement>('[data-leave-keep] > *'));
	const ctas = ['site-cta-wrap', 'hero-nav-cta-wrap']
		.map((id) => document.getElementById(id))
		.filter((element): element is HTMLElement => element !== null);

	fadeAndBlur(keptContent, 14);
	prepareCtas(ctas);
	fadeAndBlur(ctas, 10);

	// About on a touch device: a whole-screen portrait and the pinned scene are
	// on screen, and blurring them as well as fading is more than a phone
	// renders smoothly (the picture then just cuts out). Fade only, a touch
	// longer, there.
	const fadeOnly = !!document.getElementById('about-mobile') && matchMedia('(pointer: coarse)').matches;
	const exit = content.length
		? gsap.to(content, { opacity: 0, duration: fadeOnly ? 0.95 : 0.75, ease: 'power2.inOut' }).then(() => {})
		: Promise.resolve();
	if (content.length && !fadeOnly) gsap.to(content, { filter: 'blur(14px)', duration: 0.6, delay: 0.15, ease: 'power2.in' });

	const load = event.loader;
	event.loader = async () => { await Promise.all([load(), exit]); };
}

function fadeAndBlur(elements: HTMLElement[], radius: number): void {
	if (!elements.length) return;
	gsap.to(elements, { opacity: 0, duration: 0.75, ease: 'power2.inOut' });
	gsap.to(elements, { filter: `blur(${radius}px)`, duration: 0.6, delay: 0.15, ease: 'power2.in' });
}

function prepareCtas(ctas: HTMLElement[]): void {
	ctas.forEach((cta) => {
		const style = getComputedStyle(cta);
		cta.style.transition = 'none';
		cta.style.pointerEvents = 'none';
		cta.style.opacity = style.opacity;
		cta.style.filter = style.filter;
		cta.style.transform = style.transform === 'none' ? 'none' : style.transform;
		if (cta.parentElement !== document.body) document.body.append(cta);
	});
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

	const load = event.loader;
	event.loader = async () => { await Promise.all([load(), open]); };
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

	if (run.skipNative) {
		document.documentElement.classList.add('vt-cut');
		cutSwapComplete = true;
		clearCutClassWhenReady();
	}

	if (run.kind !== 'history' && run.kind !== 'native-history') {
		ScrollTrigger.clearScrollMemory();
		ScrollTrigger.update();
	}

	if (run.kind === 'case-study') finishCaseStudyTransition();
	else if (run.kind === 'history') beginHistoryTransition(run.restoreY);
	else if (run.incoming === 'blur') beginBlurIn();

	waitForStylesheets();
	activeRun = { ...IDLE_RUN };
});

function finishCaseStudyTransition(): void {
	const shot = caseShot;
	if (!shot) return;

	const frame = shot.firstElementChild;
	if (!frame) {
		shot.remove();
		if (caseShot === shot) caseShot = null;
		transitionReady = Promise.resolve();
		return;
	}

	const fade = frame.animate([{ opacity: 1 }, { opacity: 0 }], {
		duration: 700,
		easing: 'ease-in-out',
		fill: 'forwards',
	});
	transitionReady = new Promise<void>((resolve) => {
		const finish = () => {
			shot.remove();
			if (caseShot === shot) caseShot = null;
			resolve();
		};
		fade.addEventListener('finish', finish, { once: true });
		fade.addEventListener('cancel', finish, { once: true });
	});
}

function beginBlurIn(): void {
	const blur = reducedMotion() ? 0 : 18;
	const veil = document.createElement('div');
	veil.setAttribute('aria-hidden', 'true');
	veil.style.cssText = `position:fixed;inset:0;z-index:1001;pointer-events:none;background:#000;opacity:1;will-change:opacity,backdrop-filter;-webkit-backdrop-filter:blur(${blur}px);backdrop-filter:blur(${blur}px)`;
	document.documentElement.append(veil);

	const loaded = oncePageLoad();
	const ready = transitionReady;
	void Promise.all([ready, loaded]).then(async () => {
		await nextFrame();
		await nextFrame();
		const value = { opacity: 1 };
		const paint = () => {
			veil.style.opacity = String(value.opacity);
			const filter = `blur(${(blur * value.opacity).toFixed(1)}px)`;
			veil.style.backdropFilter = filter;
			veil.style.setProperty('-webkit-backdrop-filter', filter);
		};
		await gsap.to(value, {
			opacity: 0,
			duration: blur ? 0.55 : 0.2,
			ease: 'power2.out',
			onUpdate: paint,
		});
		veil.remove();
	});
}

function beginHistoryTransition(scrollY: number | null): void {
	const veil = document.createElement('div');
	veil.style.cssText = 'position:fixed;inset:0;z-index:997;pointer-events:none;background:#000';
	document.body.append(veil);

	const blur = reducedMotion() ? 0 : 8;
	const value = { opacity: 1 };
	const paint = () => {
		veil.style.opacity = String(value.opacity);
		if (blur) {
			const filter = `blur(${(blur * value.opacity).toFixed(2)}px)`;
			veil.style.backdropFilter = filter;
			veil.style.setProperty('-webkit-backdrop-filter', filter);
		}
	};
	paint();

	const settled = settleRestoredPage(scrollY);
	void Promise.all([transitionReady, settled]).then(async () => {
		await nextFrame();
		await nextFrame();
		await gsap.to(value, {
			opacity: 0,
			duration: blur ? 0.8 : 0.3,
			ease: 'power2.out',
			onUpdate: paint,
		});
		veil.remove();
	});
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
