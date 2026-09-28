import { test, expect } from '@playwright/test';

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
  const overlay = page.locator('#ox-menu-overlay');
  await expect(overlay).not.toHaveClass(/active/);

  await page.locator('#hud-menu-btn').click();
  await expect(overlay).toHaveClass(/active/);

  await page.keyboard.press('Escape');
  await expect(overlay).not.toHaveClass(/active/);
});

// The mobile contact flyout this file used to guard (menu button vs contact
// button swapping on scroll) is gone — the HUD is just the menu button now.
// Guard the menu's navigation path on touch instead: tap MENU, tap a link,
// and the new page has to arrive with the menu closed.
test('mobile: menu opens on tap and navigates to the chosen page', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only interaction');

  // Not '/' — see the desktop test above.
  await page.goto('/contact');
  const overlay = page.locator('#ox-menu-overlay');
  await expect(overlay).not.toHaveClass(/active/);

  await page.locator('#hud-menu-btn').tap();
  await expect(overlay).toHaveClass(/active/);

  await page.locator('.ox-menu-link[href*="services"]').tap();
  await expect(page).toHaveURL(/\/services/);
  await expect(page.locator('#ox-menu-overlay')).not.toHaveClass(/active/);
  await expect(page.locator('.svc-title__word').first()).toHaveCSS('opacity', '1', { timeout: 5000 });
});
