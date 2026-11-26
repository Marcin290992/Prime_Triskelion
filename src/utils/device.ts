// One answer to "is this a phone / tablet?" for the whole site, and the blur strengths that go with it.
// Blur stays on touch (it is half of the look); it is only smaller there, and always played on the clock.
export const TOUCH_QUERY = '(max-width: 1024px), (hover: none) and (pointer: coarse)';

export const isTouchLayout = (): boolean =>
	typeof window !== 'undefined' && window.matchMedia(TOUCH_QUERY).matches;

/** Blur radius in px for a reveal: `desktop` on a wide screen with a pointer, ~55% of it (min 3) on touch. */
export const blurPx = (desktop: number): number =>
	isTouchLayout() ? Math.max(3, Math.round(desktop * 0.55)) : desktop;
