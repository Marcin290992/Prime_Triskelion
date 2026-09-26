// "Has the user started leaving this page?" — for delayed entrance bits
// (the Projects/Services "scroll" hint) that must not start on a page
// that's on its way out. Navigation itself (astro:before-preparation) is
// too late: a menu link first plays its roll + close animation (~1s, see
// oxygenMenu.ts) before calling navigate(), and the old page shows
// through meanwhile — a hint whose timer fired then faded in just before
// the swap cut it away. So the tap on any internal link counts too.
export function trackLeaving(): () => boolean {
  let leaving = false;
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (a && a.origin === location.origin && !a.target) leaving = true;
  };
  const onPrepare = () => { leaving = true; };
  document.addEventListener('click', onClick, true);
  document.addEventListener('astro:before-preparation', onPrepare);
  document.addEventListener('astro:before-swap', () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('astro:before-preparation', onPrepare);
  }, { once: true });
  return () => leaving;
}
