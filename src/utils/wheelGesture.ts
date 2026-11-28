// A mouse wheel / trackpad as steps: one gesture = one step, shared by the touch stages (introStage.ts, workStage.ts).
//
// A gesture is a run of wheel events less than `gapMs` apart: a trackpad's inertia tail, or a mouse wheel spun quickly. It
// makes ONE step, at its start. Two things start a new step: a pause (a gap longer than `gapMs`, so single notches half a
// second apart each step), or an event clearly stronger than the one before (a new push riding on the tail of the last).
// Steps are never closer than `stepMs`.
//
// (A single "cooldown since the last event" does not work: every ignored event would extend it, and notches 500 ms apart
// would never step.)

export interface WheelGestureOptions {
	min?: number;      // smallest delta that counts
	gapMs?: number;    // events closer than this belong to one gesture
	stepMs?: number;   // least time between two steps
	boost?: number;    // an event this many times stronger than the previous one starts a new step
}

export function createWheelGesture(onStep: (dir: 1 | -1) => void, options: WheelGestureOptions = {}) {
	const { min = 8, gapMs = 160, stepMs = 500, boost = 1.5 } = options;
	let last = 0, lastStep = 0, lastStrength = 0;
	return (e: WheelEvent) => {
		const now = performance.now();
		const strength = Math.abs(e.deltaY);
		const fresh = now - last > gapMs;
		const stronger = strength > lastStrength * boost;
		last = now;
		lastStrength = strength;
		if (strength < min || now - lastStep < stepMs || !(fresh || stronger)) return;
		lastStep = now;
		onStep(e.deltaY > 0 ? 1 : -1);
	};
}
