#!/usr/bin/env node
// Downloads concept/reference art for the Blender asset + greybox scene cards
// (public/data/blender.json) and converts it to public/concepts/<slug>-concept.webp,
// then MERGES the entries into public/data/concepts.json (keeping the
// Generated Worlds entries written by tools/fetch-concepts.mjs intact).
//
// Sources:
//  - Eval runs on eval.development.moonlakeai.com: each result's project ships the
//    concept art it was generated from at assets/images/concept_art.png.
//  - Local blender-agent run folders for items whose pipelines didn't go through
//    the eval platform (product references / scene concept art on disk).
//
// Usage: node tools/fetch-concepts-blender.mjs
// Requires: wos_session dev cookie access to development.moonlakeai.com,
//           local ~/blender-agent folders for the LOCAL entries.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const COOKIE = 'wos_session=dev-session-token';
const EVAL_API = 'https://eval.development.moonlakeai.com/api/eval/runs';
const DEV_API = 'https://development.moonlakeai.com/api/projects';
const CONCEPT_PATH = 'assets/images/concept_art.png';

// Eval runs holding the concept art for each card category.
const RUNS = {
  articulatedObjects: '47a42742-f7cf-412e-afc9-1a02bbddbdca', // Concept Art Articulated Objects 20260427
  articulatedObjectsAlt: 'b0b5db1b-8bb0-4002-8370-eb4f2b1d459c', // same dataset, earlier run (has paper-cup art)
  articulatedScenes: 'caf4e9de-dca3-4be3-bb01-6b49a77027d0', // Concept Art Articulated Indoor Scenes 20260427
  interiors: '0605d038-c1eb-49f9-b490-741f7c66e8ef', // Blender Alpha Concept Art Eval — Interior Scenes
  outdoor: '17fd44d3-6902-4ac3-be36-a37f648d0127', // Blender Alpha Concept Art Eval — Outdoor Scenes
  diverseScenes: 'cbec2757-921a-4f82-abb3-0252032e0293', // Blender Alpha Concept Art Eval — Diverse Scenes
  productObjects: '4cc19fce-5f5a-48d5-b1f5-919d852f1caa', // Blender Alpha Concept Art Eval — Product Objects
};

// slug -> { run, promptId } (eval-sourced) or { file, crop? } (local-sourced).
const HOME = process.env.HOME;
const SOURCES = {
  'bedside-table-with-drawer': { run: 'articulatedObjects', promptId: 'bedside-table-with-drawer-20260427' },
  dishwasher: { run: 'articulatedObjects', promptId: 'dishwasher-20260427' },
  'office-chair': { run: 'articulatedObjects', promptId: 'office-chair-20260427' },
  'paper-cup': { run: 'articulatedObjectsAlt', promptId: 'paper-cup-20260427' },
  'plastic-parts-bin-drawer-cabinet': { run: 'articulatedObjects', promptId: 'plastic-parts-bin-drawer-cabinet-20260427' },
  'small-conveyor-gate': { run: 'articulatedObjects', promptId: 'small-conveyor-gate-20260427' },
  'wireless-earbuds-charging-case': { run: 'productObjects', promptId: 'wireless-earbuds-charging-case' },
  'robotic-arm-assembly-cell': { run: 'articulatedScenes', promptId: 'robotic-arm-assembly-cell-20260427' },
  'shopping-mall-interior': { run: 'interiors', promptId: 'shopping-mall-interior' },
  'supermarket-interior': { run: 'interiors', promptId: 'supermarket-interior' },
  'theme-park': { run: 'outdoor', promptId: 'theme-park' },
  'water-park': { run: 'outdoor', promptId: 'water-park' },
  'theme-park-ride-system': { run: 'diverseScenes', promptId: 'theme-park-ride-system' },
  // Local pipelines (blender-agent runs that didn't publish to the eval platform).
  bathhouse: { file: `${HOME}/blender-agent/20260330-164959-bathhouse-entrance-courtyard/main/assets/images/concept_art.png` },
  dockyard: { file: `${HOME}/blender-agent/blender_v2/20260420_114942_dockyard/main/assets/images/concept_art.png` },
  'le-creuset-stackable-ramekins': { file: `${HOME}/blender-agent/blender_v2/run_20260622_193019_bowl/main/image.png` },
  'organic-mayonnaise-jar': { file: `${HOME}/blender-agent/blender_v2/run_20260622_195022_mayo/main/image.png` },
  // Video-frame reference; crop away the caption bands baked into the frame.
  'motor-assembly': { file: `${HOME}/blender-agent/blender_v2/run_20260623T235301Z_motor_assembly/main/image.png`, crop: { top: 0.07, bottom: 0.16 } },
};

const OUT_DIR = 'public/concepts';
const MANIFEST = 'public/data/concepts.json';
const MAX_WIDTH = 1024;
const WEBP_QUALITY = 82;

function curl(url, outFile) {
  const args = ['-s', '-b', COOKIE, url];
  if (outFile) args.push('-o', outFile);
  return execFileSync('curl', args, { encoding: outFile ? 'buffer' : 'utf8' });
}

// Resolve eval-sourced slugs to project ids.
const projectByRun = {};
for (const [key, runId] of Object.entries(RUNS)) {
  const data = JSON.parse(curl(`${EVAL_API}/${runId}`));
  projectByRun[key] = new Map(
    data.results.filter((r) => r.project_id).map((r) => [r.prompt_id, r.project_id]),
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const stage = path.join(tmpdir(), 'portfolio-concepts-blender');
mkdirSync(stage, { recursive: true });

const added = {};
const missing = [];
for (const [slug, src] of Object.entries(SOURCES)) {
  let input;
  if (src.file) {
    if (!existsSync(src.file)) {
      missing.push(`${slug} (local file missing: ${src.file})`);
      continue;
    }
    input = src.file;
  } else {
    const projectId = projectByRun[src.run].get(src.promptId);
    if (!projectId) {
      missing.push(`${slug} (no project for prompt ${src.promptId})`);
      continue;
    }
    input = path.join(stage, `${slug}.img`);
    curl(`${DEV_API}/${projectId}/code/file/download?path=${CONCEPT_PATH}`, input);
  }

  let img = sharp(input);
  let meta;
  try {
    meta = await img.metadata();
  } catch {
    const head = readFileSync(input).subarray(0, 80).toString('utf8');
    missing.push(`${slug} (not an image: ${head.replace(/\s+/g, ' ').slice(0, 60)})`);
    continue;
  }
  if (!meta.width || meta.width < 100) {
    missing.push(`${slug} (bad image: ${JSON.stringify(meta.format)})`);
    continue;
  }
  if (src.crop) {
    const top = Math.round(meta.height * src.crop.top);
    const bottom = Math.round(meta.height * src.crop.bottom);
    img = img.extract({ left: 0, top, width: meta.width, height: meta.height - top - bottom });
  }

  const out = path.join(OUT_DIR, `${slug}-concept.webp`);
  await img
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(out);
  added[slug] = `concepts/${slug}-concept.webp`;
  console.log(`ok ${slug} <- ${src.file ? 'local' : `eval:${src.run}`}`);
}

// Merge with the existing manifest (worlds entries come from fetch-concepts.mjs).
const existing = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const merged = Object.fromEntries(
  Object.entries({ ...existing, ...added }).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(MANIFEST, JSON.stringify(merged, null, 2) + '\n');
console.log(`Wrote ${MANIFEST} with ${Object.keys(merged).length} entries (+${Object.keys(added).length})`);
if (missing.length) console.log(`MISSING:\n  ${missing.join('\n  ')}`);
