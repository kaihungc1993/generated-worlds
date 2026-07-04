// Optimizes the eval outdoor-scene GLBs (from /tmp/blend-glb/evals) into
// public/blender/evals/ and writes public/data/evals.json.
//
// These are full generated worlds (2-7M tris each), so unlike build-blender.mjs
// this pipeline also welds + simplifies meshes to keep the payload web-sized.
// Thumbnails come from the Blender EEVEE renders in /tmp/eval-renders.
//
// Usage: node tools/build-evals.mjs [--force]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB_DIR = '/tmp/blend-glb/evals';
const RENDER_DIR = '/tmp/eval-renders';
const SKY_DIR = '/tmp/eval-skies'; // baked by tools/bake-skies.sh
const PROMPTS = JSON.parse(fs.readFileSync('/tmp/eval-prompts.json', 'utf8'));
const FORCE = process.argv.includes('--force');

const RUN_DIRS = { v1: 'run1-65561cdc', v2: 'run2-7ecaa3c8' };

// Curated keep list: one world per prompt made the cut.
const KEEP = new Set([
  'avatar-pandora-forest-v1',
  'dune-desert-village-v1',
  'elden-ring-castle-v2',
  'gta5-los-santos-v1',
  'japanese-shrine-night-v2',
  'post-apocalyptic-city-v2',
  'zelda-breath-of-the-wild-village-v1',
]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ')
    .replace(/\bOf The\b/gi, 'of the')
    .replace(/\bGTA5\b/i, 'GTA V');
}

const outDir = path.join(ROOT, 'public', 'blender', 'evals');
fs.mkdirSync(outDir, { recursive: true });

const items = [];
let inTotal = 0;
let outTotal = 0;

for (const file of fs.readdirSync(GLB_DIR).filter((f) => f.endsWith('.glb')).sort()) {
  const slug = path.basename(file, '.glb'); // e.g. gta5-los-santos-v1
  if (!KEEP.has(slug)) continue;
  const run = slug.slice(-2); // v1 | v2
  const base = slug.slice(0, -3);
  const src = path.join(GLB_DIR, file);
  const out = path.join(outDir, file);

  let polys = 0;
  if (FORCE || !fs.existsSync(out) || fs.statSync(out).mtimeMs <= fs.statSync(src).mtimeMs) {
    const document = await io.read(src);
    // These are static worlds; the exporter bakes an empty scene-timeline clip
    // that would only trigger the viewer's animation UI.
    for (const anim of document.getRoot().listAnimations()) anim.dispose();
    try {
      await document.transform(
        dedup(),
        prune(),
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),
        textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 78, resize: [1024, 1024] }),
        draco({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 10 }),
      );
      await io.write(out, document);
    } catch (e) {
      console.error(`optimize failed ${file}: ${e.message} — copying as-is`);
      fs.copyFileSync(src, out);
    }
  }
  {
    const doc = await io.read(out);
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        polys += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
      }
    }
  }

  // Thumbnail from the EEVEE render.
  const render = path.join(RENDER_DIR, `${RUN_DIRS[run]}__${base}.png`);
  const thumb = path.join(outDir, `${slug}.webp`);
  if (fs.existsSync(render) && (FORCE || !fs.existsSync(thumb))) {
    await sharp(render).resize(960, 540).webp({ quality: 82 }).toFile(thumb);
  }

  // Skybox: World baked to an equirect panorama (glTF can't carry it).
  const skyPng = path.join(SKY_DIR, `${slug}.png`);
  const skyWebp = path.join(outDir, `${slug}-sky.webp`);
  if (fs.existsSync(skyPng) && (FORCE || !fs.existsSync(skyWebp) || fs.statSync(skyWebp).mtimeMs <= fs.statSync(skyPng).mtimeMs)) {
    await sharp(skyPng).resize(2048, 1024).webp({ quality: 80 }).toFile(skyWebp);
  }

  inTotal += fs.statSync(src).size;
  outTotal += fs.statSync(out).size;
  items.push({
    slug,
    collection: 'evals',
    group: 'worlds',
    badge: 'Blender world',
    title: titleFromSlug(base),
    prompt: PROMPTS[`${base}-${run}`] ?? null,
    url: `blender/evals/${file}`,
    thumbnail: `blender/evals/${slug}.webp`,
    sky: fs.existsSync(skyWebp) ? `blender/evals/${slug}-sky.webp` : null,
    animated: false,
    polys: Math.round(polys),
    sizeKB: Math.round(fs.statSync(out).size / 1024),
  });
  console.log(`${slug}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
}

fs.mkdirSync(path.join(ROOT, 'public', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public', 'data', 'evals.json'), JSON.stringify(items, null, 2));
console.log(`\n${items.length} items, ${(inTotal / 1e6).toFixed(0)} MB -> ${(outTotal / 1e6).toFixed(0)} MB`);
