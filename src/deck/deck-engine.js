// Card engine for the deck landing page: card data + DOM, tilt/shine,
// and the three.js summon / dive stage. Adapted from previews/cards-shared.js
// so it bundles with the main app (npm three imports, BASE-aware asset paths,
// disposable Stage, all DOM scoped to the deck root).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { makeStudioEnvTexture } from '../studio-env.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BASE = import.meta.env.BASE_URL;

// ---------------------------------------------------------------- categories

export const CATS = {
  assets: { label: 'Articulated Assets', short: 'ASSET', model: 'OPUS 4.7', color: '#ff5c5c', kind: 'asset' },
  sim: { label: 'Greybox Scenes', short: 'GREYBOX', model: 'OPUS 4.7', color: '#8ef0c0', kind: 'scene' },
  worlds: { label: 'Generated Worlds', short: 'WORLD', color: '#7c9eff', kind: 'scene' },
  game: { label: 'Playable Game', short: 'GAME', color: '#ffd75e', kind: 'game' },
};

const SIM_SLUGS = [
  'theme-park', 'water-park', 'theme-park-ride-system',
  'supermarket-interior', 'shopping-mall-interior',
  'robotic-arm-assembly-cell', 'dockyard', 'bathhouse',
];

function shortDesc(prompt) {
  let d = prompt
    .replace(/^Generate (a|an) /i, '')
    .replace(/^Create a scene for [^:]*:\s*/i, '')
    .replace(/^A /i, '');
  d = d.charAt(0).toUpperCase() + d.slice(1);
  const cut = d.search(/[;.]/);
  if (cut > 0) d = d.slice(0, cut);
  if (d.length > 120) d = d.slice(0, 117).replace(/\s+\S*$/, '') + '…';
  return d;
}

/** Build the card list from the already-fetched manifests. */
export function buildCards(blender, evals, concepts = {}) {
  const bySlug = Object.fromEntries(blender.map((e) => [e.slug, e]));
  // concepts.json values are a single path (Opus/worlds) or an array of
  // reference photos (Fable runs); normalize to a list of URLs.
  const conceptUrls = (slug) => [].concat(concepts[slug] || []).map((p) => BASE + p);
  const cards = [];

  // Assets row: every object in the manifest, same set as the classic gallery.
  for (const e of blender.filter((en) => en.group === 'objects')) {
    cards.push({
      id: e.slug, cat: 'assets', kind: 'asset',
      title: e.title, desc: shortDesc(e.prompt),
      thumb: BASE + e.thumbnail, glb: BASE + e.url,
      // Baked skybox (e.g. the workbench scene's splat-derived lab room)
      // becomes the summon backdrop; a live gaussian splat (`splat`) replaces
      // it as the visible room, with the camera orbiting a fixed scene.
      // info feeds the "about this scene" popup.
      sky: e.sky ? BASE + e.sky : null,
      splat: e.splat ? BASE + e.splat : null,
      splatTransform: e.splatTransform || null,
      splatGroundLift: e.splatGroundLift || 0,
      info: e.info || null,
      deckBadge: e.deckBadge || null,
      concepts: conceptUrls(e.slug),
      animated: e.animated, loopPingPong: !!e.loopPingPong,
      model: e.model || null, polys: e.polys, sizeKB: e.sizeKB,
    });
  }
  for (const slug of SIM_SLUGS) {
    const e = bySlug[slug];
    if (!e) continue;
    cards.push({
      id: slug, cat: 'sim', kind: 'scene',
      title: e.title, desc: shortDesc(e.prompt),
      thumb: BASE + e.thumbnail, glb: BASE + e.url,
      sky: e.sky ? BASE + e.sky : null,
      info: e.info || null,
      concepts: conceptUrls(slug),
      animated: e.animated, polys: e.polys, sizeKB: e.sizeKB,
    });
  }
  for (const e of evals) {
    cards.push({
      id: e.slug, cat: 'worlds', kind: 'scene',
      title: e.title, desc: shortDesc(e.prompt),
      thumb: BASE + e.thumbnail, glb: BASE + e.url,
      sky: e.sky ? BASE + e.sky : null,
      info: e.info || null,
      lightBoost: e.lightBoost || 1,
      concepts: conceptUrls(e.slug),
      animated: false, polys: e.polys, sizeKB: e.sizeKB,
    });
  }
  cards.push({
    id: 'ghost-game', cat: 'game', kind: 'game',
    title: 'Ghosts in the Dataset',
    desc: 'A complete cyberpunk arcade world built in Godot 4 — playable right now in your browser.',
    thumb: BASE + 'play/ghost/promo/street.webp', glb: null, sky: null, concepts: [],
    playUrl: BASE + 'play/ghost/index.html',
    animated: false, polys: 0, sizeKB: 0,
  });
  return cards;
}

// ---------------------------------------------------------------- card DOM

const SIGILS = { asset: '⚙', scene: '✦', game: '▶' };

/** Build a .card element (front + back faces, tilt + flip wrappers). */
export function makeCardEl(card) {
  const cat = CATS[card.cat];
  const model = card.model || cat.model;
  const el = document.createElement('div');
  el.className = 'card down';
  el.dataset.kind = card.kind;
  el.dataset.cat = card.cat;
  el.dataset.id = card.id;
  el.style.setProperty('--accent', cat.color);
  const stat = card.kind === 'game'
    ? 'GODOT 4 · WEB'
    : `▲ ${(card.polys / 1000).toFixed(0)}K · ${card.sizeKB > 1024 ? (card.sizeKB / 1024).toFixed(1) + ' MB' : card.sizeKB + ' KB'}`;
  el.innerHTML = `
    <div class="card-tilt">
      <div class="card-inner">
        <div class="face front">
          <div class="badge${card.deckBadge ? ' badge-outline' : ''}">${card.deckBadge || cat.short}</div>
          <div class="art" style="background-image:url('${card.thumb}')">
            ${model ? `<div class="model-badge" title="Generated with ${model}">${model}</div>` : ''}
          </div>
          <div class="name"><span class="name-text">${card.title}</span></div>
          <div class="desc">${card.desc}</div>
          <div class="stats"><span>${stat}</span><span>${SIGILS[card.kind]}</span></div>
          <div class="shine"></div>
        </div>
        <div class="face back"><div class="sigil">✦</div></div>
      </div>
    </div>`;
  return el;
}

/** Cursor-follow tilt + holo shine on a container of .card elements. */
export function attachTilt(container) {
  container.addEventListener('pointermove', (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl || cardEl.classList.contains('down')) return;
    const r = cardEl.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const tilt = cardEl.querySelector('.card-tilt');
    tilt.style.transform =
      `translateZ(46px) translateY(-14px) rotateX(${(-py * 16).toFixed(1)}deg) rotateY(${(px * 16).toFixed(1)}deg)`;
    cardEl.style.setProperty('--sx', `${50 + px * 90}%`);
    cardEl.style.setProperty('--sy', `${50 + py * 90}%`);
  });
  container.addEventListener('pointerout', (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    if (cardEl.contains(e.relatedTarget)) return;
    cardEl.querySelector('.card-tilt').style.transform = '';
  });
}

/** Set a card's base placement (transform on the outer element). */
export function placeCard(el, x, y, rot = 0, z = 0, scale = 1) {
  el.style.transform =
    `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${scale})`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fx refs

export function fxRefs(root) {
  const $ = (id) => root.querySelector('#' + id);
  return {
    dim: $('fx-dim'), fill: $('fx-fill'), rays: $('fx-rays'),
    caption: $('fx-caption'), concept: $('fx-concept'), lightbox: $('fx-lightbox'),
    infoBtn: root.querySelector('#fx-caption .info-btn'), infobox: $('fx-infobox'),
    dismiss: $('fx-dismiss'),
    poster: $('fx-poster'), toast: $('fx-toast'), stage: $('stage'), help: $('help'),
  };
}

export function raysBurst(rays) {
  rays.classList.remove('burst');
  void rays.offsetWidth; // restart animation
  rays.classList.add('burst');
}

export function showCaption(fx, card) {
  const cat = CATS[card.cat];
  const caption = fx.caption;
  caption.querySelector('.k').textContent = cat.label;
  caption.querySelector('.k').style.color = cat.color;
  caption.querySelector('.t').textContent = card.title;
  caption.querySelector('.d').textContent = card.desc;
  caption.classList.add('on');
  // manifest-driven "about this scene" popup: any card with `info` opts in.
  // Auto-open on every entry into this card's focus view (showCaption runs
  // once per summon/dive/rail-jump, never on camera moves) so the context
  // reads first; the ⓘ button re-opens it after dismissal.
  if (fx.infoBtn && fx.infobox) {
    fx.infoBtn.hidden = !card.info;
    if (card.info) {
      fx.infobox.querySelector('.t').textContent = card.title;
      const d = fx.infobox.querySelector('.d');
      if (Array.isArray(card.info)) {
        // bullet-list form (e.g. the workbench scene)
        d.innerHTML = '';
        const ul = document.createElement('ul');
        for (const line of card.info) {
          const li = document.createElement('li');
          li.textContent = line;
          ul.appendChild(li);
        }
        d.appendChild(ul);
      } else {
        d.textContent = card.info;
      }
    }
    fx.infobox.classList.toggle('on', !!card.info);
  }
  // concept-art reference rides the same lifecycle, any card with art.
  // Entries may be still photos or demo videos (the workbench's Isaac Sim
  // robot-simulation trailer); videos autoplay muted in the thumbnail box.
  if (fx.concept) {
    if (card.concepts?.length) {
      const isVideo = (u) => /\.(mp4|webm)$/i.test(u);
      const wrap = fx.concept.querySelector('.imgs');
      const label = fx.concept.querySelector('.k');
      if (label) label.textContent = card.concepts.some(isVideo) ? 'ISAAC SIM SIMULATION' : 'CONCEPT REFERENCE';
      wrap.classList.toggle('multi', card.concepts.length > 1);
      wrap.innerHTML = card.concepts.map((url, i) => (isVideo(url)
        ? `<video src="${url}" autoplay muted loop playsinline title="click to enlarge"></video>`
        : `<img src="${url}" alt="Concept reference ${i + 1} for ${card.title}" title="click to enlarge" />`
      )).join('');
      fx.concept.classList.add('on');
    } else {
      fx.concept.classList.remove('on');
    }
  }
}

export function toast(el, msg) {
  el.textContent = msg;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 3200);
}

// ---------------------------------------------------------------- three.js stage

const draco = new DRACOLoader().setDecoderPath(BASE + 'draco/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
const texLoader = new THREE.TextureLoader();

const glbCache = new Map();

function loadGLB(url, fit) {
  const key = `${url}|${fit}`;
  if (glbCache.has(key)) return glbCache.get(key);
  const p = loadGLBUncached(url, fit);
  glbCache.set(key, p);
  p.catch(() => glbCache.delete(key));
  return p;
}

function loadGLBUncached(url, fit) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (gltf) => {
      const model = gltf.scene ?? gltf.scenes?.[0];
      // Keep embedded KHR lights in the graph; summon/dive decide per-mode
      // whether to hide them (studio look) or adopt + normalize them.
      const lights = [];
      model.traverse((o) => {
        if (o.isLight) lights.push(o);
        // Anisotropy without a tangent frame turns three.js's specular into
        // NaN (hard black wedges); see the same guard in asset-viewer.js.
        if (o.isMesh && o.material?.anisotropy > 0 && !o.geometry.attributes.tangent) {
          o.material.anisotropy = 0;
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = fit / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s);
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
      model.position.set(-c.x, -box.min.y * s, -c.z);
      const group = new THREE.Group();
      group.add(model);
      resolve({ group, animations: gltf.animations, model, lights, scale: s });
    }, undefined, reject);
  });
}

// Authored Blender lamps arrive via KHR_lights_punctual with watt->candela /
// lux conversions that land orders of magnitude too hot for this exposure.
// Normalize per class, preserving authored ratios (same approach as
// adoptImportedLights in src/asset-viewer.js). One twist: the model is
// fit-scaled here, and point/spot falloff is distance-based, so shrinking the
// world by `scale` makes local lights ~1/scale^2 hotter — the candela target
// is compensated accordingly. Mutates the cached graph, so callers guard with
// a once-flag on the cached record.
function adoptSceneLights(lights, scale, hasSky, boost = 1) {
  const DIR_TARGET = (hasSky ? 1.8 : 2.2) * boost; // hottest sun/directional lands here
  const LOCAL_TARGET = 24 * scale * scale * boost; // hottest point/spot (candela)
  const MAX_LOCAL_LIGHTS = 24; // uniform budget; too many lights break shaders

  const dirs = lights.filter((l) => l.isDirectionalLight);
  let locals = lights.filter((l) => !l.isDirectionalLight);

  locals.sort((a, b) => b.intensity - a.intensity);
  for (const l of locals.slice(MAX_LOCAL_LIGHTS)) {
    l.visible = false;
    l.userData.culled = true;
  }
  locals = locals.slice(0, MAX_LOCAL_LIGHTS);

  const maxDir = Math.max(...dirs.map((l) => l.intensity), 0);
  if (maxDir > DIR_TARGET) for (const l of dirs) l.intensity *= DIR_TARGET / maxDir;
  const maxLocal = Math.max(...locals.map((l) => l.intensity), 0);
  if (maxLocal > LOCAL_TARGET) for (const l of locals) l.intensity *= LOCAL_TARGET / maxLocal;
  for (const l of locals) if (l.distance) l.distance *= scale;
  for (const l of lights) l.castShadow = false; // stage has no shadow maps
}

function loadSky(url) {
  return new Promise((resolve) => {
    texLoader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.mapping = THREE.EquirectangularReflectionMapping;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

// Real gaussian-splat world (shared Spark helper, lazy-imported so the
// renderer stays out of the bundle for cards that don't ship one). Not
// cached: SplatMesh owns GPU state tied to its scene graph life, so each
// summon gets a fresh instance.
function loadSplat(renderer, url, transform) {
  return import('../splat-world.js')
    .then(({ createSplatWorld }) => createSplatWorld(renderer, url, transform));
}

export class Stage {
  constructor(container) {
    this.el = container;
    this.disposed = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.05, 900);
    // Soft-gradient studio IBL shared with asset-viewer.js: RoomEnvironment's
    // hard panels mirrored as a black/white split on flat glossy metals.
    this.roomEnv = makeStudioEnvTexture(this.renderer);

    this.clock = new THREE.Clock();
    this.mixer = null;
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.spin = null;
    this.float = null;
    this.flight = null;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;

    this._onResize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener('resize', this._onResize);

    const loop = () => {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      if (this.mixer) this.mixer.update(dt);
      if (this.spin) this.spin.rotation.y += dt * 0.35;
      if (this.float) {
        this.float.group.position.y = this.float.base + Math.sin(t * 1.5) * 0.075;
        this.float.group.rotation.z = Math.sin(t * 0.9) * 0.016; // faint levitation sway
      }
      if (this.flight) this.flight(dt);
      if (this.controls.enabled) this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose() {
    this.disposed = true;
    this._op = {}; // invalidate in-flight summon/dive
    cancelAnimationFrame(this._raf);
    removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.roomEnv.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  show(interactive = false) {
    this.el.classList.add('front');
    this.el.classList.toggle('interactive', interactive);
  }
  hide(instant = false) {
    if (instant) {
      this.el.style.transition = 'none';
      this.el.classList.remove('front', 'interactive');
      void this.el.offsetWidth;
      this.el.style.transition = '';
    } else {
      this.el.classList.remove('front', 'interactive');
    }
  }

  clear() {
    this._op = {}; // invalidates any in-flight summon/dive
    if (this.splat) {
      const world = this.splat;
      import('../splat-world.js').then(({ disposeSplatWorld }) => disposeSplatWorld(world));
    }
    this.splat = null;
    this.content.clear();
    this.mixer = null;
    this.spin = null;
    this.float = null;
    this.flight = null;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.controls.maxPolarAngle = Math.PI; // splat cards clamp this per-summon
    this.underLight = null;
    this.scene.background = null;
    this.scene.environment = null;
    // remove leftover lights
    [...this.scene.children].forEach((c) => { if (c !== this.content) this.scene.remove(c); });
  }

  /** Yu-Gi-Oh summon: the model materializes and levitates in the air —
   * no platform, no particles, neutral studio lighting so materials read true.
   * Cards with a baked skybox (the workbench scene's splat-derived lab room)
   * summon inside it: the panorama becomes both backdrop and IBL. */
  async summon(card) {
    this.clear();
    const op = this._op;
    const [skyTex, splat, { group, animations, lights, model }] = await Promise.all([
      card.sky ? loadSky(card.sky) : Promise.resolve(null),
      card.splat ? loadSplat(this.renderer, card.splat, card.splatTransform) : Promise.resolve(null),
      loadGLB(card.glb, 1.9),
    ]);
    if (op !== this._op) return false; // superseded by a newer summon/dive
    if (skyTex) {
      this.scene.background = skyTex;
      this.scene.environment = skyTex;
      this.scene.environmentIntensity = 1.0;
      this.scene.backgroundIntensity = 1.0;
    } else {
      this.scene.environment = this.roomEnv;
      this.scene.environmentIntensity = 0.85;
    }

    this.scene.add(new THREE.AmbientLight(0x494e5c, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 2.5);
    this.scene.add(key);
    // very faint neutral rim + soft neutral glow from below
    const rim = new THREE.DirectionalLight(0xdfe4f0, 0.65);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    this.underLight = new THREE.PointLight(0xccd2e0, 1.4, 8, 1.8);
    this.underLight.position.set(0, -1.1, 0.3);
    this.scene.add(this.underLight);

    this.camera.position.set(2.9, 1.9, 3.9);
    this.camera.lookAt(0, 1.3, 0);
    this.camera.up.set(0, 1, 0);
    // assets are studio pieces: hide any embedded lamps so the neutral rig reads true
    lights.forEach((l) => { l.visible = false; });
    group.scale.setScalar(0.01);
    this.content.add(group);
    const groundY = splat ? 0 : 0.55;
    if (splat) {
      // Splat-world cards are captured scenes, not studio pieces: the world
      // and object stay fixed and grounded while the CAMERA orbits — the
      // levitation/turntable treatment would shear the object out of its
      // photographic room.
      this.splat = splat;
      // The splat ships as the original capture with the hand-tuned Blender
      // placement applied inside splat.wrap. Compose it under the model's
      // fit-normalization so the room tracks the normalized object. The
      // ground lift lowers the ROOM (fresh group each summon — the cached
      // model is never mutated) so the fuzzy splat floor's rendered surface
      // meets the object's feet instead of swallowing them.
      const lift = (card.splatGroundLift || 0) * model.scale.x;
      const outer = new THREE.Group();
      outer.scale.copy(model.scale);
      outer.position.copy(model.position);
      outer.position.y -= lift;
      outer.add(splat.wrap);
      group.add(outer);
      this.scene.add(splat.sparkRenderer);
      group.position.y = 0;
      // Match the Isaac Sim rig used for the demo renders (IsaacSim
      // wb_render_demo.py: dome 260, key 1050 @ (-72°, 15°), fill 300 @
      // (-25°, 65°), converted from Z-up USD): neutral-white key from high
      // behind, soft fill, dimmed IBL — same balance as the studio viewer.
      this.scene.environmentIntensity = 0.75;
      key.color.set(0xffffff);
      key.intensity = 3.0;
      key.position.set(0.4, 1.4, -4.5);
      const isaacFill = new THREE.DirectionalLight(0xffffff, 0.86);
      isaacFill.position.set(3.3, 1.5, -1.7);
      this.scene.add(isaacFill);
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.55;
      const stopAuto = () => { this.controls.autoRotate = false; };
      this.controls.addEventListener('start', stopAuto, { once: true });
      // orbit at a gentle interior height, INSIDE the captured room — the
      // splat only looks right from within (wall splats read as mush from
      // behind), so keep the whole orbit radius well short of the walls,
      // and never below the captured floor (near-transparent from beneath).
      this.controls.maxPolarAngle = Math.PI * 0.52;
      this.camera.position.set(1.25, 1.6, 1.75);
    } else {
      // model is grounded at y=0 inside the group — lift so it hovers
      this.spin = group;
      this.float = { group, base: groundY };
      group.position.y = groundY;
    }
    if (animations?.length) {
      this.mixer = new THREE.AnimationMixer(group);
      for (const clip of animations) {
        const action = this.mixer.clipAction(clip);
        if (card.loopPingPong) action.setLoop(THREE.LoopPingPong, Infinity);
        action.play();
      }
    }
    // materialize: smooth grow-in, no overshoot
    const start = performance.now();
    const grow = () => {
      const t = Math.min(1, (performance.now() - start) / 750);
      const e = 1 - Math.pow(1 - t, 3);
      group.scale.setScalar(Math.max(0.01, e));
      if (t < 1) requestAnimationFrame(grow);
    };
    grow();
    this.controls.enabled = true;
    this.controls.target.set(0, splat ? 0.85 : 1.3, 0);
    this.controls.minDistance = splat ? 1.1 : 1.6;
    this.controls.maxDistance = splat ? 2.6 : 8;
    return true;
  }

  /** Scene dive: sky + world + choreographed banking flight, ending in orbit.
   * Pass { flight: false } to land directly at the final vantage (rail jumps). */
  async dive(card, onFlightDone, { flight = true } = {}) {
    this.clear();
    const op = this._op;

    const [skyTex, loaded] = await Promise.all([
      card.sky ? loadSky(card.sky) : Promise.resolve(null),
      loadGLB(card.glb, 44),
    ]);
    if (op !== this._op) return false; // superseded
    if (skyTex) {
      this.scene.background = skyTex;
      this.scene.environment = skyTex;
      this.scene.environmentIntensity = 1.0;
      this.scene.backgroundIntensity = 1.0;
    } else {
      this.scene.background = new THREE.Color(0x0a0c14);
      this.scene.environment = this.roomEnv;
      this.scene.environmentIntensity = 0.85;
    }
    const hasAuthored = loaded.lights.length > 0;
    if (hasAuthored) {
      // Adopt the exported Blender lighting (normalized once per cached record)
      // and keep only a faint generic fill so the scene isn't double-lit.
      // card.lightBoost (manifest override) compensates worlds whose authored
      // look is brighter than the normalized targets.
      const boost = card.lightBoost || 1;
      if (!loaded.lightsAdopted) {
        loaded.lightsAdopted = true;
        adoptSceneLights(loaded.lights, loaded.scale, !!skyTex, boost);
      }
      loaded.lights.forEach((l) => { if (!l.userData.culled) l.visible = true; });
      this.scene.environmentIntensity = (skyTex ? 0.6 : 0.5) * boost;
      // same residual fill rig the thumbnails were rendered with (asset-viewer)
      const fillKey = new THREE.DirectionalLight(0xfff4e6, (skyTex ? 0.35 : 0.55) * boost);
      fillKey.position.set(26, 40, 24);
      this.scene.add(fillKey);
      const fillRim = new THREE.DirectionalLight(0xbcd0ff, 0.2 * boost);
      fillRim.position.set(-22, 20, -29);
      this.scene.add(fillRim);
    } else {
      const hemi = new THREE.HemisphereLight(0xcdd8ff, 0x3a3226, skyTex ? 1.1 : 1.3);
      this.scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xfff2dd, skyTex ? 1.6 : 2.2);
      sun.position.set(30, 42, 18);
      this.scene.add(sun);
    }

    this.content.add(loaded.group);
    if (loaded.animations?.length) {
      this.mixer = new THREE.AnimationMixer(loaded.group);
      loaded.animations.forEach((c) => this.mixer.clipAction(c).play());
    }

    // measure world for the flight
    const box = new THREE.Box3().setFromObject(loaded.group);
    const size = box.getSize(new THREE.Vector3());
    const R = Math.max(size.x, size.z) * 0.5;
    const H = size.y;

    // isekai fall: start high above the world looking down, plummet,
    // then pull out of the dive into a banking swoop and settle
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(R * 0.14, H * 7.5, R * 0.22),
      new THREE.Vector3(R * 0.34, H * 3.6, R * 0.55),
      new THREE.Vector3(-R * 0.75, H * 1.55, R * 1.0),
      new THREE.Vector3(-R * 1.1, H * 0.85, -R * 0.45),
      new THREE.Vector3(R * 0.95, H * 0.95, R * 0.85),
    ]);
    const lookPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(R * 0.1, H * 0.4, R * 0.16), // nearly straight down
      new THREE.Vector3(0, H * 0.45, 0),
      new THREE.Vector3(0, H * 0.35, 0),
      new THREE.Vector3(0, H * 0.3, 0),
      new THREE.Vector3(0, H * 0.35, 0),
    ]);

    if (!flight) {
      // land directly at the final vantage (used for rail jumps)
      this.camera.position.copy(path.getPointAt(1));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(lookPath.getPointAt(1));
      this.controls.enabled = true;
      this.controls.target.copy(lookPath.getPointAt(1));
      this.controls.minDistance = 2;
      this.controls.maxDistance = R * 4;
      onFlightDone?.();
      return true;
    }

    const DUR = 6.2;
    let ft = 0;
    this.flight = (dt) => {
      ft += dt;
      const raw = Math.min(1, ft / DUR);
      const e = 1 - Math.pow(1 - raw, 2.4); // fast falling start, decelerating landing
      this.camera.position.copy(path.getPointAt(e));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(lookPath.getPointAt(e));
      // banking roll as the dive pulls out into the swoop
      const bank = Math.sin(e * Math.PI) * 0.34 * Math.sin(e * Math.PI * 2 + 0.6);
      this.camera.rotateZ(bank);
      if (raw >= 1) {
        this.flight = null;
        this.controls.enabled = true;
        this.controls.target.copy(lookPath.getPointAt(1));
        this.controls.minDistance = 2;
        this.controls.maxDistance = R * 4;
        onFlightDone?.();
      }
    };
    return true;
  }
}

// ---------------------------------------------------------------- interaction flows

function makeClone(el) {
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true);
  clone.classList.remove('down', 'dimmed', 'inspected');
  clone.classList.add('clone');
  clone.style.zIndex = '';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.transform = 'none';
  clone.style.opacity = '';
  clone.style.filter = '';
  clone.style.transition = '';
  const tilt = clone.querySelector('.card-tilt');
  if (tilt) tilt.style.transform = '';
  // clones live inside the deck root so the scoped deck styles apply
  (el.closest('#deck-root') ?? document.body).appendChild(clone);
  return { clone, rect };
}

function centerDelta(rect, fx = 0.5, fy = 0.46) {
  return {
    dx: innerWidth * fx - (rect.left + rect.width / 2),
    dy: innerHeight * fy - (rect.top + rect.height / 2),
  };
}

function onDismiss(fx, label) {
  fx.dismiss.textContent = label;
  fx.dismiss.classList.add('on');
  return new Promise((res) => fx.dismiss.addEventListener('click', res, { once: true }));
}

function addMatLabel(clone, text) {
  const m = document.createElement('div');
  m.className = 'mat-label';
  m.textContent = text;
  clone.appendChild(m);
  return m;
}

/** Full-screen quick crossfade used for rail jumps. */
export function makeFader(root) {
  let el = root.querySelector('#fx-fade');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx-fade';
    el.innerHTML = '<div class="pill">MATERIALIZING…</div>';
    root.appendChild(el);
  }
  return {
    el,
    async to(loading = false, label = 'MATERIALIZING…') {
      el.querySelector('.pill').textContent = label;
      el.classList.toggle('loading', loading);
      el.classList.add('on');
      await sleep(260);
    },
    off() { el.classList.remove('on', 'loading'); },
  };
}

// ---------------------------------------------------------------- focus flows (rail-based pages)

/** Summon ceremony from a card element, ending in an interactive focus view.
 * Does NOT own dismissal — the page keeps focus running. */
export async function focusEnterSummon(stage, fx, card, el) {
  const { clone, rect } = makeClone(el);
  el.style.visibility = 'hidden';
  fx.dim.classList.add('on');
  fx.help?.style.setProperty('opacity', '0');
  void clone.offsetWidth;

  const { dx, dy } = centerDelta(rect);
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(1.75)`;
  clone.classList.add('charging');
  clone.querySelector('.card-inner').style.transform = 'rotateY(360deg)';
  const mat = addMatLabel(clone, 'SUMMONING…');

  let ok = true;
  try {
    await Promise.all([stage.summon(card), sleep(950)]);
  } catch (err) {
    console.error(err);
    ok = false;
  }
  el.style.visibility = '';
  if (!ok) {
    toast(fx.toast, 'summon failed — model could not be loaded');
    clone.remove();
    fx.dim.classList.remove('on');
    fx.help?.style.setProperty('opacity', '');
    return false;
  }
  raysBurst(fx.rays);
  mat.remove();
  stage.show(true);
  showCaption(fx, card);
  // the card dissolves into the summon
  clone.classList.remove('charging');
  clone.style.opacity = '0';
  setTimeout(() => clone.remove(), 500);
  return true;
}

/** Dive ceremony (art-zoom + isekai fall) from a card element, ending in
 * an interactive focus view. Does NOT own dismissal. */
export async function focusEnterDive(stage, fx, card, el) {
  const { clone, rect } = makeClone(el);
  el.style.visibility = 'hidden';
  fx.dim.classList.add('on');
  fx.help?.style.setProperty('opacity', '0');
  const aR = clone.querySelector('.art').getBoundingClientRect();
  const art = {
    x: aR.left + aR.width / 2 - (rect.left + rect.width / 2),
    y: aR.top + aR.height / 2 - (rect.top + rect.height / 2),
    w: aR.width, h: aR.height,
  };
  void clone.offsetWidth;

  const { dx, dy } = centerDelta(rect, 0.5, 0.48);
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(1.9)`;
  clone.classList.add('charging');

  let flightDone;
  const flightPromise = new Promise((r) => { flightDone = r; });
  const divePromise = stage.dive(card, flightDone).catch((err) => {
    console.error(err);
    return null;
  });

  await sleep(750);
  const s = Math.max(innerWidth / art.w, innerHeight / art.h) * 1.05;
  const dx2 = innerWidth / 2 - (rect.left + rect.width / 2) - art.x * s;
  const dy2 = innerHeight / 2 - (rect.top + rect.height / 2) - art.y * s;
  clone.style.transition = 'transform 1s cubic-bezier(0.55, 0, 0.8, 0.45), opacity 0.35s 0.65s';
  clone.style.transform = `translate(${dx2}px, ${dy2}px) scale(${s})`;
  clone.style.opacity = '0';
  fx.fill.style.backgroundImage = `url('${card.thumb}')`;
  fx.fill.classList.add('on');
  const pill = document.createElement('div');
  pill.className = 'mat-pill';
  pill.textContent = 'MATERIALIZING WORLD…';
  fx.fill.appendChild(pill);
  await sleep(1050);
  clone.remove();
  el.style.visibility = '';

  const result = await divePromise;
  if (!result) {
    toast(fx.toast, 'dive failed — world could not be loaded');
    fx.fill.classList.remove('on');
    pill.remove();
    fx.dim.classList.remove('on');
    fx.help?.style.setProperty('opacity', '');
    stage.clear();
    return false;
  }
  raysBurst(fx.rays);
  stage.show(false);
  pill.remove();
  fx.fill.classList.remove('on');
  showCaption(fx, card);
  await flightPromise;
  stage.el.classList.add('interactive');
  return true;
}

/** Quick clean crossfade between focus experiences (rail jumps — no ceremony). */
export async function focusJump(stage, fx, card, fader) {
  const isAsset = card.kind === 'asset';
  await fader.to(true, isAsset ? 'SUMMONING…' : 'MATERIALIZING WORLD…');
  let ok = true;
  try {
    if (isAsset) ok = (await stage.summon(card)) !== false;
    else ok = (await stage.dive(card, null, { flight: false })) !== false;
  } catch (err) {
    console.error(err);
    ok = false;
  }
  if (ok) {
    stage.show(true);
    showCaption(fx, card);
  } else {
    toast(fx.toast, 'load failed');
  }
  fader.off();
  return ok;
}

/** Hard-cut exit from a focus view back to the page's browse state. */
export function focusExit(stage, fx) {
  stage.hide(true);
  stage.clear();
  fx.caption.classList.remove('on');
  fx.concept?.classList.remove('on');
  fx.lightbox?.classList.remove('on');
  fx.infobox?.classList.remove('on');
  fx.dismiss.classList.remove('on');
  fx.dim.style.transition = 'none';
  fx.dim.classList.remove('on');
  void fx.dim.offsetWidth;
  fx.dim.style.transition = '';
  fx.help?.style.setProperty('opacity', '');
}

/** Game card flow: card flies up, poster reveal. The poster itself links
 * to the real playable web build. Resolves when dismissed. */
export async function posterFlow(fx, card, el) {
  const { clone, rect } = makeClone(el);
  el.style.visibility = 'hidden';
  fx.dim.classList.add('on');
  fx.help?.style.setProperty('opacity', '0');
  void clone.offsetWidth;

  const { dx, dy } = centerDelta(rect, 0.5, 0.46);
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(1.7)`;
  clone.classList.add('charging');
  clone.querySelector('.card-inner').style.transform = 'rotateY(360deg)';
  await sleep(800);

  raysBurst(fx.rays);
  clone.style.opacity = '0';
  fx.poster.classList.add('on');
  await sleep(300);
  clone.style.display = 'none';

  await onDismiss(fx, '← Back');
  fx.dismiss.classList.remove('on');
  fx.poster.classList.remove('on');
  clone.remove();
  el.style.visibility = '';
  fx.dim.classList.remove('on');
  fx.help?.style.setProperty('opacity', '');
}
