// In-memory HTML cache for page navigations.
//
// Astro's prefetch doesn't actually save the request on the real site: the
// HTML is served with `Cache-Control: max-age=0, must-revalidate`
// (netlify.toml), so the router's fetch on navigate still has to go back to
// Netlify and revalidate — on a phone connection that round trip is the
// black wait between the menu closing and the new page appearing.
//
// warmPages() fetches pages ahead of time into memory, and the fetch wrapper
// below hands the router that response instead of hitting the network. It
// only lives for this tab and TTL_MS, so it can't serve HTML from an older
// deploy than the assets already running here.

const TTL_MS = 60_000;
const cache = new Map<string, { t: number; res: Promise<Response> }>();
const nativeFetch = window.fetch.bind(window);

function keyOf(href: string): string | null {
	try {
		const u = new URL(href, location.href);
		if (u.origin !== location.origin) return null;
		return u.pathname.replace(/\/$/, '') + u.search;
	} catch {
		return null;
	}
}

function fresh(key: string) {
	const hit = cache.get(key);
	if (hit && performance.now() - hit.t < TTL_MS) return hit;
	cache.delete(key);
	return null;
}

export function warmPages(hrefs: Iterable<string>): void {
	for (const href of hrefs) {
		const key = keyOf(href);
		if (key === null || key === keyOf(location.href) || fresh(key)) continue;
		const res = nativeFetch(href, { credentials: 'same-origin' }).then((r) => {
			if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) throw new Error();
			return r;
		});
		res.catch(() => cache.delete(key));
		res.then((r) => r.clone().text()).then(preloadAssets, () => {});
		cache.set(key, { t: performance.now(), res });
	}
}

// A page's first visit was still slower than later ones: the router won't
// show the new page until its own stylesheet has loaded, and its scripts
// and hero images come after that — all network on a phone. Preload them
// as soon as the page's HTML is in, so the first visit is as quick as a
// repeat one. Hashed /_astro files, so the HTTP cache keeps them.
const preloaded = new Set<string>();
function preloadAssets(html: string): void {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const add = (href: string | null, rel: string, as?: string, media?: string | null) => {
		if (!href || preloaded.has(href)) return;
		preloaded.add(href);
		const link = document.createElement('link');
		link.rel = rel;
		link.href = href;
		if (as) link.as = as;
		if (media) link.media = media;
		document.head.appendChild(link);
	};
	doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((l) => add(l.getAttribute('href'), 'preload', 'style'));
	doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]').forEach((s) => add(s.getAttribute('src'), 'modulepreload'));
	doc.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]').forEach((l) => add(l.getAttribute('href'), 'preload', 'image', l.getAttribute('media')));
}

// Warm the menu's pages shortly after each page settles too, not only when
// the menu opens — gives a first visit more head start on a slow connection.
document.addEventListener('astro:page-load', () => {
	setTimeout(() => {
		const links = document.querySelectorAll<HTMLAnchorElement>('#ox-menu-overlay a[href]');
		const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 0));
		idle(() => warmPages([...links].map((a) => a.href)));
	}, 1500);
});

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
	const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
	if (method === 'GET' && !init?.body && !(input instanceof Request)) {
		const key = keyOf(String(input));
		const hit = key !== null ? fresh(key) : null;
		// Each use gets its own clone; a failed warm-up falls back to the network.
		if (hit) return hit.res.then((r) => r.clone(), () => nativeFetch(input, init));
	}
	return nativeFetch(input, init);
};
