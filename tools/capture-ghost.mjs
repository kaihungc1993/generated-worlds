// Captures promo shots of the playable Godot demo (start screen + in-game).
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: false, args: ['--window-position=-3000,-3000', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://localhost:5199/play/ghost/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(25000);
await page.screenshot({ path: '/tmp/ghost-title.png' });

await page.mouse.click(800, 495); // PLAY
await page.waitForTimeout(30000); // loading screen -> street

// nudge camera up a touch and settle
await page.keyboard.down('w');
await page.waitForTimeout(1200);
await page.keyboard.up('w');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/ghost-street.png' });

await browser.close();
console.log('captured');
