import * as THREE from 'three';

// Shared gaussian-splat world loader (Spark). Lazy-imported so the ~1.8 MB
// renderer chunk only loads for assets that ship a splat.
//
// A custom SparkRenderer is registered per viewer with `blurAmount: 0.3` —
// the anti-aliasing covariance blur (≈0.5 px kernel with opacity
// compensation) that Marble's own viewer applies. Without it every gaussian
// renders with a hard truncated edge and flat walls break into visible
// granular dots.
let sparkPromise = null;
function spark() {
  return (sparkPromise ??= import('@sparkjsdev/spark'));
}

/**
 * Load a splat world and place it with the hand-tuned transform.
 * @param {THREE.WebGLRenderer} renderer
 * @param {string} url .spz/.splat/.ply url
 * @param {number[]|null} transform column-major Matrix4 placing the splat's
 *   local frame in the asset's glTF world space
 * @returns {Promise<{sparkRenderer: THREE.Object3D, mesh: THREE.Object3D, wrap: THREE.Group}|null>}
 */
export async function createSplatWorld(renderer, url, transform) {
  try {
    const { SparkRenderer, SplatMesh } = await spark();
    const sparkRenderer = new SparkRenderer({ renderer, blurAmount: 0.3 });
    const mesh = new SplatMesh({ url });
    await mesh.initialized;
    const wrap = new THREE.Group();
    if (transform) {
      new THREE.Matrix4().fromArray(transform)
        .decompose(wrap.position, wrap.quaternion, wrap.scale);
    }
    wrap.add(mesh);
    return { sparkRenderer, mesh, wrap };
  } catch (e) {
    console.warn('splat load failed', e);
    return null;
  }
}

export function disposeSplatWorld(world) {
  world?.mesh?.dispose?.();
  world?.sparkRenderer?.dispose?.();
}
