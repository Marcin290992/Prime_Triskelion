import gsap from 'gsap';
import { entranceMode, reducedMotion } from './afterPageTransition';

// Mobile section reveal. Desktop has its own per-section choreography; on
// a phone that reads as lag under a fast thumb flick, so instead elements
// marked data-m-reveal (section titles, key items) come in once, the same
// light focus pull as the rest of the site: fade, 12px rise, 5px blur,
// 0.6s. Started early (as they cross the bottom of the screen) so nobody
// waits for content. IntersectionObserver, not ScrollTrigger — nothing to
// re-measure when iOS Safari's toolbar resizes the viewport.
//
// Only what's below the first screen is hidden (set from JS, so nothing is
// ever stuck invisible without it). Back/forward and reduce motion: none —
// the page is simply there.
export function initMobileReveal(): void {
	if (!window.matchMedia('(max-width: 1024px)').matches) return;
	if (entranceMode() === 'none' || reducedMotion()) return;
	const els = Array.from(document.querySelectorAll<HTMLElement>('[data-m-reveal]'))
		.filter((el) => el.getBoundingClientRect().top > window.innerHeight);
	if (!els.length) return;
	// transition: none while it runs — some of these carry desktop CSS
	// transitions (CTA title, work rows) that would drag every frame.
	gsap.set(els, { opacity: 0, y: 12, filter: 'blur(5px)', transition: 'none' });
	const io = new IntersectionObserver((entries) => {
		const shown = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
		if (!shown.length) return;
		shown.forEach((el) => io.unobserve(el));
		// Cleared at the end: a filter/transform left on a row with a photo
		// keeps it an offscreen surface iOS Safari re-renders while
		// scrolling (see .work-row in SelectedWorkSection).
		gsap.to(shown, {
			opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out', stagger: 0.08,
			clearProps: 'opacity,transform,filter,transition',
		});
	}, { rootMargin: '0px 0px -6% 0px' });
	els.forEach((el) => io.observe(el));
	document.addEventListener('astro:before-swap', () => io.disconnect(), { once: true });
}
