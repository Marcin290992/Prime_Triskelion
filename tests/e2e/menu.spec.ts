import { test, expect } from '@playwright/test';
import { dismissPreloader } from './helpers';

// Regression guard for the "both hamburger and contact button visible /
// unclickable at once" bug — took several iterations to actually fix (see
// oxygenMenu.ts / OxygenMenu.astro's .hud-scroll-hidden class history), so
// this is worth pinning down in CI rather than trusting a human to notice
// on a real tablet again.

test('desktop: menu opens on click and closes on Escape', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop-only interaction');

  // Not '/' — HeroSection.astro runs its own multi-second entrance timeline
  // there that independently animates #hud-menu-btn's opacity (see
  // menu.spec.ts's mobile test comment below), which would race this test.
  // /contact has no such competing animation.
  await page.goto('/contact');
  // Preloader sits above everything (z-index 100000) until ENTER is
  // clicked — without dismissing it, the click below lands on the gate
  // instead of the button.
  await dismissPreloader(page);
  const overlay = page.locator('#ox-menu-overlay');
  await expect(overlay).not.toHaveClass(/active/);

  await page.locator('#hud-menu-btn').click();
  await expect(overlay).toHaveClass(/active/);

  await page.keyboard.press('Escape');
  await expect(overlay).not.toHaveClass(/active/);
});

test('mobile: scrolling down hides the menu button and shows contact (never both, never neither)', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only scroll-swap behavior');

  // Not '/' — HeroSection.astro's own entrance timeline animates
  // #hud-menu-btn's opacity from 0 to 1 over ~1.6s+ as part of its
  // choreographed intro (see HeroSection.astro's `hudMenu` tweens), which
  // would make the "opacity is 1 at rest" baseline assertion below flaky/
  // timing-dependent. /contact has no such competing animation — it only
  // goes through oxygenMenu.ts's plain showHeader(), which never touches
  // hud-menu-btn's own opacity.
  await page.goto('/contact');
  await dismissPreloader(page);
  await page.waitForTimeout(500); // let resetHudMenuBtn() / showHeader() settle

  const menuBtn = page.locator('#hud-menu-btn');
  const contactBtn = page.locator('.hud-contact-link');

  async function state() {
    return page.evaluate(() => {
      const menu = document.getElementById('hud-menu-btn')!;
      const contact = document.querySelector('.hud-contact-link')!;
      const cs = (el: Element) => getComputedStyle(el);
      return {
        menuOpacity: cs(menu).opacity,
        menuClickable: cs(menu).pointerEvents !== 'none',
        contactOpacity: cs(contact).opacity,
        contactClickable: cs(contact).pointerEvents !== 'none',
      };
    });
  }

  // At the top: menu visible+clickable, contact hidden+unclickable.
  let s = await state();
  expect(s.menuOpacity).toBe('1');
  expect(s.menuClickable).toBe(true);
  expect(s.contactOpacity).toBe('0');
  expect(s.contactClickable).toBe(false);

  // Scroll down past the threshold — contact should take over, menu should
  // fully step aside (not just visually fade while staying clickable, and
  // not linger half-visible).
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(500);

  s = await state();
  expect(s.menuOpacity).toBe('0');
  expect(s.menuClickable).toBe(false);
  expect(s.contactOpacity).toBe('1');
  expect(s.contactClickable).toBe(true);
  await expect(menuBtn).toBeVisible(); // still in the DOM, just non-interactive/invisible via opacity
  void contactBtn;

  // Scroll back up — should cleanly reverse, not leave both states mixed.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  s = await state();
  expect(s.menuOpacity).toBe('1');
  expect(s.menuClickable).toBe(true);
  expect(s.contactOpacity).toBe('0');
  expect(s.contactClickable).toBe(false);
});
