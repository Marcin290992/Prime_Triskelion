export function onReady(fn: () => void, delay = 150): void {
	document.addEventListener('astro:page-load', () => {
		setTimeout(fn, delay);
	});
}
