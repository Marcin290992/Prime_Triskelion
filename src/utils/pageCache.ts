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
		cache.set(key, { t: performance.now(), res });
	}
}

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
