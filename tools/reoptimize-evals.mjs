// One-off: re-optimize the 7 re-exported eval GLBs from /tmp/blend-glb/evals
// into public/blender/evals/, regenerate thumbnails from /tmp/eval-renders,
// and patch ONLY polys/sizeKB in public/data/evals.json (titles were
// hand-edited after the original build, so build-evals.mjs would clobber them).
// Transform chain matches tools/build-evals.mjs exactly.
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
const RUN_DIRS = { v1: 'run1-65561cdc', v2: 'run2-7ecaa3c8' };
const ONLY = process.argv.slice(2); // optional slug filter

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

const outDir = path.join(ROOT, 'public', 'blender', 'evals');
const evalsPath = path.join(ROOT, 'public', 'data', 'evals.json');
const items = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));

for (const item of items) {
  const slug = item.slug;
  if (ONLY.length && !ONLY.includes(slug)) continue;
  const src = path.join(GLB_DIR, `${slug}.glb`);
  const out = path.join(outDir, `${slug}.glb`);
  const run = slug.slice(-2);
  const base = slug.slice(0, -3);

  const document = await io.read(src);
  for (const anim of document.getRoot().listAnimations()) anim.dispose();
  await document.transform(
    dedup(),
    prune(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 78, resize: [1024, 1024] }),
    draco({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 10 }),
  );
  await io.write(out, document);

  let polys = 0;
  const doc = await io.read(out);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      polys += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }

  const render = path.join(RENDER_DIR, `${RUN_DIRS[run]}__${base}.png`);
  await sharp(render).resize(960, 540).webp({ quality: 82 }).toFile(path.join(outDir, `${slug}.webp`));

  item.polys = Math.round(polys);
  item.sizeKB = Math.round(fs.statSync(out).size / 1024);
  console.log(`${slug}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${item.polys} polys`);
}

fs.writeFileSync(evalsPath, JSON.stringify(items, null, 2));
console.log('evals.json patched');
