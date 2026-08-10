/**
 * Explainer relocation (Drew-requested scope addition): the SEO H1 +
 * 124-word paragraph that used to sit at the top of the page now render
 * here, between Sponsor and Footer, for real users. The byte-frozen
 * original copy stays in index.html's `#seo-shell` -- untouched, still the
 * first thing crawlers and no-JS visitors see -- but main.tsx hides that
 * static block once React mounts, so `#seo-shell` and this component never
 * both show at once for a JS-enabled visitor.
 *
 * `ABOUT_H1`/`ABOUT_PARAGRAPH` below are independently-authored copies of
 * the same strings baked into index.html, not a shared import -- there's no
 * build-time link between a plain HTML file and this TSX module. Keep them
 * in sync by hand; test/app/About.test.tsx's byte-parity guard (reads
 * index.html, normalizes whitespace, compares) fails loudly if they drift.
 */
const ABOUT_H1 = 'Teton Pass — live cams & conditions';

const ABOUT_PARAGRAPH =
  'Teton Pass Cam shows the current status of Wyoming Highway 22 over Teton Pass, between ' +
  'Wilson, Wyoming and Victor, Idaho, refreshed automatically about every 10 minutes. The ' +
  'live banner above reflects WYDOT road-condition reports, cross-checked against Idaho 511 ' +
  'and highway sensor data, alongside summit weather readings, current drive-time estimates ' +
  'for the Victor-to-Jackson and Driggs-to-Jackson commutes, and recent community-submitted ' +
  'reports of crashes, slick spots, or wildlife on the roadway. This site is an independent, ' +
  'unofficial resource built for commuters and travelers -- it is not affiliated with, ' +
  "endorsed by, or operated by the Wyoming Department of Transportation. WYDOT's own " +
  '511wy.com remains the official and authoritative source for closures and travel ' +
  'advisories; always confirm current conditions there before deciding whether to cross, ' +
  'especially in winter weather.';

export default function About() {
  return (
    <section aria-label="About Teton Pass Cam" className="mt-4">
      {/* Section-heading scale (matches Cameras'/etc. `<h2>` sizing), not
          StatusBanner's giant top-of-page treatment -- this is the same H1
          text relocated, not a second hero headline. */}
      <h1 className="font-display text-[15px] font-bold">{ABOUT_H1}</h1>
      <p className="text-muted mt-1 text-[13px] leading-relaxed">{ABOUT_PARAGRAPH}</p>
    </section>
  );
}
