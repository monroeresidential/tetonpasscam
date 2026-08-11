// Font data for the /og share-card renderer (satori, via `workers-og`).
// satori embeds fonts by reading raw font-file bytes directly -- it accepts
// woff/ttf but NOT woff2 (unlike a browser, it has no woff2 decompressor
// built in). The rest of this app self-hosts woff2-only for the live UI
// (see index.css's own comment), so these are separate, WOFF-specific
// imports used ONLY by the card renderer:
//   - Bricolage Grotesque: the live UI uses `@fontsource-variable/
//     bricolage-grotesque` (one variable-weight woff2 covering every
//     weight), but a variable font has no fixed-weight woff/ttf to hand
//     satori. `@fontsource/bricolage-grotesque` (the static, per-weight
//     sibling package) ships woff (and woff2) files per weight instead, so
//     it's installed as an additional dependency for exactly the two
//     weights the card design needs (700/800).
//   - Atkinson Hyperlegible: `@fontsource/atkinson-hyperlegible` already
//     ships static woff files per weight (same package the live UI uses,
//     see index.css) -- weights 400 and 700 (the option-3a route-row
//     restyle bolds the route name from 400 to 700; satori has no
//     synthetic-bold fallback for a weight it wasn't explicitly handed, it
//     just silently draws the nearest weight it does have, so the 700 file
//     must be registered here too or `font-weight:700` in render.ts's
//     route-name span renders as plain 400 -- confirmed empirically via a
//     wrangler-dev sample render before this file was bundled).
//
// Bundling: these `.woff` imports are resolved by WRANGLER's bundler (this
// file is only ever imported from Worker code, never from Vite/the React
// app), via the `[[rules]]` entry in wrangler.toml declaring `type = "Data"`
// for `**/*.woff` -- wrangler hands back the raw file bytes as an
// ArrayBuffer at runtime. Vite's own ambient typing (`vite/client`, pulled
// in project-wide by tsconfig.json's `types` array) separately declares
// `declare module '*.woff' { const src: string; export default src }` for
// its own (URL-string) asset handling -- that's the *type* TypeScript sees
// here (a harmless mismatch since Vite never actually processes this file),
// so each import below is cast to `ArrayBuffer`, the real runtime shape
// wrangler's Data rule produces.
import bricolage700Woff from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff';
import bricolage800Woff from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff';
import atkinson400Woff from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff';
import atkinson700Woff from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff';

const bricolage700 = bricolage700Woff as unknown as ArrayBuffer;
const bricolage800 = bricolage800Woff as unknown as ArrayBuffer;
const atkinson400 = atkinson400Woff as unknown as ArrayBuffer;
const atkinson700 = atkinson700Woff as unknown as ArrayBuffer;

export const CARD_FONT_NAME_DISPLAY = 'Bricolage Grotesque';
export const CARD_FONT_NAME_BODY = 'Atkinson Hyperlegible';

/** `workers-og`'s `fonts` option shape (mirrors `@vercel/og`'s satori-backed
 *  API): one entry per (family, weight) pair actually used by
 *  `buildCardHtml` -- satori only rasterizes glyphs from a font it was
 *  explicitly handed, there is no "load whatever's installed" fallback. */
export const CARD_FONTS = [
  { name: CARD_FONT_NAME_DISPLAY, data: bricolage800, weight: 800 as const, style: 'normal' as const },
  { name: CARD_FONT_NAME_DISPLAY, data: bricolage700, weight: 700 as const, style: 'normal' as const },
  { name: CARD_FONT_NAME_BODY, data: atkinson400, weight: 400 as const, style: 'normal' as const },
  { name: CARD_FONT_NAME_BODY, data: atkinson700, weight: 700 as const, style: 'normal' as const },
];
