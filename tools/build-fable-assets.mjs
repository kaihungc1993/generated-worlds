// Optimize the curated Fable GLBs and write their standalone manifest.
// The original Opus object entries remain untouched in blender.json.
//
// Usage:
//   node tools/export-fable-assets.mjs
//   node tools/build-fable-assets.mjs [--force]

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, flatten, join, palette, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { FABLE_ASSETS, FABLE_GLB_ROOT, PORTFOLIO_ROOT } from './fable-assets.config.mjs';

const FORCE = process.argv.includes('--force');
const assetArg = process.argv.indexOf('--asset');
const ONLY_SLUG = assetArg >= 0 ? process.argv[assetArg + 1] : null;
const outDir = path.join(PORTFOLIO_ROOT, 'public', 'blender', 'fable');
const manifestPath = path.join(PORTFOLIO_ROOT, 'public', 'data', 'blender-fable.json');
const opusManifestPath = path.join(PORTFOLIO_ROOT, 'public', 'data', 'blender.json');

if (assetArg >= 0 && (!ONLY_SLUG || ONLY_SLUG.startsWith('--'))) {
  throw new Error('Usage: node tools/build-fable-assets.mjs [--force] [--asset SLUG]');
}
if (ONLY_SLUG && !FABLE_ASSETS.some((item) => item.slug === ONLY_SLUG)) {
  throw new Error(`Unknown Fable asset: ${ONLY_SLUG}`);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

fs.mkdirSync(outDir, { recursive: true });

function readPrompt(file) {
  return fs.readFileSync(file, 'utf8').trim().replace(/^#\s+/, '');
}

// Per-asset PBR overrides (config materialTweaks): display-environment
// corrections that belong to the shipped artifact, not the source .blend.
// Applied before palette/join so the Blender material names still resolve.
function applyMaterialTweaks(document, slug, tweaks) {
  if (!tweaks) return;
  const materials = new Map(document.getRoot().listMaterials().map((m) => [m.getName(), m]));
  for (const [name, tweak] of Object.entries(tweaks)) {
    const material = materials.get(name);
    if (!material) throw new Error(`${slug}: materialTweaks names unknown material "${name}"`);
    if (tweak.roughness != null) material.setRoughnessFactor(tweak.roughness);
    if (tweak.metalness != null) material.setMetallicFactor(tweak.metalness);
    // alpha: switch the material to plain alpha-blend transparency at this
    // opacity, dropping KHR_materials_transmission if present. three.js
    // renders transmission by sampling a screen-space framebuffer at a
    // roughness-scaled mip level, which pixelates whatever sits behind the
    // surface into giant blocks (the washer's tub through its smoked lid).
    if (tweak.alpha != null) {
      material.setAlpha(tweak.alpha);
      material.setAlphaMode('BLEND');
      material.setExtension('KHR_materials_transmission', null);
    }
  }
}

// Enforce hemisphere continuity on quaternion samplers. Blender's glTF
// exporter canonicalizes fcurve quaternion keys (w >= 0), so a rotation whose
// continuous path crosses w = 0 ships with adjacent keys on opposite
// hemispheres. glTF interpolation does no neighborhood correction — samplers
// interpolate raw components — so such flips make hinged/spinning parts whip
// mid-motion in the viewer. Negating a quaternion (and, for CUBICSPLINE, its
// tangents) never changes the rotation it represents.
function fixQuaternionContinuity(document, slug) {
  let fixed = 0;
  for (const anim of document.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) {
      if (channel.getTargetPath() !== 'rotation') continue;
      const sampler = channel.getSampler();
      const output = sampler.getOutput();
      const values = output.getArray().slice();
      const stride = sampler.getInterpolation() === 'CUBICSPLINE' ? 12 : 4;
      const valueOffset = stride === 12 ? 4 : 0;
      const keys = values.length / stride;
      for (let k = 1; k < keys; k++) {
        const a = (k - 1) * stride + valueOffset;
        const b = k * stride + valueOffset;
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += values[a + c] * values[b + c];
        if (dot >= 0) continue;
        for (let c = 0; c < stride; c++) values[k * stride + c] *= -1;
        fixed += 1;
      }
      output.setArray(values);
    }
  }
  if (fixed) console.log(`${slug}: fixed ${fixed} quaternion hemisphere flips`);
}

function polyCount(document) {
  let count = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      count += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(count);
}

const items = [];
for (const item of FABLE_ASSETS) {
  if (ONLY_SLUG && item.slug !== ONLY_SLUG) continue;
  const src = path.join(FABLE_GLB_ROOT, `${item.slug}.glb`);
  const out = path.join(outDir, `${item.slug}.glb`);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing exported GLB for ${item.slug}; run tools/export-fable-assets.mjs first`);
  }

  const document = await io.read(src);
  const root = document.getRoot();
  const animations = root.listAnimations().length;
  const materials = root.listMaterials().length;
  const textures = root.listTextures().length;

  if (!animations) throw new Error(`${item.slug}: source GLB has no animation`);
  if (!materials) throw new Error(`${item.slug}: source GLB has no materials`);
  if (item.requiresTexture && !textures) {
    throw new Error(`${item.slug}: expected image textures, but source GLB contains none`);
  }

  if (FORCE || !fs.existsSync(out) || fs.statSync(out).mtimeMs <= fs.statSync(src).mtimeMs) {
    applyMaterialTweaks(document, item.slug, item.materialTweaks);
    fixQuaternionContinuity(document, item.slug);
    await document.transform(
      dedup(),
      // Draw-call consolidation for many-part assets: collapse flat-color
      // materials into palette textures, flatten the static hierarchy, and
      // join compatible primitives. Animated nodes (and their subtrees'
      // parenting) are preserved by flatten()/join(), so articulation and
      // attached static children are unaffected.
      ...(item.consolidate ? [palette({ min: 2 }), flatten(), join()] : []),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86, resize: [2048, 2048] }),
      draco({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
    );
    await io.write(out, document);
  }

  // Re-read the exact shipped artifact so the manifest and validation reflect
  // the optimized GLB, not the pre-transform document.
  const shipped = await io.read(out);
  const shippedRoot = shipped.getRoot();
  if (!shippedRoot.listAnimations().length) throw new Error(`${item.slug}: animation was lost during optimization`);
  if (!shippedRoot.listMaterials().length) throw new Error(`${item.slug}: materials were lost during optimization`);
  if (item.requiresTexture && !shippedRoot.listTextures().length) {
    throw new Error(`${item.slug}: textures were lost during optimization`);
  }

  items.push({
    slug: item.slug,
    collection: 'fable',
    group: 'objects',
    badge: 'Fable',
    model: 'FABLE 5',
    assetSet: 'fable',
    title: item.title,
    prompt: readPrompt(item.prompt),
    url: `blender/fable/${item.slug}.glb`,
    thumbnail: `blender/fable/${item.slug}.webp`,
    sky: item.sky ?? null,
    ...(item.splat ? { splat: item.splat } : {}),
    ...(item.splatTransform ? { splatTransform: item.splatTransform } : {}),
    ...(item.splatGroundLift ? { splatGroundLift: item.splatGroundLift } : {}),
    ...(item.info ? { info: item.info } : {}),
    ...(item.deckBadge ? { deckBadge: item.deckBadge } : {}),
    animated: true,
    ...(item.loopPingPong ? { loopPingPong: true } : {}),
    polys: polyCount(shipped),
    sizeKB: Math.round(fs.statSync(out).size / 1024),
    materials: shippedRoot.listMaterials().length,
    textures: shippedRoot.listTextures().length,
    animations: shippedRoot.listAnimations().length,
  });
  console.log(
    `${item.slug}: ${items.at(-1).polys.toLocaleString()} tris, `
    + `${items.at(-1).materials} materials, ${items.at(-1).textures} textures, `
    + `${items.at(-1).animations} animation(s)`,
  );
}

let manifestItems = items;
if (ONLY_SLUG) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Cannot update ${ONLY_SLUG}: Fable manifest does not exist`);
  }
  manifestItems = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const existingIndex = manifestItems.findIndex((entry) => entry.slug === ONLY_SLUG);
  // New assets append; existing ones update in place. Either way only this
  // slug's entry is touched.
  if (existingIndex < 0) manifestItems.push(items[0]);
  else manifestItems[existingIndex] = items[0];
} else {
  // This product stays in the Fable selection as requested, while continuing
  // to share the already-optimized artifact with the original manifest.
  const opusManifest = JSON.parse(fs.readFileSync(opusManifestPath, 'utf8'));
  const ramekins = opusManifest.find((entry) => entry.slug === 'le-creuset-stackable-ramekins');
  if (!ramekins) throw new Error('Could not find Le Creuset ramekins in blender.json');
  items.splice(4, 0, {
    ...ramekins,
    badge: 'Fable',
    model: 'FABLE 5',
    assetSet: 'fable',
    // Own thumbnail file so Fable recaptures never clobber the Opus set's.
    thumbnail: 'blender/fable/le-creuset-stackable-ramekins.webp',
  });
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifestItems, null, 2)}\n`);
console.log(`wrote ${manifestPath} (${manifestItems.length} assets)`);
