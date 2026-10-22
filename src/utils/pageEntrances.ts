import gsap from 'gsap';
import { holdRestore, reducedMotion, waitForPageTransition } from './pageTransitions';

const ENTRANCE_GUARD_MS = 4000;
const SEEN_KEY = 'pt-seen-pages';
const seenPages = new Set<string>();

let entranceGuardUntil = 0;
let entranceGuardTimer: ReturnType<typeof setTimeout> | undefined;
let returnTimer: ReturnType<typeof setTimeout> | undefined;

function guardEntrance(): void {
	entranceGuardUntil = performance.now() + ENTRANCE_GUARD_MS;
	gsap.ticker.lagSmoothing(100, 33);
	clearTimeout(entranceGuardTimer);
	entranceGuardTimer = setTimeout(() => {
		entranceGuardUntil = 0;
		gsap.ticker.lagSmoothing(0);
	}, ENTRANCE_GUARD_MS);
}

guardEntrance();
document.addEventListener('astro:after-swap', guardEntrance);

document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		gsap.ticker.lagSmoothing(100, 33);
		clearTimeout(returnTimer);
		return;
	}

	clearTimeout(returnTimer);
	returnTimer = setTimeout(() => {
		if (performance.now() >= entranceGuardUntil) gsap.ticker.lagSmoothing(0);
	}, 600);
});

export function syncTickerToScroll(): void {
	if (performance.now() >= entranceGuardUntil) gsap.ticker.lagSmoothing(0);
}

export type EntranceMode = 'full' | 'short' | 'none';

function seenPagePaths(): Set<string> {
	try {
		const stored = sessionStorage.getItem(SEEN_KEY);
		if (stored) (JSON.parse(stored) as string[]).forEach((path) => seenPages.add(path));
	} catch (error) {
		console.warn('[afterPageTransition] Could not read session page history.', error);
	}
	return seenPages;
}

function markPageSeen(path: string): void {
	seenPages.add(path);
	try {
		sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenPages]));
	} catch (error) {
		console.warn('[afterPageTransition] Could not save session page history.', error);
	}
}

function currentPath(): string {
	return location.pathname.replace(/\/$/, '') || '/';
}

function decideEntrance(traversing: boolean, reloading = false): EntranceMode {
	const path = currentPath();
	const alreadySeen = seenPagePaths().has(path);
	markPageSeen(path);

	if (traversing) return 'none';
	if (reloading) return 'full';
	return alreadySeen ? 'short' : 'full';
}

const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
let mode = decideEntrance(navigation?.type === 'back_forward', navigation?.type === 'reload');
let traversingNext = false;

document.addEventListener('astro:before-preparation', (event: Event) => {
	traversingNext = (event as Event & { navigationType?: string }).navigationType === 'traverse';
});

document.addEventListener('astro:after-swap', () => {
	mode = decideEntrance(traversingNext);
	traversingNext = false;

	if (mode !== 'none') return;
	document.querySelectorAll<HTMLElement>('[data-after-hero]').forEach((element) => {
		element.style.transition = 'none';
		element.classList.add('is-in');
		void element.offsetHeight;
		element.style.transition = '';
	});
});

export function entranceMode(): EntranceMode {
	return mode;
}

export function subpageMode(): EntranceMode {
	return mode === 'full' ? 'short' : mode;
}

export function titleIn(
	timeline: gsap.core.Timeline,
	words: ArrayLike<Element>,
	at = 0,
	speed = 1,
): gsap.core.Timeline {
	if (!words.length) return timeline;
	const entrance = subpageMode();

	if (entrance === 'none') {
		gsap.set(words, { opacity: 1, filter: 'none' });
		return timeline;
	}
	if (reducedMotion()) {
		gsap.set(words, { filter: 'none' });
		return timeline.to(words, { opacity: 1, duration: 0.3, ease: 'none' }, 0);
	}
	if (entrance === 'short') {
		gsap.set(words, { filter: 'blur(8px)' });
		return timeline.to(words, {
			opacity: 1,
			filter: 'blur(0px)',
			duration: 0.8 * speed,
			ease: 'power2.out',
		}, 0);
	}

	const stagger = 0.3 * speed;
	return timeline
		.to(words, { opacity: 1, duration: 0.9 * speed, ease: 'sine.inOut', stagger }, at)
		.to(words, { filter: 'blur(0px)', duration: 1.8 * speed, ease: 'power2.inOut', stagger }, at)
		.fromTo(words, { scale: 1.04 }, {
			scale: 1,
			duration: 2 * speed,
			ease: 'power2.out',
			stagger,
			clearProps: 'scale',
		}, at);
}

export function supportIn(
	timeline: gsap.core.Timeline,
	element: Element | null,
	at: number,
	speed = 1,
): gsap.core.Timeline {
	if (!element) return timeline;
	const entrance = subpageMode();

	if (entrance === 'none') {
		gsap.set(element, { opacity: 1, y: 0, filter: 'none' });
		return timeline;
	}
	if (reducedMotion()) {
		gsap.set(element, { y: 0, filter: 'none' });
		return timeline.to(element, { opacity: 1, duration: 0.3, ease: 'none' }, 0.1);
	}
	if (entrance === 'short') {
		gsap.set(element, { filter: 'blur(6px)' });
		return timeline.to(element, {
			opacity: 1,
			y: 0,
			filter: 'blur(0px)',
			duration: 0.7 * speed,
			ease: 'power2.out',
		}, 0.15);
	}

	gsap.set(element, { filter: 'blur(10px)' });
	return timeline
		.to(element, { opacity: 1, duration: 0.8 * speed, ease: 'sine.inOut' }, at)
		.to(element, { filter: 'blur(0px)', y: 0, duration: 1.2 * speed, ease: 'power2.inOut' }, at);
}

export function afterPageTransition(callback: () => void): void {
	const release = holdRestore();
	const start = () => {
		try {
			callback();
		} finally {
			release();
		}
	};

	void waitForPageTransition().then(start).catch((error) => {
		release();
		console.error('[afterPageTransition] Page entrance failed.', error);
	});
}

export function revealAfterHero(delayMs = 400): void {
	const entrance = subpageMode();
	const delay = entrance === 'none' ? 0 : entrance === 'short' ? Math.min(delayMs, 200) : delayMs;

	setTimeout(() => {
		document.querySelectorAll('[data-after-hero]').forEach((element) => element.classList.add('is-in'));
	}, delay);
}
