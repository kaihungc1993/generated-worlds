import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
await page.goto('http://localhost:5199/#/asset/dishwasher', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: 30000 });
await page.waitForTimeout(1000);

// pause playback, then seek to deterministic clip times (clip ~4.17s):
// dense sampling through the door swing (1.25-2.58s) plus rack phase + ends.
await page.evaluate(() => window.__VIEWER.setPlaying(false));
const times = [0.0, 0.8, 1.3, 1.6, 1.9, 2.2, 2.4, 2.55, 2.8, 3.3, 3.8, 4.15];
for (const t of times) {
  await page.evaluate((tt) => window.__VIEWER.seek(tt), t);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/dw-fix-t${t.toFixed(2)}.png` });
}
await browser.close();
console.log('SHOTS_OK');
