import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { makeStudioEnvTexture } from './studio-env.js';

// Studio viewer for Blender-exported GLBs: neutral backdrop, soft IBL,
// ground shadow, turntable, and animation playback with a scrubber.
export class AssetViewer {
  constructor(container, { onReady, onError, onTime } = {}) {
    this.container = container;
    this.onReady = onReady ?? (() => {});
    this.onError = onError ?? (() => {});
    this.onTime = onTime ?? (() => {});
    this.disposed = false;
    this.playing = true;
    this.duration = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = makeStudioBackground();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.1;
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false));

    // Soft-gradient studio IBL (see studio-env.js) instead of RoomEnvironment,
    // whose hard area-light panels mirrored as a stark black/white split on
    // flat glossy metals such as the fridge's stainless doors.
    this.scene.environment = makeStudioEnvTexture(this.renderer);
    this.scene.environmentIntensity = 0.85;

    const key = new THREE.DirectionalLight(0xfff4e6, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02; // rescaled to object size in load()
    this.keyLight = key;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd0ff, 0.7);
    this.rimLight = rim;
    this.scene.add(rim);
    // Shadowless fill opposite the key: with the key carrying most of the
    // illumination (so its cast shadows read), this keeps the shadowed side
    // of white plastics legible instead of dropping to the dark backdrop.
    const fill = new THREE.DirectionalLight(0xdde6f2, 0.0);
    this.fillLight = fill;
    this.scene.add(fill);

    const draco = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + 'draco/');
    this.loader = new GLTFLoader().setDRACOLoader(draco);

    this.clock = new THREE.Clock();
    this.mixer = null;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  async load(url, { environment = false, hideCeilings = false, skyUrl = null, splatUrl = null, splatTransform = null, splatGroundLift = 0, loopPingPong = false, thumbFrame = 0, thumbView = null, fpCamera = null, lightBoost = 1 } = {}) {
    try {
      // Baked Blender-world skybox: replaces the studio gradient + IBL.
      const skyPromise = skyUrl
        ? new THREE.TextureLoader().loadAsync(skyUrl).catch((e) => (console.warn('sky load failed', e), null))
        : Promise.resolve(null);
      // Real gaussian-splat world (Spark, via the shared splat-world helper
      // that also registers the anti-aliasing blur SparkRenderer).
      const splatPromise = splatUrl
        ? import('./splat-world.js').then(({ createSplatWorld }) =>
            createSplatWorld(this.renderer, import.meta.env.BASE_URL + splatUrl, splatTransform))
        : Promise.resolve(null);
      const [gltf, sky, splat] = await Promise.all([
        this.loader.loadAsync(import.meta.env.BASE_URL + url),
        skyPromise,
        splatPromise,
      ]);
      if (this.disposed) {
        sky?.dispose();
        if (splat) import('./splat-world.js').then(({ disposeSplatWorld }) => disposeSplatWorld(splat));
        return;
      }
      if (sky) {
        sky.mapping = THREE.EquirectangularReflectionMapping;
        sky.colorSpace = THREE.SRGBColorSpace;
        this.scene.background?.dispose?.();
        this.scene.environment?.dispose?.();
        // With a live splat world the splat is the visible room; the panorama
        // stays behind it filling any sparse-splat gaps, and provides the IBL.
        this.scene.background = sky;
        this.scene.environment = sky;
        this.scene.environmentIntensity = 1;
      }
      const obj = gltf.scene;

      const importedLights = [];
      obj.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material?.map) c.material.map.anisotropy = 8;
          // KHR_materials_anisotropy needs a real tangent frame. Assets that
          // author it without tangents (e.g. brushed-stainless panels with
          // collapsed UVs) make three.js's anisotropic GGX produce NaN,
          // which renders as hard black wedges no environment can light.
          if (c.material?.anisotropy > 0 && !c.geometry.attributes.tangent) {
            c.material.anisotropy = 0;
          }
        }
        if (c.isLight) importedLights.push(c);
      });

      if (hideCeilings) {
        // Dollhouse view for interiors: hide ceiling/roof slabs so the
        // three-quarter camera can see into the rooms.
        obj.traverse((c) => {
          if (/(^|[\s_-])(ceil(ing)?|roof)([\s_-]|$)/i.test(c.name)) c.visible = false;
        });
      }

      // Center on origin, rest on ground.
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z);
      obj.position.sub(center);
      obj.position.y += size.y / 2 - (environment ? size.y * 0.06 : 0);
      // Splat-world assets: the captured floor is a fuzzy shell whose
      // rendered surface sits a few cm above the modeled ground plane, so
      // the object (feet at y=0) rests ON that surface instead of sinking
      // into it. The splat itself keeps its hand-tuned placement.
      if (splat && splatGroundLift) obj.position.y += splatGroundLift;
      this.scene.add(obj);
      this.object = obj;

      if (splat) {
        // The splat ships as the ORIGINAL capture (Marble .spz, full
        // splats); the manifest's splatTransform carries the hand-tuned
        // Blender placement (basis-changed to glTF space). The GLB's
        // recentering offset composes on top so the room stays aligned
        // around the recentered object (minus the ground lift, which is
        // an object-only correction).
        const outer = new THREE.Group();
        outer.position.copy(obj.position);
        if (splatGroundLift) outer.position.y -= splatGroundLift;
        outer.add(splat.wrap);
        this.scene.add(outer);
        this.scene.add(splat.sparkRenderer);
        this.splat = splat;
      }

      // Object viewing: shift the balance from the shadowless IBL toward the
      // shadow-casting key. Uniform env light flattens matte white/pale
      // plastics (trays, links, and bin melt together); a dominant key gives
      // crevices and part boundaries real attached shadows, and the
      // shadowless fill (plus the dimmed IBL) keeps the occluded side
      // readable. Environments keep the flatter balance — their scale makes
      // one key insufficient and the stronger shadow would stripe terrain.
      if (!environment) {
        this.scene.environmentIntensity = 0.5;
        this.keyLight.intensity = 3.2;
        this.fillLight.intensity = 0.55;
      }
      if (splat) {
        // Splat worlds match the Isaac Sim rig used for the demo renders
        // (IsaacSim wb_render_demo.py): neutral dome 260 + key DistantLight
        // 1050 rotated (-72°, 15°) + fill 300 at (-25°, 65°), converted from
        // the Z-up USD frame and normalized so key stays ~3. The warm studio
        // key would tint the object away from the photographic splat room.
        this.scene.environmentIntensity = 0.75;
        this.keyLight.color.set(0xffffff);
        this.keyLight.intensity = 3.0;
        this.fillLight.color.set(0xffffff);
        this.fillLight.intensity = 0.86;
      }

      // Lights + shadow frustum scaled to the object.
      if (splat) {
        this.keyLight.position.set(radius * 0.19, radius * 0.7, radius * -2.24);
        this.fillLight.position.set(radius * 1.6, radius * 0.75, radius * -0.83);
      } else {
        this.keyLight.position.set(radius * 1.2, radius * 1.8, radius * 1.1);
        this.fillLight.position.set(-radius * 1.4, radius * 0.7, radius * 0.9);
      }
      // Fit the ortho shadow camera to the actual bounds (the object is
      // centered at the origin), not a loose radius box: every texel of the
      // 2048 map lands on the object, keeping part-vs-part shadows crisp.
      const s = Math.hypot(size.x, size.y, size.z) * 0.62;
      Object.assign(this.keyLight.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: radius * 6 });
      this.keyLight.shadow.camera.updateProjectionMatrix();
      // Depth biases in world units: the constructor defaults suit meter-scale
      // props, but on small assets (0.4 m medicine box) a fixed 0.02 normal
      // bias is centimetres of offset — exactly the gap between a scissor
      // link and the tray face — and eats their contact shadows.
      this.keyLight.shadow.normalBias = Math.max(0.003, radius * 0.006);
      this.keyLight.shadow.bias = -0.0002;
      this.rimLight.position.set(-radius, radius * 0.9, -radius * 1.3);

      if (importedLights.length) this.adoptImportedLights(importedLights, radius, !!sky, lightBoost);

      if (!environment) {
        // Studio ground: soft shadow catcher + subtle disc. For splat worlds
        // it rides at the (lifted) feet level so the shadow lands on the
        // splat floor surface, not inside it.
        const ground = new THREE.Mesh(
          new THREE.CircleGeometry(radius * 2.4, 64).rotateX(-Math.PI / 2),
          new THREE.ShadowMaterial({ opacity: 0.32 }),
        );
        ground.position.y = splat ? splatGroundLift : 0;
        ground.receiveShadow = true;
        this.scene.add(ground);
        // The opaque dark disc belongs to the studio-void look; against a
        // baked photographic sky (e.g. the workbench scene's splat-derived
        // lab room) it would read as a floating black mat, so keep just the
        // shadow catcher there.
        if (!sky) {
          const disc = new THREE.Mesh(
            new THREE.CircleGeometry(radius * 2.4, 64).rotateX(-Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.95, metalness: 0 }),
          );
          disc.position.y = -0.002 * radius;
          disc.receiveShadow = true;
          this.scene.add(disc);
        }
      }

      // Camera framing. Environments (floor plans, sites) read best from a
      // high three-quarter angle; objects from a lower studio angle.
      // thumbFrame (capture scripts only, via ?thumb=<zoom>) dollies in and
      // lowers the angle so the scene fills the 16:9 thumbnail crop instead
      // of floating small against the dark backdrop.
      let dist = environment ? radius * 0.95 : radius * 1.55;
      let heightK = environment ? 0.85 : 0.5;
      if (environment && thumbFrame) {
        dist = radius * 0.55 * thumbFrame;
        heightK = 0.62;
      }
      this.controls.target.set(0, size.y * (environment ? 0.1 : 0.45), 0);
      this.camera.position.set(dist * 0.72, dist * heightK, dist * 0.78);
      this.camera.near = Math.max(0.02, radius / 500);
      this.camera.far = radius * 30;
      this.camera.updateProjectionMatrix();
      this.controls.minDistance = radius * 0.25;
      this.controls.maxDistance = radius * 4.5;
      // Splat worlds: keep the camera above the captured floor — gaussian
      // floors are near-transparent from below, which reads as the object
      // levitating over a see-through void.
      this.controls.maxPolarAngle = Math.PI * (splat ? 0.52 : environment ? 0.55 : 0.62);
      this.controls.update();
      if (environment) {
        this.controls.autoRotateSpeed = 0.5;
        // The dark studio fog would silhouette terrain against a bright sky.
        if (!sky) this.scene.fog = new THREE.Fog(0x11131a, radius * 2.2, radius * 9);
      }

      if (!environment && thumbView) {
        // Object thumbnail framing (?tv=yaw,pitch,zoom[,tx,ty,tz], capture
        // scripts only): explicit orbit angles + dolly + target offset so a
        // product's front/label/detail can be framed deterministically.
        // yaw 0 = camera on +Z (model front for Z-forward exports),
        // pitch = elevation above horizon (deg), zoom <1 pushes in,
        // tx/tz in object radii, ty as a fraction of object height.
        const { yaw = 43, pitch = 25, zoom = 1, tx = 0, ty = 0.45, tz = 0 } = thumbView;
        const d = radius * 1.55 * zoom;
        const target = new THREE.Vector3(tx * radius, ty * size.y, tz * radius);
        const yawR = THREE.MathUtils.degToRad(yaw);
        const pitchR = THREE.MathUtils.degToRad(pitch);
        this.camera.position.set(
          target.x + d * Math.sin(yawR) * Math.cos(pitchR),
          target.y + d * Math.sin(pitchR),
          target.z + d * Math.cos(yawR) * Math.cos(pitchR),
        );
        this.controls.target.copy(target);
        this.controls.minDistance = radius * 0.05;
        this.controls.autoRotate = false;
        this.controls.update();
      }

      if (fpCamera) {
        // First-person capture framing (?fp=..., capture scripts only):
        // eye-height camera inside the scene, positioned in the GLB's
        // original pre-centering coordinates. yaw 0 looks toward -Z.
        const eye = new THREE.Vector3(...fpCamera.position).add(obj.position);
        const yaw = THREE.MathUtils.degToRad(fpCamera.yaw);
        const pitch = THREE.MathUtils.degToRad(fpCamera.pitch);
        const dir = new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        );
        this.camera.position.copy(eye);
        this.controls.target.copy(eye).addScaledVector(dir, Math.max(radius * 0.2, 5));
        this.camera.fov = fpCamera.fov;
        this.camera.near = Math.max(0.05, radius / 2000);
        this.camera.updateProjectionMatrix();
        this.controls.autoRotate = false;
        this.controls.minDistance = 0.1;
        this.controls.maxPolarAngle = Math.PI;
        this.controls.update();
      }

      // Animations.
      if (gltf.animations.length) {
        this.pingPong = loopPingPong;
        this.mixer = new THREE.AnimationMixer(obj);
        for (const clip of gltf.animations) {
          this.duration = Math.max(this.duration, clip.duration);
          const action = this.mixer.clipAction(clip);
          // Ping-pong for mechanisms that should visibly close again (e.g.
          // the dishwasher door) instead of jumping back to the start pose.
          if (loopPingPong) action.setLoop(THREE.LoopPingPong, Infinity);
          action.play();
        }
      }

      this.onReady({ animated: gltf.animations.length > 0, duration: this.duration });
    } catch (e) {
      console.error(e);
      this.onError(e);
    }
  }

  // Authored Blender lamps arrive via KHR_lights_punctual. Blender's
  // watt->candela / lux conversions land orders of magnitude too hot for this
  // viewer's exposure, so normalize per class (preserving authored ratios) and
  // dial the studio rig back so scenes aren't double-lit. Some fill stays:
  // authored lamps are sparse and three.js has no bounce lighting.
  adoptImportedLights(lights, radius, hasSky, boost = 1) {
    // boost: per-item manifest override (lightBoost) — normalization makes
    // authored lamp wattage irrelevant, so dark-colored or dim-looking suns
    // can be compensated per world without touching shared targets.
    const DIR_TARGET = (hasSky ? 1.8 : 2.2) * boost; // hottest sun/directional lands here
    const LOCAL_TARGET = 24 * boost; // hottest point/spot lands here (candela)
    const MAX_LOCAL_LIGHTS = 24; // uniform budget; too many lights break shaders

    const dirs = lights.filter((l) => l.isDirectionalLight);
    let locals = lights.filter((l) => !l.isDirectionalLight);

    locals.sort((a, b) => b.intensity - a.intensity);
    for (const l of locals.slice(MAX_LOCAL_LIGHTS)) l.visible = false;
    locals = locals.slice(0, MAX_LOCAL_LIGHTS);

    const maxDir = Math.max(...dirs.map((l) => l.intensity), 0);
    if (maxDir > DIR_TARGET) for (const l of dirs) l.intensity *= DIR_TARGET / maxDir;
    const maxLocal = Math.max(...locals.map((l) => l.intensity), 0);
    if (maxLocal > LOCAL_TARGET) for (const l of locals) l.intensity *= LOCAL_TARGET / maxLocal;

    // One shadow caster max: the brightest imported sun replaces the studio
    // key as the shadow source; everything else is shadowless (perf).
    for (const l of lights) l.castShadow = false;
    const sun = dirs.sort((a, b) => b.intensity - a.intensity)[0];
    if (sun) {
      this.keyLight.castShadow = false;
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.02;
      const s = radius * 1.2;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: radius * 6 });
      sun.shadow.camera.updateProjectionMatrix();
    }

    // Keep some studio fill, weaker: the baked sky (when present) is already
    // doing IBL, so it gets the lighter touch.
    this.keyLight.intensity = (hasSky ? 0.35 : 0.55) * boost;
    this.rimLight.intensity = 0.2 * boost;
    this.fillLight.intensity = 0.1 * boost;
    this.scene.environmentIntensity = (hasSky ? 0.6 : 0.5) * boost;
  }

  setPlaying(playing) {
    this.playing = playing;
  }

  seek(t) {
    if (!this.mixer) return;
    this.mixer.setTime(t);
  }

  get time() {
    if (!this.mixer) return 0;
    const dur = Math.max(this.duration, 1e-6);
    if (!this.pingPong) return this.mixer.time % dur;
    // Fold the ever-increasing mixer time so the scrubber follows the bounce.
    const t = this.mixer.time % (2 * dur);
    return t > dur ? 2 * dur - t : t;
  }

  tick() {
    if (this.disposed) return;
    const dt = this.clock.getDelta();
    if (this.mixer && this.playing) {
      this.mixer.update(dt);
      this.onTime(this.time, this.duration);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    if (this.splat) import('./splat-world.js').then(({ disposeSplatWorld }) => disposeSplatWorld(this.splat));
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const v of Object.values(m)) v?.isTexture && v.dispose();
        m.dispose?.();
      }
    });
    this.scene.background?.dispose?.();
    this.scene.environment?.dispose?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function makeStudioBackground() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#1b1e2b');
  grad.addColorStop(0.55, '#12141c');
  grad.addColorStop(1, '#0a0b10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
