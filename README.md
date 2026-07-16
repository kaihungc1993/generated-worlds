# Generated Worlds — AI 3D Content Portfolio

A portfolio site showcasing an AI content-generation pipeline that turns written
prompts into engine-ready 3D: **articulated Blender objects** with working
kinematics, **full simulation environments**, **entire generated worlds**, and a
**playable Godot game demo**. Everything renders live in the browser with
**three.js**.

Site structure:

- **Entry page** — live 3D hero (an animated generated mechanism), stats, and three
  gallery collections with thumbnails.
- **Object studio** (`#/asset/<slug>`) — studio-lit turntable viewer with animation
  playback (play/pause/scrub) and the original generation prompt.
- **Environment viewer** — high three-quarter view of full scenes; interiors get an
  automatic dollhouse view (ceilings hidden).
- **Playable demo** (`public/play/ghost/`) — "Ghosts in the Dataset", a complete
  Godot game exported to WebAssembly, playable directly in the browser.

## Content pipelines

### Blender assets (objects + environments)

| Step | Script | What it does |
| --- | --- | --- |
| 1. Export | `tools/export-blends.sh` (+ `export-blend.py`) | Blender headless: `.blend` → GLB with baked animation. With `--object` it strips presentation helpers (backdrops, annotation text, collision proxies) by name and by geometric heuristics. |
| 2. Optimize | `tools/build-blender.mjs` | Draco compression + WebP textures into `public/blender/`, writes `public/data/blender.json` with titles, prompts (from the `.md` files), poly counts and animation flags. The objects galleries are curated: only slugs in the script's `OBJECT_KEEP` set ship (10 objects); environment collections are unfiltered. |
| 3. Thumbnails | `tools/capture-thumbs.mjs` or `tools/capture-gpu.mjs` | Headless capture of every item (`capture-gpu.mjs` uses a real-GPU Chromium for heavy scenes). |

Source data expected under `/tmp/blender-assets/` (unzipped from
`articulated-objects.zip` and the `blender_scene/*.zip` archives) and exported GLBs
under `/tmp/blend-glb/`.

The current object showcase defaults to the curated Fable set in
`public/data/blender-fable.json`; the original Opus 4.7 objects remain in
`public/data/blender.json`. Use `?assets=fable` or `?assets=opus` to select a
set without rebuilding the site. Rebuild the Fable artifacts with:

```sh
npm run fable:export
npm run fable:build
npm run fable:thumbs -- --url http://localhost:5173
```

`FABLE_RUNS_ROOT` can override the default sibling checkout path used by the
export configuration.

### Blender worlds (eval outdoor scenes)

Full outdoor worlds from the reconstruct-scene eval runs, shown as the
"Generated Worlds — Blender" collection (a curated set of 7, one world per
prompt; the keep list lives in `tools/build-evals.mjs`):

1. **Download** — `.blend` files are pulled from each eval project's Gitea repo
   via the project-service API into `~/Desktop/eval-blends/` (see chat history;
   a `manifest.json` there maps prompts to project IDs).
2. **Export** — the same `tools/export-blend.py` headless export as other
   Blender content (`/tmp/blend-glb/evals/<prompt>-v<run>.glb`).
3. **Optimize** — `tools/build-evals.mjs`: these scenes are 2–7M tris each, so
   on top of Draco + 1K WebP it welds and mesh-simplifies to 50% (5.8 GB raw →
   ~275 MB), strips the empty baked animation clip, and writes
   `public/data/evals.json`.
4. **Thumbnails** — reused from headless Blender EEVEE renders
   (`tools/eval-contact-sheet.mjs` builds a review contact sheet from the same
   renders).

### Playable Godot demo ("Ghosts in the Dataset")

The demo is a real Godot 4.5 web export of the private
`MoonlakeAI/ghost-in-the-dataset` project (clone expected at `/tmp/ghost`):

1. **Shrink imports** — every texture `.import` is capped at
   `process/size_limit=512` and WAV imports switched to QOA compression, then
   reimported headless (`godot --headless --import`). This takes the web pack
   from 2 GB down to ~160 MB with no source-asset edits.
2. **Dependency export** — the Web preset uses `export_filter="scenes"` with the
   scene chain plus every dynamically loaded resource (CyberStreet, arcade
   mini-games, NPCs, player animations, shaders, footstep audio) listed
   explicitly, since Godot's dependency scanner cannot see `load("res://…")`
   string paths.
3. **Export + chunk** — `godot --headless --export-release "Web"` produces the
   build; `index.pck` is then split (`split -b 80m`) into `index.pck.part-*`
   because GitHub Pages rejects files over 100 MB. The patched
   `public/play/ghost/index.html` streams the parts, stitches them into a Blob
   and boots the engine with `mainPack` pointing at the Blob URL.
4. **Promo captures** — `tools/capture-ghost.mjs` drives the game with
   Playwright and screenshots the title screen and street for the landing page.

## Development

```bash
npm install
npm run dev          # all scene/asset data in public/ is pre-built
```

## Serving / deployment

Fully static: `npm run build` → `dist/`. A GitHub Actions workflow
(`.github/workflows/deploy.yml`) deploys to **GitHub Pages** on push to `main`:

1. Push this repo to GitHub (optimized assets in `public/` are committed, ~300 MB).
2. Settings → Pages → Source: "GitHub Actions".
3. Push to `main` — live at `https://<user>.github.io/<repo>/`.

## Stack

- [three.js](https://threejs.org/) — WebGL rendering (GLTF + Draco, animation mixer, EXR terrain, bloom)
- [Blender](https://www.blender.org/) headless — `.blend` → GLB export
- [Vite](https://vite.dev/) — dev server and bundling
- [glTF Transform](https://gltf-transform.dev/) + [sharp](https://sharp.pixelplumbing.com/) — asset optimization
- [Playwright](https://playwright.dev/) — thumbnail capture / smoke tests
