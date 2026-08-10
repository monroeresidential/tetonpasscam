// Regression pin (SEO fix wave, Critical #2): the installed PWA's service
// worker must never intercept a navigation to /admin, /privacy, or their
// .html originals and silently serve the app shell instead of the real
// static page. vite-plugin-pwa's `navigateFallbackDenylist` is the only
// thing preventing that (see vite.config.ts's own comment on why an empty
// denylist would swallow every same-origin navigation). Pinned as raw
// source text (same technique as tokens.test.ts) rather than by rendering
// the built dist/sw.js, since this suite (jsdom, no build step) has no
// access to a fresh production build; the empirical dist/sw.js check lives
// in the SEO T2 report's manual-verification transcript instead.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../vite.config.ts'), 'utf-8');

const denylistMatch = source.match(/navigateFallbackDenylist:\s*\[([\s\S]*?)\]/);
if (!denylistMatch) {
  throw new Error('pwa-config.test.ts: could not find navigateFallbackDenylist in vite.config.ts');
}
const denylistSource = denylistMatch[1];

describe('vite.config.ts PWA navigateFallbackDenylist', () => {
  it('denylists both the .html originals and the pretty URLs for /admin and /privacy', () => {
    expect(denylistSource).toMatch(/\/\^\\\/admin\\\.html\$\//);
    expect(denylistSource).toMatch(/\/\^\\\/privacy\\\.html\$\//);
    expect(denylistSource).toMatch(/\/\^\\\/admin\$\//);
    expect(denylistSource).toMatch(/\/\^\\\/privacy\$\//);
  });

  it('still denylists /api/ defensively', () => {
    expect(denylistSource).toMatch(/\/\^\\\/api\\\//);
  });
});
