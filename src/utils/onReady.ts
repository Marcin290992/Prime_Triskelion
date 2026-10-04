import { holdRestore } from './afterPageTransition';

export function onReady(fn: () => void, delay = 150): void {
	document.addEventListener('astro:page-load', () => {
		// On back/forward the veil waits for this deferred init.
		const release = holdRestore();
		setTimeout(() => { try { fn(); } finally { release(); } }, delay);
	});
}
