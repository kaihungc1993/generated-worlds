// Loads every asset in headless Chromium, waits for the viewer to
// report ready, and captures thumbnails. Also serves as a smoke test that
// everything loads without fatal errors.
//
// Requires the dev server to be running (default http://localhost:5199).
// Usage: node tools/capture-thumbs.mjs [--url http://...] [--manifest blender-fable.json] [--only slug1,slug2]

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
const manifestIdx = process.argv.indexOf('--manifest');
const manifestName = manifestIdx !== -1 ? process.argv[manifestIdx + 1] : 'blender.json';
// --scale N supersamples the capture (SwiftShader has no MSAA, so glossy
// metals speckle at 1x; 2x + downscale smooths specular aliasing).
const scaleIdx = process.argv.indexOf('--scale');
const SCALE = scaleIdx !== -1 ? Math.max(1, parseFloat(process.argv[scaleIdx + 1]) || 1) : 1;
const isFable = manifestName === 'blender-fable.json';

const blenderPath = path.join(ROOT, 'public', 'data', manifestName);
const blender = fs.existsSync(blenderPath) ? JSON.parse(fs.readFileSync(blenderPath, 'utf8')) : [];

// Tighter thumbnail framing for environments (?thumb=<zoom> in the viewer).
// 1 = the viewer's tight default; >1 pulls back for scenes with tall/wide
// extremities, <1 pushes in further.
// Animated assets whose default mid-motion settle doesn't show the best pose:
// seek to this fraction of the clip before shooting (0..1). motor-assembly's
// exploded view only fully separates near the end of its 5s clip.
const THUMB_SEEK = {
  'motor-assembly': 0.62,
  // retimed clip starts assembled (explode → hold → reassemble → sweep);
  // shoot the opening assembled hold
  'towerpro-sg90-servo': 0.02,
  // rest pose: cap screwed on, label front and clean
  'kraft-real-mayo': 0,
  // rest pose: case closed so the monogram face reads as one surface
  'lv-bisten-55': 0,
  // lid fully open and entirely inside the frame
  'samsung-wa50r-washer': 0.45,
  // rest pose: doors and drawers closed (mid-motion poses vary run to run)
  'samsung-rf28r-refrigerator': 0,
  // lid open + cantilever trays deployed, before the return sweep
  'serenity-medicine-box': 0.4,
  // seated pose: cable plugged into the supply, matching the run's hero render
  'workbench-power-scene': 0,
};

// Object-asset thumbnail views (?tv=yaw,pitch,zoom,tx,ty,tz in the viewer):
// yaw 0 = camera on +Z, pitch = elevation deg, zoom <1 dollies in,
// tx/tz offset the framing target in object radii, ty in fractions of height.
// Used for products whose hero feature (label, monogram, printed text) must
// face the camera, or that need tighter/looser framing than the default.
const THUMB_VIEW = {
  // front label (Kraft ribbon, REAL MAYO script, 30 fl oz) facing the camera
  'kraft-real-mayo': { yaw: 0, pitch: 18, zoom: 1.15, ty: 0.5 },
  // front view: embossed LE CREUSET text on the near wall
  'le-creuset-stackable-ramekins': { yaw: 0, pitch: 20, zoom: 1 },
  // monogram face in a slight three-quarter; radius is inflated by the
  // exploded first frame of other assets — LV's own box is sane, mild pull-in
  'lv-bisten-55': { yaw: 22, pitch: 14, zoom: 1.1 },
  // tight on the blue servo body (the 245 mm cable would otherwise dominate
  // the frame)
  'towerpro-sg90-servo': { yaw: 35, pitch: 15, zoom: 0.24, tx: -0.43, ty: 0.48 },
  // pulled back so the fully-open lid stays inside the 16:9 crop
  'samsung-wa50r-washer': { yaw: 43, pitch: 20, zoom: 1.5, ty: 0.6 },
  // pulled back so the open lid + deployed trays all fit
  'serenity-medicine-box': { yaw: 30, pitch: 22, zoom: 1.45, ty: 0.55 },
  // elevated three-quarter onto the tabletop so the supply/strip/cable wiring
  // reads against the splat-baked lab backdrop
  'workbench-power-scene': { yaw: 38, pitch: 26, zoom: 0.85, ty: 0.72 },
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
  const view = a.group !== 'environments' ? THUMB_VIEW[a.slug] : null;
  const params = new URLSearchParams();
  if (isFable) params.set('assets', 'fable');
  if (zoom) params.set('thumb', String(zoom));
  if (view) {
    const { yaw = 43, pitch = 25, zoom: vZoom = 1, tx = 0, ty = 0.45, tz = 0 } = view;
    params.set('tv', [yaw, pitch, vZoom, tx, ty, tz].join(','));
  }
  targets.push({
    id: a.slug,
    title: a.title,
    route: `${params.size ? `?${params}` : ''}#/asset/${a.slug}`,
    out: path.join(ROOT, 'public', a.thumbnail),
    // let animated mechanisms reach an interesting mid-motion pose
    settle: a.animated ? 2600 : 1200,
    seek: a.animated ? THUMB_SEEK[a.slug] : undefined,
    // gaussian-splat background: must actually be loaded + sorted at shot
    // time, or the room falls back to the blurry sky panorama
    splat: !!a.splat,
  });
}
const filtered = ONLY ? targets.filter((t) => ONLY.includes(String(t.id))) : targets;

// --gpu renders with the real GPU (ANGLE Metal) instead of SwiftShader.
// SwiftShader speckles on glossy normal-mapped metals (specular aliasing),
// e.g. the stainless refrigerator doors.
const USE_GPU = process.argv.includes('--gpu');
const browser = await chromium.launch({
  headless: true,
  args: USE_GPU ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: Math.round(1280 * SCALE), height: Math.round(720 * SCALE) },
  deviceScaleFactor: 1,
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

let failed = 0;
const pendingWrites = [];
for (const t of filtered) {
  errors.length = 0;
  const t0 = Date.now();
  try {
    await page.goto(`${BASE}/${t.route}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }); // ensure fresh viewer for hash routes
    await page.waitForFunction(() => window.__SCENE_READY === true, null, { timeout: 180_000 });
    await page.addStyleTag({ content: '.viewer-hud, .loader { display: none !important; }' });
    await page.waitForTimeout(t.settle);
    if (t.splat) {
      // __SCENE_READY fires when the GLB is in; the splat loads in the same
      // Promise.all but a load FAILURE is non-fatal (createSplatWorld
      // returns null) and Spark keeps sorting/refining for a few frames
      // after insertion. Without this gate a failed/late splat silently
      // ships a thumbnail whose "room" is only the blurry sky panorama.
      const ok = await page
        .waitForFunction(() => {
          const s = window.__VIEWER?.splat;
          return !!s && s.mesh?.visible !== false &&
            s.sparkRenderer?.sorting === false && s.sparkRenderer?.sortDirty === false;
        }, null, { timeout: 30_000 })
        .then(() => true, () => false);
      if (!ok) throw new Error('splat world missing or never finished sorting — thumbnail would show only the blurry sky panorama');
      // one settled frame after the last sort so the shot uses the final order
      await page.waitForTimeout(200);
    }
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
    // Defer writes into public/ until the browser is closed: the dev server
    // full-reloads open pages when public files change, which can strip the
    // HUD-hiding style (and any seek pose) from the page being shot next.
    pendingWrites.push({ out: t.out, buf: await sharp(png).resize(960, 540).webp({ quality: 82 }).toBuffer() });
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
for (const w of pendingWrites) {
  fs.mkdirSync(path.dirname(w.out), { recursive: true });
  fs.writeFileSync(w.out, w.buf);
}
if (failed) {
  console.error(`\n${failed} scene(s) failed`);
  process.exit(1);
}
console.log('\nall thumbnails captured');
