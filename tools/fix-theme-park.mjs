// Post-export fixes for the theme-park scene. The source .blend is gone, so
// this patches the shipped GLB directly:
//
//   - Adds a warm low-angle "afternoon_sun" directional (KHR_lights_punctual)
//     and makes it the hottest directional, so the viewer's light
//     normalization (asset-viewer.js adoptImportedLights) picks it as the
//     shadow-casting sun.
//   - Rebalances the authored directionals: the exported "fill_light" was a
//     cool blue lamp at intensity 136600 — 50x hotter than the warm
//     "sun_main" — so after normalization the whole park was lit steel-blue
//     and flat. It becomes a modest cool fill; the two warm suns stay as
//     soft warm ambience.
//   - Grounds the floating lantern posts: every lamp_post_inst_* (and the
//     castle fantasy_torch_*) was exported hovering ~2 m in the air. This is
//     the GLB-level equivalent of export-blend.py --ground-snap, scoped by
//     name so legitimately elevated parts (coaster track, ride cars) are
//     never touched. Companion "<name>_light" point lights drop by the same
//     amount so the glow stays on the fixture.
//
// Usage: node tools/fix-theme-park.mjs [path/to/theme-park.glb ...]
// Defaults to the shipped web GLB and the /tmp/blend-glb source (if present)
// so a future build-blender.mjs run keeps the fix.

import fs from 'node:fs';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRLightsPunctual, Light } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const DEFAULT_TARGETS = [
  new URL('../public/blender/outdoor/theme-park.glb', import.meta.url).pathname,
  '/tmp/blend-glb/outdoor/theme-park.glb',
];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS.filter((p) => fs.existsSync(p));

const SUN_NAME = 'afternoon_sun';
const SUN_COLOR = [1.0, 0.72, 0.42]; // deep warm amber (late-afternoon)
const SUN_INTENSITY = 8000; // hottest directional -> viewer normalizes it to ~1.8
// Sun sits west-southwest at ~24° elevation; light travels toward +X/-Z so the
// default three-quarter camera (+X/+Z) gets raking cross-light, not flat fill.
const SUN_FROM = [-0.84, 0.4, 0.36];
// Rebalance authored directionals (preserved ratios feed the normalizer).
const DIR_INTENSITY = { fill_light: 1600, sun_main: 1400, Sun: 900 };

// Quaternion rotating -Z (glTF light forward) onto dir.
function quatFromDir(dir) {
  const len = Math.hypot(...dir);
  const d = dir.map((v) => v / len);
  const from = [0, 0, -1];
  const dot = from[0] * d[0] + from[1] * d[1] + from[2] * d[2];
  const axis = [
    from[1] * d[2] - from[2] * d[1],
    from[2] * d[0] - from[0] * d[2],
    from[0] * d[1] - from[1] * d[0],
  ];
  const axisLen = Math.hypot(...axis);
  if (axisLen < 1e-8) return dot > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0];
  const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
  const s = Math.sin(angle / 2) / axisLen;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

for (const file of targets) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  for (const node of root.listNodes()) {
    const light = node.getExtension('KHR_lights_punctual');
    if (!light) continue;
    if (node.getName() === SUN_NAME) node.dispose(); // idempotent re-run
    else if (node.getName() in DIR_INTENSITY) light.setIntensity(DIR_INTENSITY[node.getName()]);
  }

  const ext = doc.createExtension(KHRLightsPunctual);
  const sun = ext
    .createLight()
    .setType(Light.Type.DIRECTIONAL)
    .setColor(SUN_COLOR)
    .setIntensity(SUN_INTENSITY);
  const dir = SUN_FROM.map((v) => -v); // light travels from the sun toward the scene
  const node = doc.createNode(SUN_NAME).setRotation(quatFromDir(dir)).setExtension('KHR_lights_punctual', sun);
  scene.addChild(node);

  // Ground snap for the floating lanterns. The park ground is flat at y=0
  // everywhere a lamp stands (the grounded lamp_main/lamp_hub rows confirm
  // it), so "snap" = drop the assembly so its bbox bottom lands on 0. Only
  // ever lowers, and only fixtures hovering well clear of the ground.
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  let snapped = 0;
  for (const n of root.listNodes()) {
    const name = n.getName();
    if (!/^(lamp|lantern|fantasy_torch)/i.test(name) || name.endsWith('_light')) continue;
    if (!n.getMesh() && !n.listChildren().length) continue;
    const b = getBounds(n);
    const drop = b.min[1];
    if (!Number.isFinite(drop) || drop < 0.3) continue;
    const t = n.getTranslation();
    n.setTranslation([t[0], t[1] - drop, t[2]]);
    const companion = byName.get(`${name}_light`);
    if (companion) {
      const ct = companion.getTranslation();
      companion.setTranslation([ct[0], ct[1] - drop, ct[2]]);
    }
    snapped++;
  }
  console.log(`grounded ${snapped} floating lantern fixtures`);

  await io.write(file, doc);
  console.log(`patched ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}
