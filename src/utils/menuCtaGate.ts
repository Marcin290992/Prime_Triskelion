// Top-bar "Start a project" CTAs (TopBarCta's #site-cta-wrap, the home
// hero's #hero-nav-cta-wrap): once the menu has been opened, the CTA stays
// hidden after the menu closes and only comes back the standard way — when
// the user scrolls further down. (global.css hides it while the menu is
// open.) Scrolling back up out of the reveal zone resets it to normal.
const REVEAL_AFTER_PX = 40;

export function createMenuCtaGate(onChange: () => void) {
  let suppressed = false;
  let anchorY = 0;
  let wasOpen = document.body.classList.contains('oxygen-menu-open');

  const observer = new MutationObserver(() => {
    const open = document.body.classList.contains('oxygen-menu-open');
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) suppressed = true;
    anchorY = window.scrollY;
    onChange();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  return {
    // Whether the CTA may show, given whether it's in its reveal zone.
    allow(inZone: boolean): boolean {
      if (!suppressed) return inZone;
      if (!inZone) { suppressed = false; return false; }
      if (!wasOpen && window.scrollY > anchorY + REVEAL_AFTER_PX) { suppressed = false; return true; }
      return false;
    },
    destroy() {
      observer.disconnect();
    },
  };
}
