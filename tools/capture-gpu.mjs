// Fallback thumbnail capture using a real-GPU Chromium (headed, offscreen
// window) for scenes too heavy for SwiftShader. Usage:
//   node tools/capture-gpu.mjs slug1,slug2,...

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:5199';
const slugs = process.argv[2].split(',');

const blender = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'blender.json'), 'utf8'));

// Tighter thumbnail framing for environments (?thumb=<zoom> in the viewer);
// keep in sync with capture-thumbs.mjs.
const THUMB_ZOOM = {
  'theme-park': 1,
  'water-park': 0.55,
  'theme-park-ride-system': 1,
  'bathhouse': 1,
  'supermarket-interior': 1,
  'shopping-mall-interior': 0.85,
  'robotic-arm-assembly-cell': 1,
  'dockyard': 0.85,
};

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

let failed = 0;
for (const slug of slugs) {
  const item = blender.find((b) => b.slug === slug);
  if (!item) {
    console.error(`unknown slug ${slug}`);
    continue;
  }
  const t0 = Date.now();
  try {
    const zoom = item.group === 'environments' ? (THUMB_ZOOM[slug] ?? 1) : 0;
    await page.goto(`${BASE}/${zoom ? `?thumb=${zoom}` : ''}#/asset/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: 120_000 });
    await page.addStyleTag({ content: '.viewer-hud, .loader { display: none !important; }' });
    // Freeze animated mechanisms early in their motion (e.g. door just
    // opening) instead of capturing mid-demo where parts can be scattered.
    await page.evaluate(() => {
      const v = window.__VIEWER;
      if (v?.mixer && v.duration > 0.01) {
        v.setPlaying(false);
        v.seek(Math.min(1.0, v.duration * 0.15));
      }
    });
    await page.waitForTimeout(1200);
    const png = await page.locator('canvas').screenshot({ type: 'png', timeout: 60_000 });
    const out = path.join(ROOT, 'public', item.thumbnail);
    await sharp(png).resize(960, 540).webp({ quality: 82 }).toFile(out);
    console.log(`${slug}: ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    failed++;
    console.error(`${slug}: FAILED — ${e.message.split('\n')[0]}`);
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
