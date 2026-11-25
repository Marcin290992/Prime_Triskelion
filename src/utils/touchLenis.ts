// Scroll on phones and tablets: Lenis drives the page (syncTouch), on the same
// GSAP ticker frame as the ScrollTrigger animations, so a pinned/sticky view and
// the animation moving inside it can't drift apart while the finger's momentum
// runs (that split is what made horizontal strips jitter on iOS Safari). The
// values are the ones used on white-desert.com, which holds up on iPhones.
// autoRaf is off: the caller adds lenis.raf to gsap.ticker.
export const TOUCH_LENIS_OPTIONS = {
	autoRaf: false,
	syncTouch: true,
	// More resistance than white-desert's (0.075 / 1): the page follows the finger a little more heavily (lerp) and travels 0.7 of
	// the finger's distance, so a swipe covers less of the page and the time-based motion inside it keeps up (cinematic, the
	// way the wheel is already slowed on a wide screen, see Layout.astro).
	syncTouchLerp: 0.06,
	touchInertiaExponent: 1.7,
	touchMultiplier: 0.7,
} as const;
