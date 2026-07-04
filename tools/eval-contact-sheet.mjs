// Builds a labeled contact sheet from the eval scene renders in /tmp/eval-renders.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SRC = '/tmp/eval-renders';
const OUT = path.join(process.env.HOME, 'Desktop/eval-blends/summary.png');

const RUNS = [
  { id: 'run1-65561cdc', label: 'RUN 1 (65561cdc)' },
  { id: 'run2-7ecaa3c8', label: 'RUN 2 (7ecaa3c8)' },
];
const PROMPTS = [
  'avatar-pandora-forest', 'cambridge-university', 'dune-desert-village',
  'elden-ring-castle', 'gta5-los-santos', 'hogwarts-grounds',
  'japanese-shrine-night', 'jurassic-park-gate', 'medieval-kingdom',
  'post-apocalyptic-city', 'times-square', 'zelda-breath-of-the-wild-village',
];

const CELL_W = 560, CELL_H = 315, LABEL_H = 34, PAD = 10;
const PAIRS_PER_ROW = 2; // prompt pairs side by side: (run1, run2) | (run1, run2)
const COLS = PAIRS_PER_ROW * 2;
const ROWS = Math.ceil(PROMPTS.length / PAIRS_PER_ROW);
const HEADER = 64;
const W = COLS * (CELL_W + PAD) + PAD;
const H = HEADER + ROWS * (CELL_H + LABEL_H + PAD) + PAD;

const svgText = (text, w, h, size, color, weight = 'bold', anchor = 'start', x = 8) => Buffer.from(
  `<svg width="${w}" height="${h}"><text x="${anchor === 'middle' ? w / 2 : x}" y="${h / 2 + size * 0.35}"
     font-family="Menlo, monospace" font-size="${size}" font-weight="${weight}" fill="${color}"
     text-anchor="${anchor}">${text}</text></svg>`,
);

const composites = [
  { input: { create: { width: W, height: H, channels: 3, background: '#101218' } }, top: 0, left: 0 },
  { input: svgText('Blender Reconstruct-Scene Evals — 12 prompts × 2 runs (rendered from downloaded .blend files)', W, HEADER, 22, '#e8eaf2', 'bold', 'middle'), top: 0, left: 0 },
];

for (let i = 0; i < PROMPTS.length; i++) {
  const prompt = PROMPTS[i];
  const row = Math.floor(i / PAIRS_PER_ROW);
  const pairCol = i % PAIRS_PER_ROW;
  for (let r = 0; r < RUNS.length; r++) {
    const col = pairCol * 2 + r;
    const x = PAD + col * (CELL_W + PAD);
    const y = HEADER + row * (CELL_H + LABEL_H + PAD);
    const img = path.join(SRC, `${RUNS[r].id}__${prompt}.png`);
    // label bar
    composites.push({ input: { create: { width: CELL_W, height: LABEL_H, channels: 3, background: '#1a1d28' } }, top: y, left: x });
    composites.push({ input: svgText(`${prompt}  ·  ${RUNS[r].label}`, CELL_W, LABEL_H, 14, r === 0 ? '#8ef0c0' : '#7c9eff'), top: y, left: x });
    if (fs.existsSync(img)) {
      const buf = await sharp(img).resize(CELL_W, CELL_H, { fit: 'cover' }).toBuffer();
      composites.push({ input: buf, top: y + LABEL_H, left: x });
    } else {
      composites.push({ input: { create: { width: CELL_W, height: CELL_H, channels: 3, background: '#181a22' } }, top: y + LABEL_H, left: x });
      composites.push({ input: svgText('eval errored — no scene generated', CELL_W, CELL_H, 16, '#5c6275', 'normal', 'middle'), top: y + LABEL_H, left: x });
    }
  }
}

await sharp({ create: { width: W, height: H, channels: 3, background: '#101218' } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(OUT);
console.log('wrote', OUT, `${W}x${H}`);
