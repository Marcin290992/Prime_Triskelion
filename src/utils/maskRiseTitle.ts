import gsap from 'gsap';

// Mobile subpage title entrance (Projects / Services / Contact): each line
// rises out from behind its own clip (the line wrapper has overflow:
// hidden, see .title-mask in global.css), staggered, then a thin red rule
// draws in under the title. Transform-only — no blur, which is what mobile
// Safari handles worst.
export const MOBILE_TITLE_MQ = '(max-width: 1024px)';

export function maskRiseTitle(
  words: ArrayLike<HTMLElement>,
  rule: HTMLElement | null,
  delay = 0.08,
): void {
  const targets = Array.from(words);
  // The pages' scoped desktop start state (opacity 0 + blur) outranks the
  // global mobile rule on words that carry their own class — the mask
  // does the hiding here, so clear both inline.
  gsap.set(targets, { opacity: 1, filter: 'none' });
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.set(targets, { y: 0, yPercent: 0 });
    if (rule) gsap.set(rule, { scaleX: 1 });
    return;
  }
  const tl = gsap.timeline({ delay });
  // y: 0 explicitly — GSAP would otherwise read the CSS translateY(110%)
  // start state in as px and keep it on top of yPercent.
  if (targets.length) {
    tl.fromTo(targets,
      { y: 0, yPercent: 110 },
      { yPercent: 0, duration: 1.1, ease: 'power4.out', stagger: 0.12 },
      0,
    );
  }
  if (rule) {
    tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'power3.inOut' }, 0.55);
  }
}
