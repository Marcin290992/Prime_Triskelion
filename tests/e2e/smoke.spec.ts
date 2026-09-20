import { test, expect } from '@playwright/test';
import { dismissPreloader } from './helpers';

// Just enough to catch "the build succeeded but the page is actually
// broken" — a blank screen, a thrown client-side error, a 404 where a page
// should be. Not a design/content review.
const pages = ['/', '/about', '/contact', '/projects', '/services', '/winds-of-sinai'];

for (const path of pages) {
  test(`${path} loads without a client-side error`, async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    const response = await page.goto(path, { waitUntil: 'load' });
    expect(response?.ok(), `${path} should respond 2xx`).toBeTruthy();

    // OxygenMenu is on every page via Layout.astro — if this exists, the
    // shared layout + its script at least mounted without crashing.
    await expect(page.locator('#hud-menu-btn')).toBeVisible();

    expect(pageErrors, `${path} threw: ${pageErrors.map((e) => e.message).join('; ')}`).toHaveLength(0);
  });
}

test('preloader: ENTER is disabled until ready, then dismisses the gate on click', async ({ page }) => {
  await page.goto('/');

  // Not asserting an exact percentage here — it's a fast-moving counter,
  // so pinning "0%" right after goto is a race against real elapsed time,
  // not a meaningful check. Disabled-until-ready is the real contract.
  const enterBtn = page.locator('#pl-enter');
  await expect(enterBtn).toBeDisabled();

  await dismissPreloader(page);

  await expect(page.locator('#pl-percent')).toHaveText('100%');
  await expect(page.locator('#preloader')).toBeHidden();
});

test('preloader does not reappear stuck-visible after an internal navigation', async ({ page }) => {
  // Regression guard: #preloader needs transition:persist (Preloader.astro).
  // Without it, Astro's router builds a brand-new, fully-visible preloader
  // element on every internal nav with no script left to ever hide it —
  // reported as "click the logo, preloader turns on and freezes".
  await page.goto('/');
  await dismissPreloader(page);

  await page.locator('#h-title').click();
  await page.waitForTimeout(800);

  await expect(page.locator('#preloader')).toBeHidden();
});
