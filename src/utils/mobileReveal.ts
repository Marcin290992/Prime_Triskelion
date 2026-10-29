/* Phones/tablets: section titles come out of a blur once they scroll into view
   (a timed reveal, not tied to the scroll position). Plain CSS does the
   animation (.m-reveal in global.css); this only flips a class. */
const TITLES = ['.sw-header__title', '.svc__title-main', '.showcase__title', '.disc-header__title'];

let io: IntersectionObserver | null = null;

function initMobileReveal() {
	io?.disconnect();
	io = null;
	if (!window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches) return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	const els = Array.from(document.querySelectorAll<HTMLElement>(TITLES.join(',')));
	if (!els.length) return;

	const observer = new IntersectionObserver(entries => {
		entries.forEach(e => {
			if (!e.isIntersecting) return;
			e.target.classList.add('is-in');
			observer.unobserve(e.target);
		});
	}, { rootMargin: '0px 0px -18% 0px' });
	io = observer;

	els.forEach(el => {
		el.classList.add('m-reveal');
		observer.observe(el);
	});
}

document.addEventListener('astro:page-load', initMobileReveal);
document.addEventListener('astro:before-swap', () => { io?.disconnect(); io = null; });
