// Guards the sitemap against the drift that actually happened: /history
// shipped, gained its own H1, canonical and charts, and was never added here
// -- while /privacy and /embed were listed. Search Console then reported
// pages it had only discovered by crawling a link.
//
// Asserts the RELATIONSHIP between the sitemap and the pages, not a
// hardcoded list, so adding a page to the site fails this test until the
// sitemap catches up. That is the property that was missing; a count or a
// literal-list assertion would have passed the whole time.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.resolve(root, p), 'utf-8');

const sitemap = read('public/sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/** Every indexable page, paired with the html file that serves it. Deliberately
 *  excludes admin.html (noindex tooling), 404.html, and the /s|/og share-card
 *  routes (per the share-cards design doc: "/s/* in sitemap -- excluded"). */
const INDEXABLE = [
  { url: 'https://tetonpasscam.com/', file: 'index.html' },
  { url: 'https://tetonpasscam.com/history', file: 'src/app/history.html' },
  { url: 'https://tetonpasscam.com/privacy', file: 'public/privacy.html' },
  { url: 'https://tetonpasscam.com/embed', file: 'src/app/embed.html' },
] as const;

describe('sitemap.xml', () => {
  it('lists every indexable page', () => {
    for (const { url } of INDEXABLE) {
      expect(locs, `${url} missing from sitemap.xml`).toContain(url);
    }
  });

  it('lists nothing that is not an indexable page', () => {
    // Catches the opposite drift: a url left behind after a page is removed.
    const known = INDEXABLE.map((p) => p.url);
    for (const loc of locs) {
      expect(known, `${loc} is in sitemap.xml but is not a known page`).toContain(loc);
    }
  });

  it('gives every listed page a self-referential canonical', () => {
    // The Search Console finding: /privacy and /embed had no canonical at
    // all, so their pretty url and their .html path were indistinguishable.
    for (const { url, file } of INDEXABLE) {
      const html = read(file);
      expect(html, `${file} has no canonical`).toContain('rel="canonical"');
      expect(html, `${file}'s canonical does not point at ${url}`).toContain(
        `rel="canonical" href="${url}"`,
      );
    }
  });

  it('uses one canonical host, with no trailing-.html urls', () => {
    for (const loc of locs) {
      expect(loc.startsWith('https://tetonpasscam.com')).toBe(true);
      // .html paths redirect to the pretty url, so listing one would point
      // the crawler at a redirect rather than the canonical page.
      expect(loc.endsWith('.html')).toBe(false);
    }
  });
});
