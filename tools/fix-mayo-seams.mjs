// One-shot fix: the mayo jar was authored with two mold-seam strips
// (jar_mold_seam_left/right_visual) that render as thin vertical lines on the
// glass. Remove those nodes/meshes from the shipped GLB and the /tmp copy.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = [
  { file: `${ROOT}public/blender/product/organic-mayonnaise-jar.glb`, recompress: true },
  { file: '/tmp/blend-glb/product/organic-mayonnaise-jar.glb', recompress: false },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

for (const { file, recompress } of FILES) {
  const doc = await io.read(file);
  let removed = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh()?.getName().includes('jar_mold_seam')) {
      node.dispose();
      removed++;
    }
  }
  if (!removed) throw new Error(`no mold seam nodes found in ${file}`);
  await doc.transform(prune());
  if (recompress) await doc.transform(draco({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 10 }));
  await io.write(file, doc);
  console.log(`${file}: removed ${removed} seam nodes`);
}
