#!/usr/bin/env node
// Generates public/icons/icon-192.png and icon-512.png from a small inline
// SVG glyph (mountain peaks over a road) using `sharp`, which is already a
// project dependency (transitive, via sharp's own postinstall binary --
// present in node_modules) rather than pulling in a new one just for this.
// Placeholder-quality art: Drew can swap these for real branded icons later
// by re-running this script with an edited SVG, or replacing the PNGs
// directly -- the manifest only cares about the file paths/sizes below.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(dirname, '../public/icons');

const SVG = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#1e293b"/>
  <polygon points="206,470 306,470 268,230 244,230" fill="#94a3b8"/>
  <line x1="256" y1="258" x2="256" y2="440" stroke="#f8fafc" stroke-width="12" stroke-dasharray="30 26" stroke-linecap="round"/>
  <polygon points="90,344 198,146 262,268 324,138 440,344" fill="#f8fafc"/>
  <polygon points="198,146 240,222 176,222" fill="#cbd5e1"/>
  <polygon points="324,138 362,208 302,208" fill="#cbd5e1"/>
</svg>
`.trim();

async function main() {
  await mkdir(outDir, { recursive: true });
  const svgBuffer = Buffer.from(SVG);

  for (const size of [192, 512]) {
    const png = await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toBuffer();
    const outPath = path.join(outDir, `icon-${size}.png`);
    await writeFile(outPath, png);
    console.log(`wrote ${outPath} (${png.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
