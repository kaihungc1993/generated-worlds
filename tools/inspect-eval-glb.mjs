// Inspect exported eval GLBs: light counts/types + material color stats
// (to spot procedural chains flattened to suspicious gray).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const lights = [];
  for (const node of root.listNodes()) {
    const l = node.getExtension('KHR_lights_punctual');
    if (l) lights.push({ name: node.getName(), type: l.getType(), intensity: Math.round(l.getIntensity() * 10) / 10, color: l.getColor().map((c) => Math.round(c * 100) / 100) });
  }
  const mats = root.listMaterials().map((m) => {
    const c = m.getBaseColorFactor();
    const tex = !!m.getBaseColorTexture();
    const [r, g, b] = c;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const grayish = !tex && mx - mn < 0.06 && mx > 0.25 && mx < 0.75;
    return { name: m.getName(), tex, color: c.slice(0, 3).map((v) => Math.round(v * 100) / 100), grayish, emissive: m.getEmissiveFactor().some((v) => v > 0) };
  });
  const grays = mats.filter((m) => m.grayish);
  console.log(`\n===== ${file}`);
  console.log(`lights: ${lights.length}`);
  for (const l of lights) console.log(`  ${l.type.padEnd(11)} ${l.name}  I=${l.intensity} rgb=${l.color}`);
  console.log(`materials: ${mats.length}, textured: ${mats.filter((m) => m.tex).length}, flat-grayish: ${grays.length}`);
  for (const m of grays.slice(0, 25)) console.log(`  GRAY? ${m.name} rgb=${m.color}`);
}
