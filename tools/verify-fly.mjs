// Verify the deck opening "flying cards" beat: skip the hero with a keypress,
// then capture timed screenshots during the flight, the gathered stack, the
// intro legend, and the final deal.
import { chromium } from 'playwright-core';

const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 860);
const PREFIX = process.argv[4] || 'fly';

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (err) => console.log(`[pageerror] ${err.stack || err.message}`));

await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hero.show', { timeout: 20000 });

// hero listeners attach after its 1.7s entrance; keep pressing until heromode drops
await page.waitForTimeout(1800);
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('Escape');
  const hm = await page.evaluate(() => document.querySelector('#deck-root')?.classList.contains('heromode'));
  if (!hm) break;
  await page.waitForTimeout(200);
}
// heromode removed -> flight.run() starts ~650ms later
const t0 = Date.now();
const shots = [800, 1300, 1850, 2500, 3100, 3700, 4280];
for (let i = 0; i < shots.length; i++) {
  const wait = t0 + shots[i] - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `/tmp/${PREFIX}-${i + 1}-t${shots[i]}.png` });
  console.log(`shot ${i + 1} @ ${Date.now() - t0}ms`);
}

// intro legend beat
await page.waitForSelector('#gotIt.on', { timeout: 30000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `/tmp/${PREFIX}-8-legend.png` });
await page.click('#gotIt');

// deal completes
await page.waitForSelector('#rowLabels.on', { timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `/tmp/${PREFIX}-9-rows.png` });

// session remount: gallery and back — no hero, no legend, flight straight to deal
await page.evaluate(() => { location.hash = '#gallery'; });
await page.waitForTimeout(800);
await page.evaluate(() => { location.hash = ''; });
const t1 = Date.now();
for (const ms of [1600, 2800, 4200]) {
  const wait = t1 + ms - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `/tmp/${PREFIX}-remount-t${ms}.png` });
}
await page.waitForSelector('#rowLabels.on', { timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `/tmp/${PREFIX}-remount-rows.png` });
console.log('done');
await browser.close();
