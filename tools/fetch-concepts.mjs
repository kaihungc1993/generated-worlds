#!/usr/bin/env node
// Downloads the concept-art reference image for each "Generated Worlds" eval
// project and converts it to public/blender/evals/<slug>-concept.webp, then
// writes public/data/concepts.json (slug -> webp path).
//
// Usage: node tools/fetch-concepts.mjs
// Requires: wos_session dev cookie access to development.moonlakeai.com

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const COOKIE = 'wos_session=dev-session-token';
const EVAL_API = 'https://eval.development.moonlakeai.com/api/eval/runs';
const DEV_API = 'https://development.moonlakeai.com/api/projects';
const CONCEPT_PATH = 'scenes/1/artifacts/concept_art/scene_reference.png';
const RUNS = [
  { id: '65561cdc-6e7a-4ae6-b645-c2b37213ad23', suffix: 'v1' },
  { id: '7ecaa3c8-2e1c-4fd3-be0a-bc9bf6a19283', suffix: 'v2' },
];
// Curated keep list — must match the KEEP set in tools/build-evals.mjs.
const KEEP = new Set([
  'avatar-pandora-forest-v1',
  'dune-desert-village-v1',
  'elden-ring-castle-v2',
  'gta5-los-santos-v1',
  'japanese-shrine-night-v2',
  'post-apocalyptic-city-v2',
  'zelda-breath-of-the-wild-village-v1',
]);

const OUT_DIR = 'public/blender/evals';
const MANIFEST = 'public/data/concepts.json';
const MAX_WIDTH = 1280;
const WEBP_QUALITY = 82;

function curl(url, outFile) {
  const args = ['-s', '-b', COOKIE, url];
  if (outFile) args.push('-o', outFile);
  return execFileSync('curl', args, { encoding: outFile ? 'buffer' : 'utf8' });
}

const mapping = [];
for (const run of RUNS) {
  const data = JSON.parse(curl(`${EVAL_API}/${run.id}`));
  for (const r of data.results) {
    const slug = `${r.prompt_id}-${run.suffix}`;
    if (!KEEP.has(slug)) continue;
    if (!r.project_id) throw new Error(`No project_id for ${slug}`);
    mapping.push({ slug, projectId: r.project_id });
  }
}
console.log(`Resolved ${mapping.length} slug -> project mappings`);

mkdirSync(OUT_DIR, { recursive: true });
const stage = path.join(tmpdir(), 'portfolio-concepts');
mkdirSync(stage, { recursive: true });

const manifest = {};
for (const { slug, projectId } of mapping) {
  const png = path.join(stage, `${slug}.png`);
  const url = `${DEV_API}/${projectId}/code/file/download?path=${CONCEPT_PATH}`;
  curl(url, png);

  const size = statSync(png).size;
  const head = readFileSync(png).subarray(0, 8);
  const isPng = head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng || size < 100 * 1024) {
    throw new Error(`Bad download for ${slug}: ${size} bytes, png=${isPng}`);
  }

  const out = path.join(OUT_DIR, `${slug}-concept.webp`);
  await sharp(png)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toFile(out);
  manifest[slug] = `blender/evals/${slug}-concept.webp`;
  console.log(`ok ${slug} (${(size / 1024).toFixed(0)}KB png -> ${(statSync(out).size / 1024).toFixed(0)}KB webp)`);
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Wrote ${MANIFEST} with ${Object.keys(sorted).length} entries`);
