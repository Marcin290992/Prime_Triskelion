import { test, expect } from '@playwright/test';

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
