#!/usr/bin/env node
// Copies the reference photos each Fable asset run was generated from
// (blender_articulated_asset_generation/runs/<run>/inputs/...) into
// public/concepts/<slug>-ref-<n>.webp and MERGES the entries into
// public/data/concepts.json as arrays (slug -> [paths...]), keeping the
// existing Opus/worlds single-image entries intact.
//
// le-creuset-stackable-ramekins is intentionally absent: it reuses the
// original Opus asset and keeps its concept image from
// tools/fetch-concepts-blender.mjs.
//
// workbench-power-scene is also absent: its reference slot plays the Isaac
// Sim robot-simulation trailer instead (public/concepts/
// workbench-demo-trailer.mp4, transcoded 1080p60 -> 720p30 via
//   ffmpeg -i .../IsaacSim/work_dir/workbench/demo_shots/out/demo_trailer.mp4
//     -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -crf 25
//     -pix_fmt yuv420p -movflags +faststart -an <out>
// ); its concepts.json entry is kept by the merge below.
//
// Usage: node tools/fetch-concepts-fable.mjs
// Env: FABLE_RUNS_ROOT to override the runs tree location.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_ROOT = process.env.FABLE_RUNS_ROOT
  || path.resolve(ROOT, '..', 'blender_articulated_asset_generation', 'runs');

// slug -> ordered reference images (first = hero/front shot).
// Each entry: { file: <path relative to RUNS_ROOT>, crop?: { top?, bottom? } }
// crop values are fractions of image height trimmed away (caption bands etc).
const SOURCES = {
  'samsung-rf28r-refrigerator': [
    { file: 'samsung_fridge_rf28r/inputs/augmented/images/reference_front_ajmadison.png' },
    { file: 'samsung_fridge_rf28r/inputs/reference_back.png' },
  ],
  'samsung-wa50r-washer': [
    { file: 'samsung_washer_hose_clips/inputs/white-samsung-smart-washers-wa50r5200aw-d4_1000.jpg' },
    { file: 'samsung_washer_hose_clips/inputs/white-samsung-smart-washers-wa50r5200aw-76_1000.jpg' },
    { file: 'samsung_washer_hose_clips/inputs/white-samsung-smart-washers-wa50r5200aw-a0_1000.jpg' },
  ],
  'lv-bisten-55': [
    { file: 'lv_bisten_55/inputs/reference_0.webp' },
    { file: 'lv_bisten_55/inputs/reference_7.webp' },
    { file: 'lv_bisten_55/inputs/reference_8.webp' },
  ],
  'bambu-lab-p1s-combo': [
    // Official render carries a "*The picture shows the AMS..." caption band.
    { file: 'bambu_p1s_combo/inputs/augmented/images/reference_official_p1s_combo_front.jpg', crop: { bottom: 0.08 } },
    { file: 'bambu_p1s_combo/inputs/augmented/images/reference_review_p1s_combo_techadvisor.jpg' },
  ],
  'towerpro-sg90-servo': [
    { file: 'sg90_servo/inputs/augmented/images/reference_sg90_official_analog.jpg' },
    { file: 'sg90_servo/inputs/augmented/images/reference_sg90_dimensions_af.jpg' },
  ],
  // Only the front photo with the "30 fl oz" label (user request).
  'kraft-real-mayo': [
    { file: 'kraft_mayo_30oz/inputs/product_photo_front.png' },
  ],
  'serenity-medicine-box': [
    { file: 'medicine_box_serenity/inputs/ref_latch_dial_open_lid.png' },
    // Listing frame with a headline band baked into the top; trim it.
    { file: 'medicine_box_serenity/inputs/ref_open_cantilever_trays.png', crop: { top: 0.13 } },
  ],
};

const OUT_DIR = path.join(ROOT, 'public/concepts');
const MANIFEST = path.join(ROOT, 'public/data/concepts.json');
const MAX_WIDTH = 1024;
const WEBP_QUALITY = 82;

mkdirSync(OUT_DIR, { recursive: true });

const added = {};
const missing = [];
for (const [slug, refs] of Object.entries(SOURCES)) {
  const paths = [];
  for (const [i, ref] of refs.entries()) {
    const input = path.join(RUNS_ROOT, ref.file);
    if (!existsSync(input)) {
      missing.push(`${slug} (missing: ${input})`);
      continue;
    }
    let img = sharp(input);
    const meta = await img.metadata();
    if (ref.crop) {
      const top = Math.round(meta.height * (ref.crop.top || 0));
      const bottom = Math.round(meta.height * (ref.crop.bottom || 0));
      img = img.extract({ left: 0, top, width: meta.width, height: meta.height - top - bottom });
    }
    const name = `${slug}-ref-${i + 1}.webp`;
    await img
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(path.join(OUT_DIR, name));
    paths.push(`concepts/${name}`);
    console.log(`ok ${slug} [${i + 1}/${refs.length}] <- ${ref.file}`);
  }
  if (paths.length) added[slug] = paths;
}

// Merge with the existing manifest (Opus/worlds entries stay single strings).
const existing = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const merged = Object.fromEntries(
  Object.entries({ ...existing, ...added }).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(MANIFEST, JSON.stringify(merged, null, 2) + '\n');
console.log(`Wrote ${MANIFEST} with ${Object.keys(merged).length} entries (+${Object.keys(added).length})`);
if (missing.length) {
  console.log(`MISSING:\n  ${missing.join('\n  ')}`);
  process.exitCode = 1;
}
