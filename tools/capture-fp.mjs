// First-person thumbnail capture for the greybox environment scenes.
// Renders eye-height candidate shots through the viewer's ?fp= capture mode
// (src/main.js parseFpParam / asset-viewer.js fpCamera) using a real-GPU
// headed Chromium, like capture-gpu.mjs.
//
// Usage:
//   node tools/capture-fp.mjs [slug,...]            # /tmp/fp-<slug>-<n>.png candidates
//   node tools/capture-fp.mjs --pick slug=n [...]   # write candidate n as the real thumbnail
//
// Positions are in each GLB's original (pre-centering) coordinates — the same
// frame the node inspector / Blender show. lookAt is converted to yaw/pitch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://localhost:5199';
const blender = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'blender.json'), 'utf8'));

// Eye-height candidates per scene: { pos, lookAt, fov? }. Scenes are metric
// (128m-ish dioramas), so eye height is ~1.6-1.8 except on raised decks.
const CANDIDATES = {
  'theme-park': [
    { pos: [0, 1.8, 112], lookAt: [0, 10, -60] }, // main street from the gate
    { pos: [0, 1.7, -12], lookAt: [-80, 25, -100] }, // hub plaza -> castle
    { pos: [-36, 1.7, 12], lookAt: [-20, 18, 50] }, // carousel -> ferris wheel
    { pos: [12, 1.7, -52], lookAt: [0, 28, -115] }, // path -> coaster mountain
    { pos: [-2, 1.7, 44], lookAt: [-22, 22, 52] }, // under the ferris wheel
    { pos: [-52, 1.7, -55], lookAt: [-85, 22, -102] }, // approach -> castle gate
  ],
  'water-park': [
    { pos: [-6, 1.7, -6], lookAt: [24, 11, -39] }, // wave-pool beach -> slide towers
    { pos: [27, 1.7, -6], lookAt: [24, 12, -39] }, // catch pool below the towers
    { pos: [6, 1.7, 8], lookAt: [-24, 4, -30] }, // splash zone -> wave pool
    { pos: [40, 1.7, 2], lookAt: [24, 10, -38] }, // cabana lawn -> towers
    { pos: [-32, 1.7, -14], lookAt: [10, 8, -35] }, // wave pool rim, wide
  ],
  'theme-park-ride-system': [
    { pos: [8, 1.7, 9], lookAt: [-4, 4, -4] }, // plaza -> station + lift
    { pos: [-12, 1.7, 7], lookAt: [8, 5, -5] }, // across the track loop
    { pos: [16, 1.7, -11], lookAt: [-6, 4, 2] }, // back corner overview
    { pos: [0, 1.7, 11], lookAt: [2, 6, -10] }, // head-on to the coaster hill
    { pos: [-13, 1.7, -10], lookAt: [10, 4, 4] }, // opposite diagonal
  ],
  'bathhouse': [
    { pos: [-10, 1.7, 24], lookAt: [0, 12, -45], fov: 68 }, // through the torii gate
    { pos: [0, 3.6, 8], lookAt: [0, 11, -45] }, // standing on the bridge
    { pos: [15, 1.7, 8], lookAt: [-2, 10, -42] }, // waterside 3/4: bridge + pagoda
    { pos: [0, 1.7, 27], lookAt: [0, 9, -45] }, // centerline approach
    { pos: [10, 1.7, -26], lookAt: [-8, 5, 18] }, // from the bathhouse, back at torii
  ],
  'supermarket-interior': [
    { pos: [2, 1.6, 2], lookAt: [2, 1.2, -14] }, // straight down an aisle
    { pos: [-11, 1.6, 8], lookAt: [8, 1.4, -8] }, // diagonal across the gondolas
    { pos: [14, 1.6, 14], lookAt: [16, 1.2, 2] }, // checkout lanes
    { pos: [8, 1.6, -9], lookAt: [17, 1.6, -16] }, // bakery corner
    { pos: [-6, 1.6, 3.2], lookAt: [-6, 1.3, -14] }, // second aisle, tighter
    { pos: [0, 1.6, 24], lookAt: [-4, 1.2, -6], fov: 70 }, // entrance overview
  ],
  'shopping-mall-interior': [
    { pos: [0, 1.65, 22], lookAt: [0, -1.5, 0] }, // concourse -> sunken fountain court
    { pos: [-20, 1.65, -6], lookAt: [8, -1.5, 4] }, // storefront row -> atrium
    { pos: [-14, 1.65, 14], lookAt: [20, 0, -18], fov: 70 }, // long diagonal across the court
    { pos: [10, 1.65, -16], lookAt: [-12, -1, 8] }, // opposite diagonal
    { pos: [0, 1.65, -13], lookAt: [0, -2.2, 2] }, // bench row above the fountain
  ],
  'dockyard': [
    { pos: [-16, 6.9, 8], lookAt: [-1, 13, -4] }, // on the pier, under the gantry
    { pos: [6, 6.9, 11], lookAt: [-4, 12, -5] }, // pier corner -> both cranes
    { pos: [12, 1.7, -16], lookAt: [-4, 12, -3] }, // yard level, looking up at crane
    { pos: [-32, 6.9, -14], lookAt: [0, 11, -2] }, // far pier end, wide
    { pos: [-10, 4.4, 22], lookAt: [-3, 12, -5] }, // loading ramp -> crane
  ],
};

const args = process.argv.slice(2);
const pickMode = args[0] === '--pick';

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-3000,-3000', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

function fpQuery({ pos, lookAt, fov = 62 }) {
  const [dx, dy, dz] = [lookAt[0] - pos[0], lookAt[1] - pos[1], lookAt[2] - pos[2]];
  const yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  return [...pos, yaw.toFixed(1), pitch.toFixed(1), fov].join(',');
}

async function shoot(slug, cand) {
  await page.goto(`${BASE}/?fp=${fpQuery(cand)}#/asset/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: 120_000 });
  await page.addStyleTag({ content: '.viewer-hud, .loader { display: none !important; }' });
  await page.waitForTimeout(1000);
  return page.locator('canvas').screenshot({ type: 'png', timeout: 60_000 });
}

let failed = 0;
if (pickMode) {
  for (const spec of args.slice(1)) {
    const [slug, nStr] = spec.split('=');
    const item = blender.find((b) => b.slug === slug);
    const cand = CANDIDATES[slug]?.[Number(nStr)];
    if (!item || !cand) {
      console.error(`bad pick ${spec}`);
      failed++;
      continue;
    }
    try {
      const png = await shoot(slug, cand);
      await sharp(png).resize(960, 540).webp({ quality: 82 }).toFile(path.join(ROOT, 'public', item.thumbnail));
      console.log(`${slug}: wrote candidate ${nStr} -> ${item.thumbnail}`);
    } catch (e) {
      failed++;
      console.error(`${slug}: FAILED — ${e.message.split('\n')[0]}`);
    }
  }
} else {
  const slugs = args[0] ? args[0].split(',') : Object.keys(CANDIDATES);
  for (const slug of slugs) {
    for (const [i, cand] of (CANDIDATES[slug] ?? []).entries()) {
      const t0 = Date.now();
      try {
        const png = await shoot(slug, cand);
        await sharp(png).png().toFile(`/tmp/fp-${slug}-${i}.png`);
        console.log(`${slug}[${i}]: ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (e) {
        failed++;
        console.error(`${slug}[${i}]: FAILED — ${e.message.split('\n')[0]}`);
      }
    }
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
