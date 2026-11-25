// The frame light (utils/frameBorder.ts) as the hover of a button, in place of the border comets (starBorder.js
// leaves a button alone when it carries `data-frame-fx`; its turning beam stays at rest and goes out while the light is up,
// see global.css). A
// mouse entering the button starts it the way the Split Cards' frames start: the line draws itself round the outline
// and a pulse runs from the bottom; the light then drifts along the edge for as long as the cursor stays, and goes
// out with it. A finger tapping it sets off the same start, which fades again.
//
// In the white of the hero's rays. Two kinds of button carry the attribute:
//   data-frame-fx          the light is the hover (the hero's "Start a project");
//   data-frame-fx="state"   the light is a STATE, up for as long as the button has the class `active` (the MENU button,
//                          while the menu is open); hovering it does nothing extra.
import { createFrameBorder, type FrameBorderControl } from './frameBorder';

const SELECTOR = '[data-frame-fx]';
let items: Array<{ fb: FrameBorderControl; off: () => void }> = [];
const STATE_BUTTON_BLEED = 10;   // the MENU chip does not clip, so its light may spill a little outside

function destroyAll() {
	items.forEach((i) => { i.off(); i.fb.destroy(); });
	items = [];
}

// The HOVER version is for a wide screen with a mouse: there is no hover on a phone or tablet, and a tap on a CTA leaves
// the page at once, so it would hardly be seen. There the CTAs keep their own beam and the touch comets (starBorder.js).
// The STATE version (the MENU button while the menu is open) stays on every screen.
const SMALL = '(max-width: 1024px), (hover: none) and (pointer: coarse)';

function initAll() {
	destroyAll();
	const small = window.matchMedia(SMALL).matches;
	document.querySelectorAll<HTMLElement>(SELECTOR).forEach((btn) => {
		// The button clips its children (overflow: hidden), so the light lives inside the edge: no bleed.
		const asState = btn.getAttribute('data-frame-fx') === 'state';
		if (small && !asState) return;
		const fb = createFrameBorder(btn, {
			colors: ['#FFFFFF', '#B9BEC8'],   // the light of the hero's rays (#ffffff, falling off into a cool grey)
			radius: 0,
			lineWidth: 1.2,
			bleed: asState ? STATE_BUTTON_BLEED : 0,
			glow: 0.55,
			glowWidth: 22,
			noise: 0.8,
			intensity: 1,
			idlePulses: 0,
			intro: true,
			pulseSpeed: 1.3,
		});
		if (!fb) return;
		fb.setOpacity(0);
		// the same start as the Split Cards' frames: the line draws itself in, and a pulse runs from the bottom
		const start = () => {
			fb.replay();
			fb.pulse(btn.clientWidth / 2, btn.clientHeight);
		};
		let tapTimer = 0;
		const onOver = (e: PointerEvent) => {
			if (e.pointerType !== 'mouse') return;
			if (e.relatedTarget && btn.contains(e.relatedTarget as Node)) return;
			btn.classList.add('frame-fx-on');
			fb.setOpacity(1);
			start();
		};
		const onOut = (e: PointerEvent) => {
			if (e.pointerType !== 'mouse') return;
			if (e.relatedTarget && btn.contains(e.relatedTarget as Node)) return;
			btn.classList.remove('frame-fx-on');
			fb.setOpacity(0);
		};
		const onDown = (e: PointerEvent) => {
			if (e.pointerType === 'mouse') return;
			window.clearTimeout(tapTimer);
			btn.classList.add('frame-fx-on');
			fb.setOpacity(1);
			start();
			tapTimer = window.setTimeout(() => { fb.setOpacity(0); btn.classList.remove('frame-fx-on'); }, 1300);
		};
		// A state button follows its `active` class (the menu being open); a hover button, the pointer.
		let observer: MutationObserver | null = null;
		let lit = false;
		const syncState = () => {
			const want = btn.classList.contains('active');
			if (want === lit) return;
			lit = want;
			btn.classList.toggle('frame-fx-on', want);
			fb.setOpacity(want ? 1 : 0);
			if (want) start();
		};
		if (asState) {
			observer = new MutationObserver(syncState);
			observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
			syncState();
		} else {
			btn.addEventListener('pointerover', onOver);
			btn.addEventListener('pointerout', onOut);
			btn.addEventListener('pointerdown', onDown);
		}
		items.push({
			fb,
			off: () => {
				window.clearTimeout(tapTimer);
				observer?.disconnect();
				btn.classList.remove('frame-fx-on');
				btn.removeEventListener('pointerover', onOver);
				btn.removeEventListener('pointerout', onOut);
				btn.removeEventListener('pointerdown', onDown);
			},
		});
	});
}

document.addEventListener('astro:page-load', initAll);
document.addEventListener('astro:before-swap', destroyAll);
