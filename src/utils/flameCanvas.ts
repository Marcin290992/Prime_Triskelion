// Vanilla-WebGL port of the "FlamePaths" shader (originally a React-Three-Fiber
// component) — same raw-WebGL / lifecycle pattern as #rays-canvas in HeroSection.
// This is the unmodified original algorithm and its stock "fire-like" preset.
// Shared by CtaSection and the Contact page header so both show the same flame.

export interface FlameCanvasOptions {
	/** Overall opacity of the canvas element (CSS opacity, not shader alpha). */
	opacity?: number;
	/** 'full' (default): the glowing-ember flame (Home, Contact). 'calm':
	 *  the same, slower and dimmer — a smoulder, for the pages after. */
	variant?: 'full' | 'calm';
	/** Hover-and-hold on the flame itself (desktop, mouse): a small label
	 *  follows the cursor over the flame's side of the section, and holding
	 *  the button down makes it burn hotter and faster. `zoneLeft` is where
	 *  the flame's side starts, as a fraction of the section's width. */
	burn?: { zoneLeft: number; label?: string; heldLabel?: string };
}

export function initFlameCanvas(
	canvas: HTMLCanvasElement,
	section: HTMLElement,
	options: FlameCanvasOptions = {}
) {
	const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
	if (!gl) return;

	const VERT = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;
	const highpOk = (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) > 0;
	const FRAG = `
		precision ${highpOk ? 'highp' : 'mediump'} float;
		uniform float uTime; uniform vec2 uRes; uniform float uSpeed; uniform float uCenter;
		uniform float uAmp; uniform float uFreq; uniform float uInnerFreq; uniform float uPull;
		uniform int uDir; uniform float uPowA; uniform float uPowB;
		uniform float uRedGain; uniform float uGreenGain; uniform float uBlueGain;
		uniform float uGreenPow; uniform float uBluePow; uniform float uAlpha;
		uniform vec2 uPointer; uniform float uCursorActive; uniform float uCursorIntensity; uniform float uWarp;

		const float TAU = 6.2831853;
		const float PI = 3.14159265;

		void main() {
			float aspect = uRes.x / uRes.y;
			vec2 nrm = gl_FragCoord.xy / uRes;
			vec2 st = vec2(nrm.x * aspect, nrm.y);

			if (uDir == 1) {
				st.x = aspect - st.x;
				nrm.x = 1.0 - nrm.x;
			} else if (uDir == 2) {
				float tmp = st.x;
				st.x = st.y;
				st.y = aspect - tmp;
				float ntmp = nrm.x;
				nrm.x = nrm.y;
				nrm.y = 1.0 - ntmp;
			} else if (uDir == 3) {
				float tmp = st.x;
				st.x = 1.0 - st.y;
				st.y = tmp;
				float ntmp = nrm.x;
				nrm.x = 1.0 - nrm.y;
				nrm.y = ntmp;
			}

			st.y -= uCenter;
			float t = uTime * uSpeed;

			float cursorDist = length(nrm - uPointer);
			float cursorInfluence = smoothstep(0.5, 0.0, cursorDist) * uCursorActive * uCursorIntensity;

			float localAmp = uAmp + cursorInfluence * 3.0 * uWarp; // uWarp < 1 while the flamethrower's held: thick, not crooked
			float localPowA = uPowA - cursorInfluence * 4.0;
			float localPowB = uPowB - cursorInfluence * 1.5;

			st.y *= sin(nrm.x * uFreq * TAU + t) + localAmp;
			st.y = st.x + sin(sin(st.y * uInnerFreq));
			st.x -= abs(sin(nrm.y * PI)) * uPull;
			st.x -= t;

			float combine = st.x + st.y;
			float diff = st.x - st.y;
			float cA = cos(combine);
			float cB = cos(diff);
			float fire = sqrt(pow(abs(cA), max(localPowA, 1.0)) * pow(abs(cB), max(localPowB, 1.0)));

			float intensityBoost = 1.0 + cursorInfluence * 0.5;
			vec3 col = vec3(
				fire * nrm.x * uRedGain * intensityBoost,
				pow(fire, uGreenPow) * nrm.x * uGreenGain * intensityBoost,
				pow(fire, uBluePow) * nrm.x * nrm.y * uBlueGain * intensityBoost
			);

			// Rather than painting a background color and mixing toward it
			// (which draws a smooth gradient across the whole canvas — and
			// smooth gradients band at 8-bit), leave the background fully
			// transparent and let the page's own black show through instead.
			// Nothing is drawn there, so there's nothing left to band.
			float lum = dot(col, vec3(0.299, 0.587, 0.114));
			float a = clamp(lum * 8.0, 0.0, 1.0);

			gl_FragColor = vec4(col * a, a * uAlpha);
		}
	`;

	function compile(type: number, src: string) {
		const s = gl!.createShader(type)!;
		gl!.shaderSource(s, src);
		gl!.compileShader(s);
		return s;
	}

	const prog = gl.createProgram()!;
	gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
	gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
	gl.linkProgram(prog);
	gl.useProgram(prog);

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
	const aPos = gl.getAttribLocation(prog, 'a_pos');
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	const uNames = ['uTime','uRes','uSpeed','uCenter','uAmp','uFreq','uInnerFreq','uPull','uDir','uPowA','uPowB','uRedGain','uGreenGain','uBlueGain','uGreenPow','uBluePow','uAlpha','uPointer','uCursorActive','uCursorIntensity','uWarp'];
	const U: Record<string, WebGLUniformLocation | null> = {};
	uNames.forEach(n => { U[n] = gl!.getUniformLocation(prog, n); });

	if (options.opacity !== undefined) canvas.style.opacity = String(options.opacity);

	// Started as the stock "fire-like" preset from the original component's
	// docs, direction 2 (up) since these sections are tall. Then tuned
	// towards embers rather than a bonfire: slower, and the colour pushed
	// from orange to a deep red (less green gain, and green only at the
	// hottest core), so it reads as a glow of heat in the brand's red.
	// powA/powB are left untouched — softening those is what caused the
	// ring artifact.
	const calm = options.variant === 'calm';
	const CFG = {
		speed: calm ? 0.12 : 0.18, center: 1.0, amp: 10, freq: 0.4, innerFreq: 2.5, pull: 1.0,
		dir: 2, powA: 30, powB: 10,
		redGain: calm ? 2.2 : 2.7, greenGain: calm ? 0.28 : 0.45, blueGain: 0.0,
		greenPow: calm ? 3.2 : 2.8, bluePow: 1.0,
		alpha: 1.0,
		cursorIntensity: 0.6,
	};

	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const isMobileDevice = window.matchMedia('(pointer: coarse)').matches;
	const cursorEnabled = !isMobileDevice && !reduceMotion;
	const TARGET_FRAME_MS = isMobileDevice ? 1000 / 24 : 0;

	const pointer = { x: 0.5, y: 0.5 };
	const smoothPointer = { x: 0.5, y: 0.5 };
	let cursorActive = 0;
	// Raw cursorActive flips 0/1 the instant the pointer crosses the section's
	// edge (e.g. onto a button that triggers a spurious leave/re-enter). Fed
	// straight into the shader that step would visibly snap the flame shape,
	// so it's smoothed the same way the pointer position already is.
	let smoothCursorActive = 0;
	let rafId = 0;
	let W = 0, H = 0;

	function onPointerMove(e: PointerEvent) {
		const r = section.getBoundingClientRect();
		pointer.x = (e.clientX - r.left) / r.width;
		pointer.y = 1 - (e.clientY - r.top) / r.height;
		cursorActive = 1;
	}
	function onPointerLeave() { cursorActive = 0; }

	// ── Hover-and-hold: "Hold to burn" ──
	// A label by the cursor over the flame's side of the section, and while
	// the button is held `heat` rises 0 → 1 (fast) and falls back (slowly):
	// a flamethrower — the whole flame runs several times faster and burns
	// hotter and brighter, and at the cursor it blows out into a thick jet
	// (the shader's own cursor influence, turned right up).
	const burn = cursorEnabled ? options.burn : undefined;
	const baseOpacity = parseFloat(getComputedStyle(canvas).opacity) || 0.5;
	let opacityOverridden = false;
	let heat = 0;
	let holding = false;
	let inZone = false;
	let hint: HTMLDivElement | null = null;
	let hintText = '';
	let hintX = 0, hintY = 0, hintTX = 0, hintTY = 0;
	const hintNew = { v: true };
	function zoneAt(e: PointerEvent) {
		if (!burn) return false;
		const r = section.getBoundingClientRect();
		const el = e.target as Element | null;
		return (e.clientX - r.left) / r.width >= burn.zoneLeft && !el?.closest('a, button, input, textarea, select');
	}
	function makeHint() {
		hint = document.createElement('div');
		hint.setAttribute('aria-hidden', 'true');
		hint.style.cssText =
			'position:fixed;left:0;top:0;z-index:9200;pointer-events:none;opacity:0;' +
			'transition:opacity .25s ease;will-change:transform;' +
			'font:400 10px/1 var(--f-body);letter-spacing:.38em;text-transform:uppercase;white-space:nowrap;' +
			'color:rgb(var(--c-cream)/.9);padding:.6rem .6rem .6rem .95rem;' +
			'background:rgb(var(--c-bg)/.55);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);' +
			'border:1px solid rgb(var(--c-cream)/.16);';
		document.body.appendChild(hint);
	}
	function onBurnMove(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		inZone = zoneAt(e);
		hintTX = e.clientX + 18;
		hintTY = e.clientY + 20;
		if (inZone && !hint) makeHint();
	}
	function onBurnDown(e: PointerEvent) {
		if (e.pointerType !== 'mouse' || e.button !== 0 || !zoneAt(e)) return;
		holding = true;
		e.preventDefault(); // no text selection while holding
	}
	function onBurnUp() { holding = false; }
	function onBurnLeave() { inZone = false; holding = false; }
	function updateBurn(dt: number) {
		if (!burn) return;
		heat += ((holding ? 1 : 0) - heat) * (1 - Math.exp(-dt * (holding ? 5 : 1.8)));
		// The canvas is dim on purpose (CSS opacity); a flamethrower isn't.
		if (heat > 0.004) {
			canvas.style.opacity = (baseOpacity + (0.95 - baseOpacity) * heat).toFixed(3);
			opacityOverridden = true;
		} else if (opacityOverridden) {
			canvas.style.opacity = '';
			opacityOverridden = false;
		}
		if (!hint) return;
		if (hintNew.v && inZone) { hintX = hintTX; hintY = hintTY; hintNew.v = false; }
		if (!inZone) hintNew.v = true;
		hintX += (hintTX - hintX) * 0.28;
		hintY += (hintTY - hintY) * 0.28;
		hint.style.transform = `translate3d(${hintX.toFixed(1)}px, ${hintY.toFixed(1)}px, 0)`;
		hint.style.opacity = inZone ? '1' : '0';
		const text = holding ? (burn.heldLabel ?? 'Burning') : (burn.label ?? 'Hold to burn');
		if (text !== hintText) { hintText = text; hint.textContent = text; }
	}

	if (cursorEnabled) {
		section.addEventListener('pointermove', onPointerMove);
		section.addEventListener('pointerleave', onPointerLeave);
		if (burn) {
			section.addEventListener('pointermove', onBurnMove);
			section.addEventListener('pointerdown', onBurnDown);
			section.addEventListener('pointerleave', onBurnLeave);
			window.addEventListener('pointerup', onBurnUp);
			window.addEventListener('pointercancel', onBurnUp);
		}
	}

	// Capped harder on touch devices: this is a per-pixel fragment shader
	// (sin/cos/pow/sqrt per fragment, every frame, continuously while the
	// section is in view — see the IntersectionObserver below) running on
	// top of whatever else is competing for the GPU/compositor during
	// scroll. DPR 2 on a phone that reports 2–3 is 4–9x the fragment count
	// of DPR 1, and Safari/WebKit's compositor handles that contention
	// alongside native scroll considerably worse than Chromium's does —
	// this canvas (shared by CtaSection, present on every page, and the
	// Contact header) was a real, measurable contributor to the Safari-only
	// scroll jank reported repeatedly elsewhere in this codebase. Desktop
	// keeps the original DPR 2 cap; this only tightens the mobile case.
	const maxDpr = window.matchMedia('(pointer: coarse)').matches ? 1 : 2;
	// Resizing the buffer clears it, and on a phone (24fps cap) the next
	// drawn frame can be a couple of display frames away — the flame
	// blinked out. Only resize on a real change, and redraw straight away.
	let drawn = false;
	function resize() {
		const dpr = Math.min(devicePixelRatio, maxDpr);
		const w = Math.round(canvas.offsetWidth * dpr), h = Math.round(canvas.offsetHeight * dpr);
		if (w === W && h === H) return;
		W = w; H = h;
		canvas.width = W; canvas.height = H;
		gl!.viewport(0, 0, W, H);
		if (drawn) render(elapsedTime);
	}
	function onResize() {
		if (Math.round(canvas.offsetWidth * Math.min(devicePixelRatio, maxDpr)) === W) return;
		resize();
	}
	window.addEventListener('resize', onResize, { passive: true });
	resize();
	// Same fixup as HeroSection.astro's rays-canvas: onResize()'s width-only
	// guard can leave the draw buffer sized for a stale height if this
	// section's own height depends on a viewport unit that gets corrected
	// asynchronously after a back/forward navigation (--app-stable-vh,
	// Layout.astro). One more unconditional resize once that's had time to
	// land is a harmless no-op when it wasn't needed.
	setTimeout(resize, 220);

	let lastFrameTime = 0;
	function render(t: number) {
		const follow = 0.08 - 0.05 * heat;
		smoothPointer.x += (pointer.x - smoothPointer.x) * follow;
		smoothPointer.y += (pointer.y - smoothPointer.y) * follow;
		smoothCursorActive += (cursorActive - smoothCursorActive) * 0.08;

		gl!.uniform1f(U.uTime, t);
		gl!.uniform2f(U.uRes, W, H);
		gl!.uniform1f(U.uSpeed, CFG.speed);
		gl!.uniform1f(U.uCenter, CFG.center);
		gl!.uniform1f(U.uAmp, CFG.amp);
		gl!.uniform1f(U.uFreq, CFG.freq);
		gl!.uniform1f(U.uInnerFreq, CFG.innerFreq);
		gl!.uniform1f(U.uPull, CFG.pull);
		gl!.uniform1i(U.uDir, CFG.dir);
		gl!.uniform1f(U.uPowA, CFG.powA);
		gl!.uniform1f(U.uPowB, CFG.powB);
		gl!.uniform1f(U.uRedGain, CFG.redGain * (1 + 1.1 * heat));
		gl!.uniform1f(U.uGreenGain, CFG.greenGain * (1 + 0.9 * heat));
		gl!.uniform1f(U.uBlueGain, CFG.blueGain);
		gl!.uniform1f(U.uGreenPow, CFG.greenPow * (1 - 0.3 * heat)); // hotter core: yellow comes through
		gl!.uniform1f(U.uBluePow, CFG.bluePow);
		gl!.uniform1f(U.uAlpha, CFG.alpha);
		gl!.uniform2f(U.uPointer, smoothPointer.x, smoothPointer.y);
		gl!.uniform1f(U.uCursorActive, smoothCursorActive);
		gl!.uniform1f(U.uCursorIntensity, CFG.cursorIntensity + 4.0 * heat);
		// How much the cursor bends the tongues: all of it at rest (as
		// designed), almost none under the flamethrower — the jet gets thick
		// and bright from the cursor, but doesn't swing about with the mouse.
		gl!.uniform1f(U.uWarp, 1 - 0.85 * heat);

		gl!.drawArrays(gl!.TRIANGLES, 0, 6);
	}

	// Accumulated *active* animation time, in seconds — advanced only across
	// frames that actually render. Using the raw rAF timestamp directly would
	// make the flame jump to "where it should be now" (wall-clock time) the
	// moment the loop resumes after being paused (see prevFrameTs below),
	// which reads as the pattern suddenly teleporting to a new position.
	let elapsedTime = 0;
	let prevFrameTs: number | null = null;
	function loop(ts: number) {
		if (TARGET_FRAME_MS > 0 && ts - lastFrameTime < TARGET_FRAME_MS) {
			rafId = requestAnimationFrame(loop);
			return;
		}
		lastFrameTime = ts;
		if (prevFrameTs === null) prevFrameTs = ts;
		const dtSec = (ts - prevFrameTs) * 0.001;
		elapsedTime += dtSec * (1 + 18 * heat);
		prevFrameTs = ts;
		updateBurn(Math.min(dtSec, 0.05));
		render(elapsedTime);
		drawn = true;
		rafId = requestAnimationFrame(loop);
	}

	if (reduceMotion) {
		render(0);
		document.addEventListener('astro:before-swap', () => {
			window.removeEventListener('resize', onResize);
			gl!.getExtension('WEBGL_lose_context')?.loseContext();
		}, { once: true });
		return;
	}

	let isSectionVisible = true;
	const sectionIO = new IntersectionObserver(([entry]) => {
		isSectionVisible = entry.isIntersecting;
		if (!isSectionVisible) { inZone = false; holding = false; }
		if (isSectionVisible && !document.hidden) {
			if (!rafId) rafId = requestAnimationFrame(loop);
		} else if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
			prevFrameTs = null;
		}
	}, { threshold: 0 });
	sectionIO.observe(section);

	function onVisibilityChange() {
		if (document.hidden) {
			if (rafId) { cancelAnimationFrame(rafId); rafId = 0; prevFrameTs = null; }
		} else if (isSectionVisible && !rafId) {
			rafId = requestAnimationFrame(loop);
		}
	}
	document.addEventListener('visibilitychange', onVisibilityChange);

	rafId = requestAnimationFrame(loop);

	document.addEventListener('astro:before-swap', () => {
		cancelAnimationFrame(rafId);
		sectionIO.disconnect();
		document.removeEventListener('visibilitychange', onVisibilityChange);
		window.removeEventListener('resize', onResize);
		if (cursorEnabled) {
			section.removeEventListener('pointermove', onPointerMove);
			section.removeEventListener('pointerleave', onPointerLeave);
			if (burn) {
				section.removeEventListener('pointermove', onBurnMove);
				section.removeEventListener('pointerdown', onBurnDown);
				section.removeEventListener('pointerleave', onBurnLeave);
				window.removeEventListener('pointerup', onBurnUp);
				window.removeEventListener('pointercancel', onBurnUp);
				hint?.remove();
				canvas.style.opacity = '';
			}
		}
		// Free the GPU context now rather than whenever the old canvas is
		// garbage-collected — this flame is on every page (the CTA), so each
		// navigation left one more behind, and after a few Android Chrome
		// ran short on GPU memory and animations started dropping frames.
		gl!.getExtension('WEBGL_lose_context')?.loseContext();
	}, { once: true });
}
