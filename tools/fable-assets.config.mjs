import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_ROOT = process.env.FABLE_RUNS_ROOT
  || path.resolve(ROOT, '..', 'blender_articulated_asset_generation', 'runs');

const asset = (
  slug,
  title,
  runDir,
  blend,
  {
    loopPingPong = true,
    requiresTexture = false,
    exportScript = null,
    consolidate = false,
    materialTweaks = null,
    sky = null,
    splat = null,
    splatTransform = null,
    splatGroundLift = 0,
    info = null,
    deckBadge = null,
  } = {},
) => ({
  slug,
  title,
  blend: path.join(RUNS_ROOT, runDir, 'runs', 'run1', blend),
  prompt: path.join(RUNS_ROOT, runDir, 'inputs', 'instruction.md'),
  loopPingPong,
  requiresTexture,
  exportScript,
  // consolidate: palette/flatten/join static geometry in the optimize step to
  // cut per-frame draw calls (many-part assets only; animated subtrees are
  // preserved). materialTweaks: per-material PBR overrides applied before
  // optimization, keyed by the Blender material name.
  consolidate,
  materialTweaks,
  // sky: baked equirect panorama (public/-relative) used by the viewers as
  // background + environment (IBL only when a splat is also present).
  // splat: real-time gaussian splat file rendered with Spark as the fixed
  // world around the asset; the camera orbits instead of the object spinning.
  // splatTransform: column-major THREE.Matrix4 placing the splat's local
  // frame in the GLB's glTF world space (the hand-tuned Blender transform,
  // basis-changed). splatGroundLift: raises the OBJECT (not the splat) so
  // its feet rest on the splat floor's rendered surface, which sits a few
  // cm above the modeled ground plane. info: focus-view popup copy.
  sky,
  splat,
  splatTransform,
  splatGroundLift,
  info,
  // deckBadge: replaces the category pill on the deck card (e.g. MULTI-ASSET
  // for composed scenes), rendered inverted: white fill, accent border/text.
  deckBadge,
});

export const FABLE_ASSETS = [
  asset(
    'samsung-rf28r-refrigerator',
    'Samsung RF28R Refrigerator',
    'samsung_fridge_rf28r',
    'samsung_rf28r7201sr_refrigerator.blend',
    {
      requiresTexture: true,
      // The SAMSUNG wordmark is a FONT object; convert it to a mesh before
      // the shared exporter's FONT exclusion would drop it.
      exportScript: 'export-fable-fonts.py',
      // ~150 separate parts → consolidate to keep the studio viewer smooth.
      consolidate: true,
      // The studio viewer lights with a RoomEnvironment map; at metalness 1 /
      // low roughness the flat door panels mirror its white area lights on
      // black. Soften to a brushed-stainless read instead of a chrome one.
      materialTweaks: {
        stainless_front: { roughness: 0.5, metalness: 0.85 },
        satin_handle: { roughness: 0.42, metalness: 0.9 },
        side_dark: { roughness: 0.5 },
      },
    },
  ),
  asset(
    'samsung-wa50r-washer',
    'Samsung WA50R Washer',
    'samsung_washer_hose_clips',
    'washer.blend',
    {
      exportScript: 'export-fable-washer.py',
      // The lid's smoked glass ships with KHR_materials_transmission, which
      // three.js renders from a mip-sampled screen-space framebuffer — the tub
      // seen through the closed lid pixelates into giant blocks. Plain
      // alpha-blend transparency at the same 10% see-through reads identically
      // without the artifact (and skips the transmission render pass).
      materialTweaks: { smoked_glass_lid_window: { alpha: 0.9 } },
    },
  ),
  asset(
    'lv-bisten-55',
    'Louis Vuitton Bisten 55',
    'lv_bisten_55',
    'lv_bisten_55.blend',
    { requiresTexture: true, exportScript: 'export-lv-bisten-55.py' },
  ),
  asset(
    'bambu-lab-p1s-combo',
    'Bambu Lab P1S Combo',
    'bambu_p1s_combo',
    'bambu_p1s_combo.blend',
    {
      requiresTexture: true,
      // Bambu needs its dedicated exporter: it retimes the door swing (open
      // through the whole demo), materializes the driver rig (the muted NLA
      // control action doesn't evaluate reliably in background mode), and
      // converts the FONT branding decals to meshes so the shared FONT
      // exclusion doesn't drop them.
      exportScript: 'export-bambu-fable.py',
    },
  ),
  asset(
    'towerpro-sg90-servo',
    'TowerPro SG90 Servo',
    'sg90_servo',
    'sg90_servo.blend',
    // Retimed clip starts and ends assembled (explode → 2s hold → reassemble
    // → horn sweep), so a normal loop reads correctly; ping-pong would replay
    // the whole story mirrored.
    { exportScript: 'export-sg90-fable.py', loopPingPong: false },
  ),
  asset(
    'kraft-real-mayo',
    'Kraft Real Mayo',
    'kraft_mayo_30oz',
    'kraft_mayo_jar.blend',
    { requiresTexture: true },
  ),
  asset(
    'serenity-medicine-box',
    'Serenity Medicine Box',
    'medicine_box_serenity',
    'medicine_box.blend',
  ),
  asset(
    'workbench-power-scene',
    'Workbench Power Scene',
    'workbench_power_scene',
    // This run is a composed scene; its blend keeps the pipeline's scene.blend
    // name instead of the runs/run1/<slug>.blend single-asset convention.
    'scene.blend',
    {
      exportScript: 'export-workbench-power.py',
      // The insertion clip already returns to seated (plug out → hold → back
      // in), so a plain loop reads correctly; ping-pong would mirror it.
      loopPingPong: false,
      sky: 'blender/fable/workbench-power-scene-sky.webp',
      // Original Marble full-res capture (all splats + SH), shipped as-is;
      // see marble_lab/lab_scene.spz in the run tree.
      splat: 'blender/fable/workbench-power-scene.spz',
      // lab_scene's hand-tuned matrix_world from the .blend (the splat PLY's
      // local frame is imported unmodified, so this is the full transform),
      // pre-multiplied by the Blender->three.js basis change (x,y,z)->(x,z,-y).
      // Column-major, for THREE.Matrix4.fromArray.
      splatTransform: [
        -0.43112856, -0.02866912, -1.43642139, 0,
        0.09952697, -1.49669445, -0.00000001, 0,
        -1.43325591, -0.09530845, 0.43208072, 0,
        4.07833052, 1.68281758, -1.33955431, 1,
      ],
      // splat floor gaussian centers sit +4..6 cm over the modeled ground
      // under the bench footprint (measured); rest the feet on the surface.
      splatGroundLift: 0.06,
      deckBadge: 'MULTI-ASSET',
      // rendered as a bullet list in the focus-view popup (info arrays -> <ul>)
      info: [
        'Built by calling the asset agent one asset at a time — workbench, '
          + 'power supply, power strip, AC cable.',
        'The room background is a live-rendered Gaussian-Splat',
        'The scene exports to USD and runs in Isaac Sim for robot simulation '
          + '(see video).',
      ],
    },
  ),
];

export const FABLE_GLB_ROOT = '/tmp/blend-glb/fable';
export const PORTFOLIO_ROOT = ROOT;
