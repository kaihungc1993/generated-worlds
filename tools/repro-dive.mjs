// Repro script: dive a failing world and capture console/pageerror/network.
import { chromium } from 'playwright-core';

const CARD_ID = process.argv[2] || 'dune-desert-village-v1';

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });

page.on('console', (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => console.log(`[pageerror] ${err.stack || err.message}`));
page.on('response', async (res) => {
  const url = res.url();
  if (res.status() >= 400 || url.includes('/blender/') || url.includes('/draco/') || url.includes('.glb')) {
    const headers = res.headers();
    console.log(
      `[response] ${res.status()} ${url} type=${headers['content-type'] || '?'} size=${headers['content-length'] || '?'}`
    );
  }
});
page.on('requestfailed', (req) => {
  console.log(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText}`);
});

await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
// hero auto-advances (~4s), then riffle, then the intro legend beat holds
// until the #gotIt "Explore" button is clicked; only then are rows dealt
await page.waitForSelector('#gotIt.on', { timeout: 40000 });
await page.click('#gotIt');
console.log('[script] clicked Explore');
// wait for the deal to finish (cards flipped face-up in rows)
await page.waitForSelector(`.card[data-id="${CARD_ID}"]:not(.down)`, { timeout: 20000 });
await page.waitForTimeout(2500);
await page.click(`.card[data-id="${CARD_ID}"]`);
console.log('[script] clicked card', CARD_ID);

// wait for toast or successful dive
await page.waitForTimeout(15000);
const toastText = await page
  .evaluate(() => {
    const t = document.querySelector('.toast, [class*="toast"]');
    return t ? t.textContent : null;
  })
  .catch(() => null);
console.log('[script] toast:', toastText);

await page.screenshot({ path: `/tmp/dive-repro-${CARD_ID}.png` });
await browser.close();
