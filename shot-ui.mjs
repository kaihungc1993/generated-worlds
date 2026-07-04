import { chromium } from 'playwright-core';

const errors = [];
const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push('[' + r.status() + '] ' + r.url()); });

const shot = (name) => page.screenshot({ path: `/tmp/ui-${name}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= LANES =================
await page.goto('http://localhost:5199/previews/lanes.html');
await sleep(2500);
await shot('lanes-1-browse');

// hover a card
const dish = await page.locator('.card[data-id="dishwasher"]').boundingBox();
await page.mouse.move(dish.x + dish.width / 2, dish.y + dish.height / 2);
await sleep(500);
await shot('lanes-2-hover');

// asset focus with rail
await page.mouse.click(dish.x + dish.width / 2, dish.y + dish.height / 2);
await sleep(4500);
await shot('lanes-3-asset-rail');

// rail jump to a world (scene) — capture mid-fade + settled
await page.evaluate(() => document.querySelector('.rail-item[data-id="japanese-shrine-night-v2"]')?.click());
await sleep(350);
await shot('lanes-4-railjump-mid');
await sleep(6000);
await shot('lanes-5-scene-rail');
await page.evaluate(() => document.getElementById('fx-dismiss')?.click());
await sleep(800);

// ================= ORBIT =================
await page.goto('http://localhost:5199/previews/orbit.html');
await sleep(3200);
await shot('orbit-1-browse');

// spin via legend to worlds
await page.evaluate(() => document.querySelector('#legend button[data-cat="worlds"]')?.click());
await sleep(1500);
await shot('orbit-2-worlds-front');

// click front card → dive ceremony → focus with rail
await page.evaluate(() => {
  // click the front-most card via its center
  const info = document.querySelector('#frontInfo .t')?.textContent;
  console.log('front card:', info);
});
await page.mouse.click(720, 500);
await sleep(12500);
await shot('orbit-3-scene-rail');

// rail jump to an asset
await page.evaluate(() => document.querySelector('.rail-item[data-id="office-chair"]')?.click());
await sleep(3500);
await shot('orbit-4-asset-rail');
await page.evaluate(() => document.getElementById('fx-dismiss')?.click());
await sleep(900);
await shot('orbit-5-back');

// ================= GRID =================
await page.goto('http://localhost:5199/previews/grid.html');
await sleep(4000);
await shot('grid-1-browse-asset');

// hover a world tile → Ken Burns preview
const tile = await page.locator('.tile[data-id="dune-desert-village-v1"]').boundingBox();
await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2);
await sleep(1200);
await shot('grid-2-scene-preview');

// Enter → dive → focus with rail
await page.evaluate(() => document.getElementById('enter')?.click());
await sleep(12500);
await shot('grid-3-scene-rail');

// rail jump to asset
await page.evaluate(() => document.querySelector('.rail-item[data-id="clamp-or-vise"]')?.click());
await sleep(3500);
await shot('grid-4-asset-rail');

// back to grid
await page.evaluate(() => document.getElementById('fx-dismiss')?.click());
await sleep(2500);
await shot('grid-5-back');

console.log('ERRORS:\n' + (errors.length ? errors.join('\n') : '(none)'));
await browser.close();
