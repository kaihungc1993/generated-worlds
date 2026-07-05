// Injects a "MoonSpot" spotlight into the Japanese Shrine Night world GLB —
// a cool moonlight cone aimed down at the main shrine, complementing the
// exported KeySun moon directional. GLB-level (the eval source blends are
// re-downloaded artifacts); idempotent — skips if MoonSpot already exists.
// Usage: node tools/fix-shrine-moon.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRLightsPunctual, Light } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const GLB = 'public/blender/evals/japanese-shrine-night-v2.glb';

// spotlight placement: high above the -X/-Z quadrant (same side as KeySun),
// aimed at the main shrine building (0, 29, -16)
const POS = [-45, 95, -58];
const TARGET = [0, 29, -16];
const COLOR = [80/255., 103/255., 134/255.]; // deeply saturated blue moonlight
const INTENSITY = 9000000; // raw candela; viewers normalize local lights on load
const OUTER = (34 * Math.PI) / 180;
const INNER = (16 * Math.PI) / 180;

/** Quaternion rotating glTF's light axis (-Z) onto `dir`. */
function aimQuat(dir) {
  const from = [0, 0, -1];
  const d = from[0] * dir[0] + from[1] * dir[1] + from[2] * dir[2];
  const axis = [
    from[1] * dir[2] - from[2] * dir[1],
    from[2] * dir[0] - from[0] * dir[2],
    from[0] * dir[1] - from[1] * dir[0],
  ];
  const len = Math.hypot(...axis);
  if (len < 1e-6) return d > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0];
  const angle = Math.acos(Math.max(-1, Math.min(1, d)));
  const s = Math.sin(angle / 2) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(GLB);
const root = doc.getRoot();

const parent = root.listScenes()[0];

// soft cool fill from the opposite side so the whole diorama reads at night —
// directionals are normalized as a group preserving ratios, so a fill at ~45%
// of KeySun's raw intensity lands at ~45% of the normalized key
const FILL_RATIO = 0.45;
const keySun = root.listNodes().find((n) => n.getName() === 'KeySun');
const keyRaw = keySun?.getExtension('KHR_lights_punctual')?.getIntensity() ?? 785;
const fillExisting = root.listNodes().find((n) => n.getName() === 'MoonFill');
if (fillExisting) {
  fillExisting.getExtension('KHR_lights_punctual').setIntensity(keyRaw * FILL_RATIO);
  console.log('MoonFill updated');
} else {
  const extF = doc.createExtension(KHRLightsPunctual);
  const fill = extF.createLight('MoonFill')
    .setType(Light.Type.DIRECTIONAL)
    .setColor([0.78, 0.85, 1.0])
    .setIntensity(keyRaw * FILL_RATIO);
  const fillNode = doc.createNode('MoonFill')
    .setTranslation([70, 120, 80])
    .setRotation(aimQuat([-0.42, -0.72, -0.55].map((v, _, a) => v / Math.hypot(...a))))
    .setExtension('KHR_lights_punctual', fill);
  parent.addChild(fillNode);
  console.log('MoonFill created');
}

// upsert: update the existing MoonSpot in place, or create it
const existing = root.listNodes().find((n) => n.getName() === 'MoonSpot');
const dir = [TARGET[0] - POS[0], TARGET[1] - POS[1], TARGET[2] - POS[2]];
const dlen = Math.hypot(...dir);

if (existing) {
  const l = existing.getExtension('KHR_lights_punctual');
  l.setColor(COLOR).setIntensity(INTENSITY).setInnerConeAngle(INNER).setOuterConeAngle(OUTER);
  existing.setTranslation(POS).setRotation(aimQuat(dir.map((v) => v / dlen)));
  console.log('MoonSpot updated in place');
} else {
  const ext = doc.createExtension(KHRLightsPunctual);
  const light = ext.createLight('MoonSpot')
    .setType(Light.Type.SPOT)
    .setColor(COLOR)
    .setIntensity(INTENSITY)
    .setInnerConeAngle(INNER)
    .setOuterConeAngle(OUTER);
  const node = doc.createNode('MoonSpot')
    .setTranslation(POS)
    .setRotation(aimQuat(dir.map((v) => v / dlen)))
    .setExtension('KHR_lights_punctual', light);
  parent.addChild(node);
  console.log('MoonSpot created');
}

await io.write(GLB, doc);
console.log('MoonSpot injected:', GLB);
