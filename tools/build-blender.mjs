// Optimizes Blender-exported GLBs into public/blender/<collection>/ and
// writes public/data/blender.json with metadata (title, prompt, stats).
//
// Expects GLBs under /tmp/blend-glb/<collection>/ (see export-blends.sh)
// and generation prompts as .md files next to the source .blend files.
//
// Usage: node tools/build-blender.mjs [--force]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB_ROOT = '/tmp/blend-glb';
const SRC_ROOT = '/tmp/blender-assets';
// Baked World panoramas (tools/bake-sky.py) for environment scenes; converted
// to <slug>-sky.webp next to the GLB. Studio-object collections (articulated/
// diverse/product) never get skies. A missing PNG is fine: scenes keep their
// already-shipped webp, or no sky at all (trivial/near-black Worlds are
// deliberately not baked — the studio backdrop reads better there).
const SKY_ROOT = '/tmp/env-skies';
const FORCE = process.argv.includes('--force');

// Curated keep list for the objects galleries (articulated/diverse/product):
// only these slugs ship.
// Mirrors the KEEP-set curation in tools/build-evals.mjs.
const OBJECT_KEEP = new Set([
  'bedside-table-with-drawer',
  'dishwasher',
  'le-creuset-stackable-ramekins',
  'motor-assembly',
  'office-chair',
  'organic-mayonnaise-jar',
  'paper-cup',
  'plastic-parts-bin-drawer-cabinet',
  'small-conveyor-gate',
  'wireless-earbuds-charging-case',
]);

// Curated keep list for the Simulation Environments section
// (scenes/interiors/outdoor collections): only these slugs ship.
const ENV_KEEP = new Set([
  'theme-park',
  'water-park',
  'supermarket-interior',
  'shopping-mall-interior',
  'theme-park-ride-system',
  'robotic-arm-assembly-cell',
  'dockyard',
  'bathhouse',
]);

// Per-slug viewer flags: animations that read better bouncing back and forth
// (open -> close) than snapping back to the start each loop.
const LOOP_PINGPONG = new Set(['dishwasher', 'motor-assembly']);

// collection id -> { dir with GLBs, dir with .md prompts, display group }
const COLLECTIONS = {
  articulated: { glbs: 'articulated', prompts: 'articulated-objects', group: 'objects', label: 'Articulated' },
  diverse: { glbs: 'diverse', prompts: 'diverse-objects', group: 'objects', label: 'Industrial' },
  product: { glbs: 'product', prompts: 'product-objects', group: 'objects', label: 'Product' },
  scenes: { glbs: 'scenes', prompts: 'diverse-scenes', group: 'environments', label: 'Simulation' },
  interiors: { glbs: 'interiors', prompts: 'interiors', group: 'environments', label: 'Interior' },
  outdoor: { glbs: 'outdoor', prompts: 'outdoor', group: 'environments', label: 'Outdoor' },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

// Titles the slug heuristic can't produce (brand casing, dropped words).
const TITLE_OVERRIDES = {
  'le-creuset-stackable-ramekins': 'Le Creuset Stackable Ramekins',
  'organic-mayonnaise-jar': 'Organic Mayonnaise',
};

function titleFromSlug(slug) {
  if (TITLE_OVERRIDES[slug]) return TITLE_OVERRIDES[slug];
  return slug
    .split('-')
    .map((w) => (w.length > 2 || ['ac', 'tv'].includes(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/\bOr\b/g, 'or')
    .replace(/\bWith\b/g, 'with')
    .replace(/\bAmr\b/g, 'AMR')
    .replace(/\bScifi\b/g, 'Sci-Fi');
}

function findPrompt(promptsDir, slug) {
  if (!fs.existsSync(promptsDir)) return null;
  const files = fs.readdirSync(promptsDir).filter((f) => f.endsWith('.md'));
  const match = files.find((f) => f === `${slug}.md` || f.startsWith(`${slug}-2026`) || f.startsWith(slug));
  if (!match) return null;
  return fs.readFileSync(path.join(promptsDir, match), 'utf8').trim();
}

const items = [];
let inTotal = 0;
let outTotal = 0;

for (const [collection, cfg] of Object.entries(COLLECTIONS)) {
  const srcDir = path.join(GLB_ROOT, cfg.glbs);
  if (!fs.existsSync(srcDir)) {
    console.warn(`missing ${srcDir}, skipping ${collection}`);
    continue;
  }
  const outDir = path.join(ROOT, 'public', 'blender', collection);
  fs.mkdirSync(outDir, { recursive: true });

  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.glb')).sort()) {
    const slug = path.basename(file, '.glb');
    if (cfg.group === 'objects' && !OBJECT_KEEP.has(slug)) continue;
    if (cfg.group === 'environments' && !ENV_KEEP.has(slug)) continue;
    const src = path.join(srcDir, file);
    const out = path.join(outDir, file);

    let document;
    try {
      document = await io.read(src);
    } catch (e) {
      console.error(`read failed ${file}: ${e.message}`);
      continue;
    }
    const animations = document.getRoot().listAnimations().length;
    let polys = 0;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        polys += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
      }
    }

    if (FORCE || !fs.existsSync(out) || fs.statSync(out).mtimeMs <= fs.statSync(src).mtimeMs) {
      try {
        await document.transform(
          dedup(),
          prune(),
          textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [1024, 1024] }),
          draco({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 10 }),
        );
        await io.write(out, document);
      } catch (e) {
        console.error(`optimize failed ${file}: ${e.message} — copying as-is`);
        fs.copyFileSync(src, out);
      }
    }

    // Skybox: baked Blender World as an equirect webp (glTF can't carry it).
    let sky = null;
    if (cfg.group === 'environments') {
      const skyPng = path.join(SKY_ROOT, `${slug}.png`);
      const skyWebp = path.join(outDir, `${slug}-sky.webp`);
      if (fs.existsSync(skyPng) && (FORCE || !fs.existsSync(skyWebp) || fs.statSync(skyWebp).mtimeMs <= fs.statSync(skyPng).mtimeMs)) {
        await sharp(skyPng).resize(2048, 1024).webp({ quality: 80 }).toFile(skyWebp);
      }
      if (fs.existsSync(skyWebp)) sky = `blender/${collection}/${slug}-sky.webp`;
    }

    inTotal += fs.statSync(src).size;
    outTotal += fs.statSync(out).size;
    items.push({
      slug,
      collection,
      group: cfg.group,
      badge: cfg.label,
      title: titleFromSlug(slug),
      prompt: findPrompt(path.join(SRC_ROOT, cfg.prompts), slug),
      url: `blender/${collection}/${file}`,
      thumbnail: `blender/${collection}/${slug}.webp`,
      sky,
      animated: animations > 0,
      ...(LOOP_PINGPONG.has(slug) ? { loopPingPong: true } : {}),
      polys: Math.round(polys),
      sizeKB: Math.round(fs.statSync(out).size / 1024),
    });
  }
  console.log(`${collection}: ${items.filter((i) => i.collection === collection).length} items`);
}

fs.mkdirSync(path.join(ROOT, 'public', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public', 'data', 'blender.json'), JSON.stringify(items, null, 2));
console.log(`\n${items.length} items, ${(inTotal / 1e6).toFixed(0)} MB -> ${(outTotal / 1e6).toFixed(0)} MB`);
