// Root-cause demo: dive the shrine (populating the in-page glbCache), then
// simulate the dev server dying for GLB fetches, and dive another world.
// Expected: the shrine keeps working from cache; everything else shows the
// "dive failed" toast — matching the reported regression exactly.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console:error] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

const toastText = () =>
  page.evaluate(() => {
    const t = document.querySelector('#fx-toast');
    return t && t.classList.contains('on') ? t.textContent : null;
  });

const diveCard = async (id) => {
  await page.click(`.card[data-id="${id}"]`);
  await page.waitForTimeout(12000);
};
const exitFocus = async () => {
  await page.click('#fx-dismiss');
  await page.waitForTimeout(3000);
};

await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#gotIt.on', { timeout: 40000 });
await page.click('#gotIt');
await page.waitForSelector('.card[data-id="japanese-shrine-night-v2"]:not(.down)', { timeout: 20000 });
await page.waitForTimeout(2500);

// 1. dive the shrine with the server healthy — populates glbCache
await diveCard('japanese-shrine-night-v2');
console.log('[demo] shrine dive with live server, toast:', await toastText());
await exitFocus();

// 2. simulate the dev server dying for model fetches
await page.route('**/blender/evals/*.glb', (route) => route.abort('connectionrefused'));
await page.route('**/blender/evals/*-sky.webp', (route) => route.abort('connectionrefused'));

// 3. dive a different world — fetch fails, toast appears
await diveCard('dune-desert-village-v1');
console.log('[demo] dune dive with dead server, toast:', await toastText());
await page.screenshot({ path: '/tmp/dive-rootcause-toast.png' });
await page.waitForTimeout(4000);

// 4. shrine again — still served from the in-page cache, works
await diveCard('japanese-shrine-night-v2');
console.log('[demo] shrine dive with dead server, toast:', await toastText());
await page.screenshot({ path: '/tmp/dive-rootcause-shrine-cached.png' });

await browser.close();
