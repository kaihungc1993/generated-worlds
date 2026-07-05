// Post-fix verification: dive several worlds + controls end-to-end and
// screenshot each to /tmp/dive-fix-<id>.png. Fails loudly on any toast.
import { chromium } from 'playwright-core';

const TARGETS = [
  'dune-desert-village-v1',
  'gta5-los-santos-v1',
  'post-apocalyptic-city-v2',
  'japanese-shrine-night-v2',
  'shopping-mall-interior', // greybox control
  'le-creuset-stackable-ramekins', // asset summon control
];

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});

let sawToast = null;
await page.exposeFunction('__noop', () => {});
const watchToast = async () => {
  const t = await page.evaluate(() => {
    const el = document.querySelector('#fx-toast');
    return el && el.classList.contains('on') ? el.textContent : null;
  });
  if (t) sawToast = t;
};

await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#gotIt.on', { timeout: 40000 });
await page.click('#gotIt');
await page.waitForSelector('.card:not(.down)', { timeout: 20000 });
await page.waitForTimeout(2500);

let failed = 0;
for (const id of TARGETS) {
  sawToast = null;
  errors.length = 0;
  await page.click(`.card[data-id="${id}"]`);
  // poll for the failure toast while the summon/dive choreography runs
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(500);
    await watchToast();
  }
  const caption = await page.evaluate(() => {
    const c = document.querySelector('#fx-caption');
    return c && c.classList.contains('on')
      ? { title: c.querySelector('.t')?.textContent, kind: c.querySelector('.k')?.textContent }
      : null;
  });
  const concept = await page.evaluate(() =>
    document.querySelector('#fx-concept')?.classList.contains('on') ?? false
  );
  await page.screenshot({ path: `/tmp/dive-fix-${id}.png` });
  const ok = !sawToast && caption;
  if (!ok) failed++;
  console.log(
    `${id}: ${ok ? 'OK' : 'FAILED'} — toast=${sawToast ?? 'none'}, caption=${caption ? `${caption.kind} / ${caption.title}` : 'MISSING'}, conceptPanel=${concept}` +
      (errors.length ? `, errors: ${errors.join(' | ')}` : '')
  );
  await page.click('#fx-dismiss');
  await page.waitForTimeout(3500);
}

await browser.close();
if (failed) {
  console.error(`${failed} target(s) failed`);
  process.exit(1);
}
console.log('all targets verified');
