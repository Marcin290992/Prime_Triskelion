import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';
import { entranceMode, reducedMotion } from './afterPageTransition';

gsap.registerPlugin(ScrollTrigger);

// Mobile section reveal. Desktop has its own per-section choreography; on
// a phone that reads as lag under a fast thumb flick, so instead elements
// marked data-m-reveal (section titles, key items) come in once, the same
// light focus pull as the rest of the site: fade, rise, blur. They start
// once they're a little way into the screen (not right at its bottom edge,
// where the reveal was already over before anyone looked) and take their
// time. ScrollTrigger.batch: what enters together goes in one stagger.
// ignoreMobileResize — iOS Safari's toolbar resizing the viewport doesn't
// re-measure the triggers mid-scroll.
//
// Only what's below the first screen is hidden (set from JS, so nothing is
// ever stuck invisible without it). Back/forward and reduce motion: none —
// the page is simply there.
let triggers: ScrollTrigger[] = [];
export function initMobileReveal(): void {
	if (!window.matchMedia('(max-width: 1024px)').matches) return;
	if (entranceMode() === 'none' || reducedMotion()) return;
	const els = Array.from(document.querySelectorAll<HTMLElement>('[data-m-reveal]'))
		.filter((el) => el.getBoundingClientRect().top > window.innerHeight);
	if (!els.length) return;
	ScrollTrigger.config({ ignoreMobileResize: true });
	// transition: none while it runs — some of these carry desktop CSS
	// transitions (CTA title, work rows) that would drag every frame.
	gsap.set(els, { opacity: 0, y: 24, filter: 'blur(8px)', transition: 'none' });
	triggers = ScrollTrigger.batch(els, {
		start: 'top 82%',
		once: true,
		// Cleared at the end: a filter/transform left on a row with a photo
		// keeps it an offscreen surface iOS Safari re-renders while
		// scrolling (see .work-row in SelectedWorkSection).
		onEnter: (batch) => gsap.to(batch, {
			opacity: 1, y: 0, filter: 'blur(0px)',
			duration: 1.1, ease: 'power2.out', stagger: 0.15,
			clearProps: 'opacity,transform,filter,transition',
		}),
	});
}
document.addEventListener('astro:before-swap', () => {
	triggers.forEach((t) => t.kill());
	triggers = [];
});
