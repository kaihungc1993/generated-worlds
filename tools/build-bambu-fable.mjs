// Optimize only the Bambu Lab P1S export and refresh its existing manifest
// entry, avoiding changes to other concurrently generated Fable assets.
//
// Usage: node tools/build-bambu-fable.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { FABLE_GLB_ROOT, PORTFOLIO_ROOT } from './fable-assets.config.mjs';


const SLUG = 'bambu-lab-p1s-combo';
const sourcePath = path.join(FABLE_GLB_ROOT, `${SLUG}.glb`);
const outputPath = path.join(
  PORTFOLIO_ROOT,
  'public',
  'blender',
  'fable',
  `${SLUG}.glb`,
);
const manifestPath = path.join(
  PORTFOLIO_ROOT,
  'public',
  'data',
  'blender-fable.json',
);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

function polyCount(document) {
  let count = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      count += (
        indices
          ? indices.getCount()
          : primitive.getAttribute('POSITION').getCount()
      ) / 3;
    }
  }
  return Math.round(count);
}

const document = await io.read(sourcePath);
const sourceRoot = document.getRoot();
if (!sourceRoot.listAnimations().length) throw new Error('Bambu source GLB has no animation');
if (!sourceRoot.listMaterials().length) throw new Error('Bambu source GLB has no materials');
if (!sourceRoot.listTextures().length) throw new Error('Bambu source GLB has no textures');

await document.transform(
  dedup(),
  prune(),
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    quality: 86,
    resize: [2048, 2048],
  }),
  draco({
    quantizePosition: 14,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
  }),
);
await io.write(outputPath, document);

const shipped = await io.read(outputPath);
const root = shipped.getRoot();
const animations = root.listAnimations().length;
const materials = root.listMaterials().length;
const textures = root.listTextures().length;
if (!animations || !materials || !textures) {
  throw new Error(
    `Bambu validation failed: ${animations} animations, `
    + `${materials} materials, ${textures} textures`,
  );
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entry = manifest.find((item) => item.slug === SLUG);
if (!entry) throw new Error(`Missing ${SLUG} manifest entry`);
Object.assign(entry, {
  polys: polyCount(shipped),
  sizeKB: Math.round(fs.statSync(outputPath).size / 1024),
  materials,
  textures,
  animations,
});
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `${SLUG}: ${entry.polys.toLocaleString()} tris, ${materials} materials, `
  + `${textures} textures, ${animations} animation(s), ${entry.sizeKB} KB`,
);
