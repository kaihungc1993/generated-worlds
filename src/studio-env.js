import * as THREE from 'three';

// Neutral studio IBL used by the asset viewer and the deck stage.
//
// three.js RoomEnvironment is a box room with hard-edged area-light panels:
// on flat glossy metals (e.g. the fridge's stainless doors) it reflects as a
// stark half-black/half-white mirror split. This procedural equirectangular
// map keeps the same character — dark floor, bright neutral overhead, a warm
// key softbox and a cool fill — but every feature is a smooth gaussian lobe,
// so reflections read as studio softbox gradients instead of hard panels.
// Values are HDR (lobes peak above 1) so speculars stay lively at the same
// environmentIntensity the viewers already use.
export function makeStudioEnvTexture(renderer) {
  const W = 256;
  const H = 128;
  const data = new Float32Array(W * H * 4);

  // Directional lobes: azimuth/elevation in degrees, gaussian width sigma in
  // degrees, HDR peak intensity, linear RGB tint. Roughly matches the studio
  // rig's key (warm, upper front-right) and rim (cool, upper back-left).
  const lobes = [
    { az: 35, el: 42, sigma: 30, intensity: 2.6, color: [1.0, 0.96, 0.9] },
    { az: -130, el: 35, sigma: 34, intensity: 1.3, color: [0.82, 0.88, 1.0] },
    { az: 165, el: 60, sigma: 28, intensity: 1.6, color: [0.95, 0.97, 1.0] },
  ].map((l) => {
    const az = THREE.MathUtils.degToRad(l.az);
    const el = THREE.MathUtils.degToRad(l.el);
    return {
      dir: [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)],
      sigma: THREE.MathUtils.degToRad(l.sigma),
      intensity: l.intensity,
      color: l.color,
    };
  });

  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  for (let y = 0; y < H; y++) {
    const el = (0.5 - (y + 0.5) / H) * Math.PI; // equirect: top row = zenith
    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    for (let x = 0; x < W; x++) {
      const az = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      const dx = cosEl * Math.sin(az);
      const dy = sinEl;
      const dz = -cosEl * Math.cos(az);

      // Base dome: white-cyc studio floor rising smoothly to a soft bright
      // ceiling. Flat metallic panels (fridge doors) mirror the lower
      // hemisphere; RoomEnvironment's near-black floor read as a stark
      // black/white mirror split (the original complaint), so the floor here
      // stays within ~2x of the ceiling, like a real appliance photo cyc.
      const base = 0.42 + 0.3 * smoothstep(-0.6, 0.95, dy);
      let r = base;
      let g = base;
      let b = base * 1.04; // faint cool cast, matching the studio backdrop

      for (const lobe of lobes) {
        const dot = Math.min(1, Math.max(-1, dx * lobe.dir[0] + dy * lobe.dir[1] + dz * lobe.dir[2]));
        const ang = Math.acos(dot) / lobe.sigma;
        const w = lobe.intensity * Math.exp(-ang * ang);
        r += w * lobe.color[0];
        g += w * lobe.color[1];
        b += w * lobe.color[2];
      }

      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 1;
    }
  }

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}
