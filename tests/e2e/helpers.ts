import type { Page } from '@playwright/test';

// Preloader.astro's #preloader no longer auto-hides — ENTER only becomes
// clickable once real readiness resolves (fonts + window load + min time),
// and dismissing it is a deliberate user click, not an automatic transition.
// Every test that needs to interact with the page underneath has to get
// through this gate first.
export async function dismissPreloader(page: Page) {
  const enterBtn = page.locator('#pl-enter');
  await enterBtn.waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const btn = document.getElementById('pl-enter') as HTMLButtonElement | null;
    return !!btn && !btn.disabled;
  });
  await enterBtn.click();
  await page.locator('#preloader').waitFor({ state: 'hidden' });
}
