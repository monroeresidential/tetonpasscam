#!/usr/bin/env node
// Generates public/og.jpg (the og:image / twitter:image social-preview
// asset) from a live camera frame dropped at the worktree root as
// og-source.png -- deliberately never committed (raw, unprocessed 1280x720
// capture), same "one-off source, derived asset checked in instead" pattern
// as generate-sponsor-image.mjs.
//
// The source frame carries WYDOT's own timestamp/copyright overlay burned
// into the top of the image (`www.wyoroad.info <date>` + copyright line);
// that's fine on the live camera tiles (it's attributed imagery) but reads
// oddly as our own share-card branding, so the top 56px is cropped off
// before the cover-resize to the OG-standard 1200x630.
//
// Deliberately .jpg, not .png: like the sponsor image, this is outside
// vite.config.ts's PWA `globPatterns` (`jpg` isn't listed), so it stays out
// of the service worker precache -- a one-time social-preview asset has no
// business bloating the installable app shell.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(dirname, '../og-source.png');
const outPath = path.resolve(dirname, '../public/og.jpg');

const CROP_TOP = 56;

async function main() {
  const source = sharp(sourcePath);
  const meta = await source.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`could not read dimensions of ${sourcePath}`);
  }

  const jpeg = await source
    .extract({ left: 0, top: CROP_TOP, width: meta.width, height: meta.height - CROP_TOP })
    .resize({ width: 1200, height: 630, fit: 'cover' })
    .jpeg({ quality: 75 })
    .toBuffer();

  await writeFile(outPath, jpeg);
  console.log(`wrote ${outPath} (${jpeg.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
