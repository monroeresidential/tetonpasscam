#!/usr/bin/env node
// Generates public/sponsor-tetonflats.jpg from Drew's kitchen-interior photo
// for the sponsor card redesign. Source is a one-off 1600x1200 PNG dropped
// at the worktree root as sponsor-source.png -- deliberately never
// committed (raw, unprocessed, 1.2MB); re-run this script against a fresh
// drop of that file (or an updated photo) to regenerate the derived asset.
//
// Deliberately .jpg, not .png: vite.config.ts's PWA `globPatterns` covers
// `png` but not `jpg`, so this sponsor image -- a non-critical, easily
// swappable asset, unlike the app icons generate-icons.mjs produces --
// stays out of the service worker's precache instead of bloating it.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(dirname, '../sponsor-source.png');
const outPath = path.resolve(dirname, '../public/sponsor-tetonflats.jpg');

async function main() {
  const jpeg = await sharp(sourcePath)
    .resize({ width: 640 })
    .jpeg({ quality: 72 })
    .toBuffer();
  await writeFile(outPath, jpeg);
  console.log(`wrote ${outPath} (${jpeg.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
