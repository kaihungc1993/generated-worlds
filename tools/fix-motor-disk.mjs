// One-shot fix: the washer spacer disk in motor-assembly.glb was authored with
// a lateral explode offset; rewrite its translation track so it moves straight
// up (glTF Y) with no X/Z drift. Patches the shipped GLB in place.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = [
  { file: `${ROOT}public/blender/diverse/motor-assembly.glb`, recompress: true },
  { file: '/tmp/blend-glb/diverse/motor-assembly.glb', recompress: false },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

for (const { file, recompress } of FILES) {
  const doc = await io.read(file);
  let patched = false;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetNode()?.getName() !== 'washer_spacer_disk_visual') continue;
      if (ch.getTargetPath() !== 'translation') continue;
      const out = ch.getSampler().getOutput();
      const arr = out.getArray().slice();
      const x0 = arr[0];
      const z0 = arr[2];
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = x0;
        arr[i + 2] = z0;
      }
      out.setArray(arr);
      patched = true;
      console.log(`${file}: patched ${arr.length / 3} keys (locked X=${x0}, Z=${z0})`);
    }
  }
  if (!patched) throw new Error(`washer_spacer_disk_visual translation track not found in ${file}`);
  if (recompress) await doc.transform(draco({ quantizePosition: 12, quantizeNormal: 8, quantizeTexcoord: 10 }));
  await io.write(file, doc);
}
