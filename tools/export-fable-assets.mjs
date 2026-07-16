// Export the curated Fable-authored Blender assets to GLB while preserving
// materials, embedded textures, and the full scene-timeline animation.
//
// Usage: node tools/export-fable-assets.mjs [--force]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FABLE_ASSETS, FABLE_GLB_ROOT, PORTFOLIO_ROOT } from './fable-assets.config.mjs';

const BLENDER = process.env.BLENDER_BIN || '/Applications/Blender.app/Contents/MacOS/Blender';
const EXPORT_SCRIPT = path.join(PORTFOLIO_ROOT, 'tools', 'export-blend.py');
const FORCE = process.argv.includes('--force');

if (!fs.existsSync(BLENDER)) {
  throw new Error(`Blender executable not found: ${BLENDER}`);
}

fs.mkdirSync(FABLE_GLB_ROOT, { recursive: true });

for (const item of FABLE_ASSETS) {
  if (!fs.existsSync(item.blend)) {
    throw new Error(`Missing source blend for ${item.slug}: ${item.blend}`);
  }

  const out = path.join(FABLE_GLB_ROOT, `${item.slug}.glb`);
  const exportScript = item.exportScript
    ? path.join(PORTFOLIO_ROOT, 'tools', item.exportScript)
    : EXPORT_SCRIPT;
  if (!fs.existsSync(exportScript)) {
    throw new Error(`Missing export script for ${item.slug}: ${exportScript}`);
  }
  const inputMtime = Math.max(
    fs.statSync(item.blend).mtimeMs,
    fs.statSync(exportScript).mtimeMs,
  );
  if (!FORCE && fs.existsSync(out) && fs.statSync(out).mtimeMs > inputMtime) {
    console.log(`skip ${item.slug}`);
    continue;
  }

  console.log(`export ${item.slug}`);
  const result = spawnSync(
    BLENDER,
    ['-b', item.blend, '-P', exportScript, '--', out, '--object', '--bake-animation'],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const summary = output.match(/^EXPORT_OK::.+$/m)?.[0];
  if (result.status !== 0 || !summary || !fs.existsSync(out)) {
    console.error(output);
    throw new Error(`Blender export failed for ${item.slug}`);
  }
  console.log(summary);
}

console.log(`DONE ${FABLE_ASSETS.length} Fable assets`);
