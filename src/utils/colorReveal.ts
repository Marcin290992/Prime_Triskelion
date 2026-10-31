// Colour under the cursor: a black & white photo (the <img> in the page)
// shows its real colours where the pointer is, with a short fading trail.
// A click or tap sends a wave out across the whole photo that CHANGES it:
// the colour stays, and now the cursor turns the photo grey where it goes.
// Another click sends the wave back the other way — grey again, colour under
// the cursor again.
//
// Leaving the photo resets it: once more than half of it has scrolled out of
// view (down to the text, up to the next section) the colour fades away to
// grey, so whenever you come back it is grey again. Scrolling back to the
// photo's entrance resets it at once.
//
// Plain Canvas 2D, no dependencies: a colour copy of the photo is drawn on a
// canvas laid over the <img>, cut by a soft mask that is redrawn from scratch
// every frame (the base state, the wave, and the cursor's stamps XOR-ed on
// top), so nothing accumulates or leaves ghosts. It only runs frames while
// something moves and stops again — no permanent rAF loop.
//
// The photo is framed like the <img> underneath it (object-fit: cover and
// the given focus), so the two line up pixel for pixel.

export interface ColorRevealOpts {
	radius?: number;   // CSS px, the colour under the cursor
	softness?: number; // 0..1, how much of the radius is the soft edge
	linger?: number;   // seconds the trail stays
	focusX?: number;   // object-position of the <img>, 0..1
	focusY?: number;
	// Gate: the reveal only shows while this returns true (e.g. the photo's
	// entrance animation has finished and the canvas would not line up).
	isReady?: () => boolean;
}

const MASK_SCALE = 0.5;     // the mask is drawn at half size and scaled up (soft anyway)
const WAVE_SECONDS = 1.4;
const SPRITE = 256;

export function initColorReveal(host: HTMLElement, img: HTMLImageElement, opts: ColorRevealOpts = {}): () => void {
	const radius = opts.radius ?? 170;
	const softness = opts.softness ?? 0.6;
	const linger = opts.linger ?? 1;
	const focusX = opts.focusX ?? 0.5;
	const focusY = opts.focusY ?? 0.5;
	const isReady = opts.isReady ?? (() => true);

	const canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;filter:contrast(1.1) brightness(0.9)';
	host.appendChild(canvas);
	const ctx = canvas.getContext('2d');
	const maskCanvas = document.createElement('canvas');
	const mctx = maskCanvas.getContext('2d');
	const cursorCanvas = document.createElement('canvas'); // the cursor's stamps, before they are XOR-ed in
	const cctx = cursorCanvas.getContext('2d');
	if (!ctx || !mctx || !cctx) { canvas.remove(); return () => {}; }

	// One soft disc, stamped for the cursor and its trail.
	const sprite = document.createElement('canvas');
	sprite.width = sprite.height = SPRITE;
	{
		const sctx = sprite.getContext('2d')!;
		const g = sctx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
		const core = Math.max(0, 1 - softness);
		for (let i = 0; i <= 12; i++) {
			const t = i / 12;
			const k = core + (1 - core) * t;
			g.addColorStop(k, `rgb(255 255 255 / ${(0.5 + 0.5 * Math.cos(Math.PI * t)).toFixed(3)})`);
		}
		g.addColorStop(0, 'rgb(255 255 255 / 1)');
		sctx.fillStyle = g;
		sctx.fillRect(0, 0, SPRITE, SPRITE);
	}

	let color: HTMLImageElement | null = null;
	let cssW = 1;
	let cssH = 1;
	let dpr = 1;
	let raf = 0;
	let last = 0;
	let visible = true;
	let presence = 0;
	const pointer = { x: 0, y: 0, inside: false, fresh: true };
	const head = { x: 0, y: 0 };
	let lastStamp: { x: number; y: number } | null = null;
	const stamps: { x: number; y: number; t: number }[] = [];
	// The base state: false = grey photo (colour under the cursor), true =
	// colour photo (grey under the cursor). A click's wave flips it.
	let colored = false;
	let wave: { x: number; y: number; t: number } | null = null;
	let inView = true;                       // more than half of the photo on screen
	let fadeTimer = 0;                       // a reset fading out is under way
	const FADE_MS = 700;

	const load = () => {
		const src = img.currentSrc || img.src;
		if (!src || color?.src === new URL(src, location.href).href) return;
		const c = new Image();
		c.decoding = 'async';
		c.onload = () => { color = c; wake(); };
		c.src = src;
	};
	if (img.complete && img.naturalWidth) load();
	img.addEventListener('load', load);

	const layout = () => {
		cssW = Math.max(1, host.clientWidth);
		cssH = Math.max(1, host.clientHeight);
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(cssW * dpr);
		canvas.height = Math.round(cssH * dpr);
		maskCanvas.width = Math.max(2, Math.round(cssW * MASK_SCALE));
		maskCanvas.height = Math.max(2, Math.round(cssH * MASK_SCALE));
		cursorCanvas.width = maskCanvas.width;
		cursorCanvas.height = maskCanvas.height;
	};

	// The wave: full inside, a soft edge at the front; it runs until it has
	// covered the whole photo, then the base state flips for good.
	const drawWave = (w: { x: number; y: number; t: number }, now: number) => {
		const k = Math.min(1, (now - w.t) / 1000 / WAVE_SECONDS);
		const width = Math.max(60, radius * 0.9);
		const reach = Math.hypot(Math.max(w.x, cssW - w.x), Math.max(w.y, cssH - w.y)) + width * 1.1;
		const r = reach * Math.sin((k * Math.PI) / 2);
		const outer = r + width * 0.35;
		if (outer <= 0) return;
		const g = mctx!.createRadialGradient(w.x, w.y, 0, w.x, w.y, outer);
		g.addColorStop(0, 'rgb(255 255 255 / 1)');
		g.addColorStop(Math.max(0, (r - width) / outer), 'rgb(255 255 255 / 1)');
		g.addColorStop(1, 'rgb(255 255 255 / 0)');
		mctx!.fillStyle = g;
		mctx!.fillRect(0, 0, cssW, cssH);
	};

	const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);

	// Back to grey, now.
	const hardReset = () => {
		window.clearTimeout(fadeTimer);
		fadeTimer = 0;
		colored = false;
		wave = null;
		stamps.length = 0;
		canvas.style.transition = 'none';
		canvas.style.opacity = '1';
		clear();
	};
	// Back to grey, fading out (the photo is scrolling away). Runs to the end
	// whatever the scroll does meanwhile, so it is grey on return.
	const softReset = () => {
		if (fadeTimer || (!colored && !wave)) return;
		canvas.style.transition = `opacity ${FADE_MS}ms ease`;
		canvas.style.opacity = '0';
		fadeTimer = window.setTimeout(hardReset, FADE_MS + 30);
	};

	const frame = (now: number) => {
		raf = 0;
		const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
		last = now;

		if (!isReady() || !color) { hardReset(); return; }

		presence += ((pointer.inside ? 1 : 0) - presence) * (1 - Math.exp(-dt / 0.16));
		if (pointer.fresh) { head.x = pointer.x; head.y = pointer.y; pointer.fresh = false; }
		else {
			const follow = 1 - Math.exp(-dt / 0.035);
			head.x += (pointer.x - head.x) * follow;
			head.y += (pointer.y - head.y) * follow;
		}
		if (presence > 0.02 && (!lastStamp || Math.hypot(head.x - lastStamp.x, head.y - lastStamp.y) > radius * 0.2)) {
			lastStamp = { x: head.x, y: head.y };
			stamps.push({ x: head.x, y: head.y, t: now });
		}
		if (!pointer.inside && presence < 0.02) lastStamp = null;
		while (stamps.length && (now - stamps[0].t) / 1000 >= linger) stamps.shift();
		if (wave && (now - wave.t) / 1000 >= WAVE_SECONDS) { colored = !colored; wave = null; }

		// The mask, from scratch: the base state (+ the wave flipping it), then
		// the cursor's trail XOR-ed on top — so the cursor always shows the
		// opposite of whatever the photo is at that spot.
		mctx.setTransform(1, 0, 0, 1, 0, 0);
		mctx.globalCompositeOperation = 'source-over';
		mctx.globalAlpha = 1;
		mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
		mctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
		mctx.fillStyle = '#fff';
		if (colored) mctx.fillRect(0, 0, cssW, cssH);
		if (wave) {
			mctx.globalCompositeOperation = colored ? 'destination-out' : 'source-over';
			drawWave(wave, now);
			mctx.globalCompositeOperation = 'source-over';
		}

		cctx.setTransform(1, 0, 0, 1, 0, 0);
		cctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
		cctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
		for (const s of stamps) {
			const life = 1 - (now - s.t) / 1000 / linger;
			cctx.globalAlpha = life * life;
			cctx.drawImage(sprite, s.x - radius, s.y - radius, radius * 2, radius * 2);
		}
		if (presence > 0.002) {
			const r = radius * (0.45 + 0.55 * presence);
			cctx.globalAlpha = presence;
			cctx.drawImage(sprite, head.x - r, head.y - r, r * 2, r * 2);
		}
		cctx.globalAlpha = 1;
		mctx.setTransform(1, 0, 0, 1, 0, 0);
		mctx.globalCompositeOperation = 'xor';
		mctx.drawImage(cursorCanvas, 0, 0);
		mctx.globalCompositeOperation = 'source-over';

		// The colour photo, framed like the <img>, cut by the mask.
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = 'source-over';
		clear();
		const W = canvas.width;
		const H = canvas.height;
		const scale = Math.max(W / color.naturalWidth, H / color.naturalHeight);
		const dw = color.naturalWidth * scale;
		const dh = color.naturalHeight * scale;
		ctx.drawImage(color, (W - dw) * focusX, (H - dh) * focusY, dw, dh);
		ctx.globalCompositeOperation = 'destination-in';
		ctx.drawImage(maskCanvas, 0, 0, W, H);
		ctx.globalCompositeOperation = 'source-over';

		const busy = pointer.inside || presence > 0.002 || stamps.length > 0 || wave !== null;
		if (busy && visible) raf = requestAnimationFrame(frame);
		else if (!colored) clear(); // grey and idle: nothing to show (colour stays as drawn)
	};

	function wake() {
		if (raf || !visible) return;
		last = performance.now();
		raf = requestAnimationFrame(frame);
	}

	const locate = (e: PointerEvent) => {
		const rect = host.getBoundingClientRect();
		pointer.x = (e.clientX - rect.left) * (cssW / (rect.width || 1));
		pointer.y = (e.clientY - rect.top) * (cssH / (rect.height || 1));
	};
	const onMove = (e: PointerEvent) => {
		if (e.pointerType === 'touch') return; // a finger is scrolling, not hovering
		locate(e);
		if (!pointer.inside) { pointer.inside = true; pointer.fresh = true; }
		wake();
	};
	const onLeave = () => { pointer.inside = false; wake(); };
	const startWave = () => {
		if (wave) return; // one wave at a time
		wave = { x: pointer.x, y: pointer.y, t: performance.now() };
		wake();
	};
	// A mouse starts the wave on press. A finger only on a TAP (lifted soon,
	// without having moved): swiping across the photo is scrolling, not a click.
	let tap: { x: number; y: number; t: number } | null = null;
	const onDown = (e: PointerEvent) => {
		if (!isReady() || !inView) return;
		if (e.pointerType === 'touch') {
			tap = { x: e.clientX, y: e.clientY, t: performance.now() };
			return;
		}
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		locate(e);
		startWave();
	};
	const onUp = (e: PointerEvent) => {
		const down = tap;
		tap = null;
		if (!down || e.pointerType !== 'touch' || !isReady() || !inView) return;
		if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || performance.now() - down.t > 500) return;
		locate(e);
		startWave();
	};
	const onCancel = () => { tap = null; onLeave(); };
	host.addEventListener('pointermove', onMove, { passive: true });
	host.addEventListener('pointerenter', onMove, { passive: true });
	host.addEventListener('pointerleave', onLeave, { passive: true });
	host.addEventListener('pointercancel', onCancel, { passive: true });
	host.addEventListener('pointerup', onUp, { passive: true });
	host.addEventListener('pointerdown', onDown, { passive: true });

	const resizeObserver = new ResizeObserver(() => { layout(); wake(); });
	resizeObserver.observe(host);
	const intersectionObserver = new IntersectionObserver(([entry]) => {
		visible = entry.isIntersecting;
		inView = entry.intersectionRatio >= 0.5;
		if (!inView) softReset();
		if (visible) wake();
	}, { threshold: [0, 0.25, 0.5, 0.75, 1] });
	intersectionObserver.observe(host);
	// Scrolled back to the photo's entrance (it scales and fades in there): the
	// colour layer would not line up, so it goes at once.
	const onScroll = () => { if ((colored || wave) && !fadeTimer && !isReady()) hardReset(); };
	window.addEventListener('scroll', onScroll, { passive: true });
	layout();

	return () => {
		window.clearTimeout(fadeTimer);
		window.removeEventListener('scroll', onScroll);
		cancelAnimationFrame(raf);
		resizeObserver.disconnect();
		intersectionObserver.disconnect();
		img.removeEventListener('load', load);
		host.removeEventListener('pointermove', onMove);
		host.removeEventListener('pointerenter', onMove);
		host.removeEventListener('pointerleave', onLeave);
		host.removeEventListener('pointercancel', onCancel);
		host.removeEventListener('pointerup', onUp);
		host.removeEventListener('pointerdown', onDown);
		canvas.remove();
	};
}
