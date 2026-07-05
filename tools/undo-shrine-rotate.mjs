// Undoes tools/fix-shrine-rotate.mjs (rejected): unwraps all children of the
// rotated "WorldYaw45CW" group back to the scene root and removes the group,
// restoring the original world orientation. Child transforms were never
// modified by the rotate fix, so reparenting alone is an exact restore.
// Idempotent — skips if the wrapper group is absent.
// Usage: node tools/undo-shrine-rotate.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const GLB = 'public/blender/evals/japanese-shrine-night-v2.glb';
const WRAPPER = 'WorldYaw45CW';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(GLB);
const root = doc.getRoot();
const scene = root.listScenes()[0];

const wrapper = root.listNodes().find((n) => n.getName() === WRAPPER);
if (!wrapper) {
  console.log(`${WRAPPER} not present — nothing to do.`);
  process.exit(0);
}

const children = wrapper.listChildren();
for (const child of children) scene.addChild(child);
scene.removeChild(wrapper);
wrapper.dispose();

await io.write(GLB, doc);
console.log(`Unwrapped ${children.length} nodes from ${WRAPPER}, rotation undone:`, GLB);
