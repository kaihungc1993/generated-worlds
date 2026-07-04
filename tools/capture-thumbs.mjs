// Loads every asset in headless Chromium, waits for the viewer to
// report ready, and captures thumbnails. Also serves as a smoke test that
// everything loads without fatal errors.
//
// Requires the dev server to be running (default http://localhost:5199).
// Usage: node tools/capture-thumbs.mjs [--url http://...] [--only slug1,slug2]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlIdx = process.argv.indexOf('--url');
const BASE = urlIdx !== -1 ? process.argv[urlIdx + 1] : 'http://localhost:5199';
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx !== -1 ? process.argv[onlyIdx + 1].split(',') : null;

const blenderPath = path.join(ROOT, 'public', 'data', 'blender.json');
const blender = fs.existsSync(blenderPath) ? JSON.parse(fs.readFileSync(blenderPath, 'utf8')) : [];

// Tighter thumbnail framing for environments (?thumb=<zoom> in the viewer).
// 1 = the viewer's tight default; >1 pulls back for scenes with tall/wide
// extremities, <1 pushes in further.
// Animated assets whose default mid-motion settle doesn't show the best pose:
// seek to this fraction of the clip before shooting (0..1). motor-assembly's
// exploded view only fully separates near the end of its 5s clip.
const THUMB_SEEK = {
  'motor-assembly': 0.62,
};

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

const targets = [];
for (const a of blender) {
  const zoom = a.group === 'environments' ? (THUMB_ZOOM[a.slug] ?? 1) : 0;
  targets.push({
    id: a.slug,
    title: a.title,
    route: `${zoom ? `?thumb=${zoom}` : ''}#/asset/${a.slug}`,
    out: path.join(ROOT, 'public', a.thumbnail),
    // let animated mechanisms reach an interesting mid-motion pose
    settle: a.animated ? 2600 : 1200,
    seek: a.animated ? THUMB_SEEK[a.slug] : undefined,
  });
}
const filtered = ONLY ? targets.filter((t) => ONLY.includes(String(t.id))) : targets;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

let failed = 0;
for (const t of filtered) {
  errors.length = 0;
  const t0 = Date.now();
  try {
    await page.goto(`${BASE}/${t.route}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }); // ensure fresh viewer for hash routes
    await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: 180_000 });
    await page.addStyleTag({ content: '.viewer-hud, .loader { display: none !important; }' });
    await page.waitForTimeout(t.settle);
    if (t.seek !== undefined) {
      await page.evaluate((frac) => {
        const v = window.__VIEWER;
        v.setPlaying(false);
        v.seek(v.duration * frac);
      }, t.seek);
      await page.waitForTimeout(400);
    }
    // Big scenes render slowly under SwiftShader; allow generous screenshot time.
    const canvas = page.locator('canvas');
    const png = await canvas.screenshot({ type: 'png', timeout: 150_000 });
    fs.mkdirSync(path.dirname(t.out), { recursive: true });
    await sharp(png).resize(960, 540).webp({ quality: 82 }).toFile(t.out);
    console.log(
      `${t.id} (${t.title}): ok in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
        (errors.length ? ` — ${errors.length} page errors: ${errors[0]}` : ''),
    );
  } catch (e) {
    failed++;
    console.error(`${t.id} (${t.title}): FAILED — ${e.message.split('\n')[0]}`);
    if (errors.length) console.error(`   page errors: ${errors.join(' | ')}`);
  }
}

await browser.close();
if (failed) {
  console.error(`\n${failed} scene(s) failed`);
  process.exit(1);
}
console.log('\nall thumbnails captured');
