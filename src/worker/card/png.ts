import { ImageResponse } from 'workers-og';

import { CARD_FONTS } from './fonts';
import { buildCardHtml } from './render';
import type { CardInput } from './render';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * Rasterizes `buildCardHtml`'s output to a PNG via `workers-og` (satori for
 * layout/text, `@resvg/resvg-wasm` for the final PNG encode -- both bundled
 * into the `workers-og` npm package, chosen over wiring satori+resvg
 * directly per the design doc's "workers-og if it fits cleanly"). Kept as
 * its own thin module, separate from `render.ts`'s pure HTML builder, so
 * the WASM-dependent stage is the only thing a test needs to skip if
 * resvg's WASM doesn't initialize cleanly in vitest-pool-workers (see
 * test/worker/card-render.test.ts) -- the HTML/layout/content logic is
 * fully covered without ever reaching this function.
 *
 * `og()` (the lower-level function) exists in the package but isn't part of
 * its public exports (only `ImageResponse`/`loadGoogleFont` are, confirmed
 * against dist/index.d.ts) -- `ImageResponse` is used instead, same class
 * `@vercel/og` popularized: its constructor doesn't return `this` the
 * normal way, it returns a Promise (an object, which JS constructors are
 * allowed to substitute for the constructed instance) that resolves to a
 * real `Response` once satori/resvg finish -- `await`ing the `new
 * ImageResponse(...)` expression is the documented usage.
 *
 * Returns the raw `ArrayBuffer` rather than a `Uint8Array` wrapper --
 * `Response`'s `BodyInit` accepts an `ArrayBuffer` directly, and current
 * TypeScript/DOM-lib versions type typed arrays generically over their
 * buffer type (`Uint8Array<ArrayBufferLike>` by default), which doesn't
 * structurally match the narrower `Uint8Array<ArrayBuffer>` `BodyInit`
 * expects -- passing the `ArrayBuffer` straight through sidesteps that
 * mismatch entirely rather than fighting it with a cast.
 */
export async function renderCardPng(input: CardInput): Promise<ArrayBuffer> {
  const html = buildCardHtml(input);
  const response = await new ImageResponse(html, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: CARD_FONTS,
    format: 'png',
  });
  return response.arrayBuffer();
}
