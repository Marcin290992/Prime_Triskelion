import { test, expect, type Page } from '@playwright/test';

// Selected work: the pinned beam carousel has to dock exactly on a picture after a
// scroll gesture (wheel on desktop, a swipe on touch) and must let the page leave
// in both directions. The geometry mirrors SelectedWorkSection.astro (LEAD 0.8
// screens of title, then PER 1 screen per picture).

const LEAD = 0.8;
const PER = 1;

async function geometry(page: Page) {
  return page.evaluate(({ LEAD, PER }) => {
    const wrap = document.getElementById('sw-scroll-section')!;
    const vh = window.innerHeight;
    const screens = parseFloat(wrap.style.getPropertyValue('--screens'));
    const length = screens - 1;
    const start = wrap.getBoundingClientRect().top + window.scrollY;
    const unit = (wrap.offsetHeight - vh) / length;
    const n = Number(wrap.dataset.n);
    return { start, unit, n, LEAD, PER };
  }, { LEAD, PER });
}

const posAt = (g: Awaited<ReturnType<typeof geometry>>, y: number) => ((y - g.start) / g.unit - g.LEAD) / g.PER;
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

async function waitIntro(page: Page) {
  // the home page's intro locks scroll (html overflow hidden) for a few seconds
  await page.waitForFunction(() => document.documentElement.style.overflow !== 'hidden', null, { timeout: 25_000 });
  await page.waitForTimeout(500);
}

async function jumpTo(page: Page, y: number) {
  await page.evaluate((y) => {
    const l = (window as any).__lenis;
    if (l) l.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo(0, y);
  }, y);
  await page.waitForTimeout(800);
}

async function gesture(page: Page, isMobile: boolean, dir: 1 | -1, amount: number) {
  if (isMobile) {
    // Lenis drives touch itself (syncTouch), so a real finger is needed: dispatch
    // touchstart / touchmove / touchend on the element under the finger.
    await page.evaluate(async ({ dir, amount }) => {
      const x = 200, y0 = 650;
      const target = document.elementFromPoint(x, y0) || document.body;
      const mk = (type: string, y: number) => {
        const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
        return new TouchEvent(type, {
          touches: type === "touchend" ? [] : [touch],
          targetTouches: type === "touchend" ? [] : [touch],
          changedTouches: [touch],
          bubbles: true, cancelable: true,
        });
      };
      target.dispatchEvent(mk("touchstart", y0));
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, 16));
        target.dispatchEvent(mk("touchmove", y0 - dir * (amount * i) / steps));
      }
      target.dispatchEvent(mk("touchend", y0 - dir * amount));
    }, { dir, amount });
  } else {
    await page.mouse.move(640, 360);
    for (let i = 0; i < Math.round(amount / 100); i++) {
      await page.mouse.wheel(0, dir * 100);
      await page.waitForTimeout(40);
    }
  }
}

test('selected work docks on a picture after a scroll gesture', async ({ page, isMobile }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await waitIntro(page);
  const g = await geometry(page);

  // start on the first picture, then scroll on by a little less than one picture
  await jumpTo(page, g.start + (g.LEAD + g.PER * 1) * g.unit);
  const before = posAt(g, await scrollY(page));
  expect(Math.abs(before - 1)).toBeLessThan(0.1);

  await gesture(page, isMobile, 1, 500);
  await page.waitForTimeout(4500);
  const p1 = posAt(g, await scrollY(page));
  console.log(`after gesture: pos = ${p1.toFixed(3)}`);
  expect(Math.abs(p1 - Math.round(p1))).toBeLessThan(0.04);   // on a stop, not between two
  expect(Math.round(p1)).toBeGreaterThanOrEqual(1);
  expect(Math.round(p1)).toBeLessThanOrEqual(Math.min(2, g.n));   // one gesture, one picture on

  // and it stays there
  await page.waitForTimeout(600);
  expect(Math.abs(posAt(g, await scrollY(page)) - p1)).toBeLessThan(0.01);
});

test('selected work lets the page leave forwards and back', async ({ page, isMobile }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await waitIntro(page);
  const g = await geometry(page);

  // last picture, then keep scrolling on: the page must carry on past the section
  await jumpTo(page, g.start + (g.LEAD + g.PER * g.n) * g.unit);
  const lastStop = await scrollY(page);
  for (let i = 0; i < 4; i++) {
    await gesture(page, isMobile, 1, 900);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  const after = await scrollY(page);
  console.log(`last stop ${lastStop.toFixed(0)}, after scrolling on ${after.toFixed(0)}`);
  expect(after).toBeGreaterThan(lastStop + 300);

  // and back up through the whole section to the title and out of the top
  for (let i = 0; i < 28; i++) {
    await gesture(page, isMobile, -1, 900);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1500);
  const top = await scrollY(page);
  console.log(`back at ${top.toFixed(0)} (section starts ${g.start.toFixed(0)})`);
  expect(top).toBeLessThan(g.start);
});
