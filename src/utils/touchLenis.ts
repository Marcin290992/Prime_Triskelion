// Scroll on phones and tablets: Lenis drives the page (syncTouch), on the same
// GSAP ticker frame as the ScrollTrigger animations, so a pinned/sticky view and
// the animation moving inside it can't drift apart while the finger's momentum
// runs (that split is what made horizontal strips jitter on iOS Safari). The
// values are the ones used on white-desert.com, which holds up on iPhones.
// autoRaf is off: the caller adds lenis.raf to gsap.ticker.
export const TOUCH_LENIS_OPTIONS = {
	autoRaf: false,
	syncTouch: true,
	syncTouchLerp: 0.075,
	touchInertiaExponent: 1.7,
	// 0.7: a swipe carries the page 30% less far (some resistance, a deliberate feel without fighting the finger).
	touchMultiplier: 0.7,
} as const;
