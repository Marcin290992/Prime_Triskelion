import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initBlurReveal(emEl: HTMLElement, triggerEl?: HTMLElement, start = 'top 82%') {
	if (window.matchMedia('(max-width: 1024px)').matches) return;

	const text = emEl.textContent ?? '';
	emEl.innerHTML = '';
	emEl.style.whiteSpace = 'nowrap';

	const spans = text.split('').map(char => {
		const s = document.createElement('span');
		s.textContent = char;
		s.style.display = 'inline-block';
		emEl.appendChild(s);
		return s;
	});

	gsap.set(spans, { opacity: 0, filter: 'blur(18px)', y: () => gsap.utils.random(-14, 14) });

	ScrollTrigger.create({
		trigger: triggerEl ?? emEl,
		start,
		once: true,
		onEnter: () => {
			gsap.to(spans, {
				opacity: 1,
				filter: 'blur(0px)',
				y: 0,
				duration: 1.4,
				ease: 'power4.out',
				stagger: { each: 0.09, from: 'random' },
			});
		},
	});
}
