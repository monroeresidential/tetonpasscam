// Regression pin (Trailhead restyle Task 1) for the safety-relevant design
// tokens defined in src/app/index.css: the four status colors (which state
// -- open/restricted/closed/unknown -- gets which color is exactly the kind
// of thing that must never silently drift) plus the dark-mode override of
// status-open, which is the one status color the spec's dark set actually
// overrides. Reads the CSS source as text rather than rendering it, since
// jsdom does not evaluate `@theme`/`@media (prefers-color-scheme)` the way a
// real browser does -- a plain string match against the source is the
// reliable way to pin these values.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Comments are stripped before matching -- index.css documents the dark
// override mechanism in a comment that itself contains the literal text
// "@media (prefers-color-scheme: dark) { :root { ... } }" as prose, which
// would otherwise satisfy the block-boundary regexes below and pull in the
// wrong (comment) text instead of the real rule.
const css = readFileSync(path.resolve(__dirname, '../../src/app/index.css'), 'utf-8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

// Isolates the light `@theme { ... }` block from the dark
// `@media (prefers-color-scheme: dark) { :root { ... } }` block so the two
// assertions below can't accidentally match the wrong one.
const themeMatch = css.match(/@theme\s*{([\s\S]*?)\n}/);
const darkMatch = css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([\s\S]*?)\n  }/);

if (!themeMatch) throw new Error('tokens.test.ts: could not find @theme block in index.css');
if (!darkMatch) throw new Error('tokens.test.ts: could not find dark :root override block in index.css');

const lightTheme = themeMatch[1];
const darkTheme = darkMatch[1];

// index.html's <meta name="theme-color"> drives browser-chrome tinting for
// a plain tab view (route-22 brand kit: cream light / ink dark, media-scoped
// so it also flips with the OS). The PWA manifest's theme_color (installed
// view) is a separate, unscoped value the logo-4c brand kit doesn't touch --
// see vite.config.ts's comment. Pinned here (not in
// test/parsers/index-html.test.ts, which stays byte-frozen to the SEO-shell
// strings) since this is a design-token consistency check, not SEO content.
const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');

// Isolates index.html's own <style> block so the dark-shell assertion below
// can't accidentally match some unrelated part of the document (e.g. the
// JSON-LD script or a future style block elsewhere in <head>).
const htmlStyleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!htmlStyleMatch) throw new Error('tokens.test.ts: could not find <style> block in index.html');
const htmlStyle = htmlStyleMatch[1];

describe('design tokens (src/app/index.css)', () => {
  it('pins the light-mode status colors', () => {
    expect(lightTheme).toMatch(/--color-status-open:\s*oklch\(0\.55 0\.13 150\);/);
    expect(lightTheme).toMatch(/--color-status-restricted:\s*oklch\(0\.62 0\.13 60\);/);
    expect(lightTheme).toMatch(/--color-status-closed:\s*oklch\(0\.5 0\.17 25\);/);
    expect(lightTheme).toMatch(/--color-status-unknown:\s*#8a8072;/);
  });

  it('pins the dark-mode status-open override (the one status color the dark set changes)', () => {
    expect(darkTheme).toMatch(/--color-status-open:\s*oklch\(0\.45 0\.11 150\);/);
  });

  it('pins the icon-tile token (light and dark)', () => {
    expect(lightTheme).toMatch(/--color-icon-tile:\s*oklch\(0\.93 0\.04 60\);/);
    expect(darkTheme).toMatch(/--color-icon-tile:\s*oklch\(0\.34 0\.03 60\);/);
  });

  it('pins the danger token (light and dark) -- error/rate-limit copy in ReportModal/Footer', () => {
    expect(lightTheme).toMatch(/--color-danger:\s*oklch\(0\.55 0\.15 30\);/);
    expect(darkTheme).toMatch(/--color-danger:\s*oklch\(0\.72 0\.14 30\);/);
  });

  it('does not override status-restricted/closed/unknown in dark mode (unchanged per spec)', () => {
    expect(darkTheme).not.toMatch(/--color-status-restricted:/);
    expect(darkTheme).not.toMatch(/--color-status-closed:/);
    expect(darkTheme).not.toMatch(/--color-status-unknown:/);
  });

  it("index.html has media-scoped theme-color metas for light/dark browser chrome (route-22 brand kit)", () => {
    // These track the logo-4c brand kit's cream/ink palette (#faf7f0 light,
    // #211d17 dark), not the PWA manifest's theme_color (#2b2620, unchanged
    // -- the brand kit's README is silent on manifest colors, so
    // vite.config.ts keeps the pre-existing --color-ink value there).
    expect(html).toContain(
      '<meta name="theme-color" content="#faf7f0" media="(prefers-color-scheme: light)" />',
    );
    expect(html).toContain(
      '<meta name="theme-color" content="#211d17" media="(prefers-color-scheme: dark)" />',
    );
  });

  it("index.html's static SEO shell has a dark-mode override (no permanent light band over the dark app)", () => {
    // The dark override block exists at all and repaints #seo-shell's
    // background to the same dark `--color-page` literal src/app/index.css
    // uses (#211d17).
    const darkBlockMatch = htmlStyle.match(/@media \(prefers-color-scheme: dark\)\s*{([\s\S]*)}/);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch![1];
    expect(darkBlock).toMatch(/#seo-shell\s*{[^}]*background:\s*#211d17;/);
  });
});
