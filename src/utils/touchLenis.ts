// Scroll on phones and tablets: Lenis drives the page (syncTouch), on the same
// GSAP ticker frame as the ScrollTrigger animations, so a pinned/sticky view and
// the animation moving inside it can't drift apart while the finger's momentum
// runs (that split is what made horizontal strips jitter on iOS Safari). The
// values are the ones used on white-desert.com, which holds up on iPhones.
// autoRaf is off: the caller adds lenis.raf to gsap.ticker.
export const TOUCH_LENIS_OPTIONS = {
	autoRaf: false,
	syncTouch: true,
	syncTouchLerp: 0.06,   // was 0.075: a longer, heavier glide after the finger lifts (cinematic)
	touchInertiaExponent: 1.7,
	touchMultiplier: 0.8,   // was 1: the finger moves the page a little less, so it feels heavier and more controlled
} as const;
