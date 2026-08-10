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
 *
 * The visible FAQ section below (SEO audit fix #1) is the same treatment:
 * an independently-authored copy of index.html's #seo-shell FAQ, kept in
 * sync by hand and guarded by the same byte-parity pattern in
 * test/app/About.test.tsx, one entry per Q&A.
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

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Is Teton Pass open right now?',
    answer:
      'The live status banner at the top of this page shows the current WYDOT-reported status ' +
      'for Wyoming Highway 22 over Teton Pass -- open, restricted, closed, or unknown -- ' +
      'refreshed automatically about every 10 minutes. WYDOT and Wyoming 511 (511wy.com) are the ' +
      'official, authoritative source for Teton Pass conditions. When the pass is posted closed, ' +
      'that is a legal closure under Wyoming law, not a suggestion: driving past a closure ' +
      'barricade can carry a fine of up to $750. If the banner shows unknown, it means our own ' +
      'data is stale or unavailable -- treat that as a reason to check Wyoming 511 directly ' +
      'before heading up, not as a sign the road is open.',
  },
  {
    question: 'How long is the drive from Victor to Jackson?',
    answer:
      'In normal conditions, the drive from Victor, Idaho to Jackson, Wyoming over Teton Pass ' +
      'typically takes about 35 to 45 minutes. This site shows live, traffic-aware drive times ' +
      "pulled throughout the day, and -- as its history grows -- how today's time compares with " +
      'the typical time for the same hour and season, so you can tell at a glance whether the ' +
      'pass is running slower than usual. Winter storms, avalanche control closures, and ' +
      "slide-offs on the pass's steep grades can add significant time or close the route " +
      'outright, so always check the live status banner above alongside the drive-time estimate.',
  },
  {
    question: 'Which cameras does this site show?',
    answer:
      'Teton Pass Cam displays three live camera feeds: WYO 22 Teton Pass -- East, WYO 22 Teton ' +
      'Pass -- West, and a Jackson Hole Valley view. Together these cameras let you see current ' +
      'road surface, snowpack, and visibility conditions on both sides of the summit, plus a look ' +
      'down into the valley, without waiting for a written report to update. All camera imagery ' +
      "is courtesy of WYDOT and Wyoming 511 (511wy.com), refreshed on the same cadence as the " +
      "rest of this site's data.",
  },
  {
    question: 'Why does the pass close?',
    answer:
      'Teton Pass closes most often for winter storms, scheduled avalanche control work near the ' +
      "summit, and slide-offs or crashes on the pass's steep 10% grades. Most closures last a few " +
      'hours rather than days, but duration depends entirely on conditions and cannot be ' +
      'predicted in advance -- this site never publishes an estimated reopening time, because ' +
      "WYDOT itself doesn't commit to one until the road is actually clear. When Teton Pass is " +
      'closed, the usual alternative route is Swan Valley/Alpine via US-26 and US-89, roughly 85 ' +
      'miles and about 1 hour 40 minutes in good conditions. Always confirm current status and ' +
      'any detour guidance on Wyoming 511 before you commit to a route.',
  },
];

export default function About() {
  return (
    <section aria-label="About Teton Pass Cam" className="mt-4">
      {/* Section-heading scale (matches Cameras'/etc. `<h2>` sizing), not
          StatusBanner's giant top-of-page treatment -- this is the same H1
          text relocated, not a second hero headline. */}
      <h1 className="font-display text-[15px] font-bold">{ABOUT_H1}</h1>
      <p className="text-muted mt-1 text-[13px] leading-relaxed">{ABOUT_PARAGRAPH}</p>

      <h2 className="font-display mt-4 text-[15px] font-bold">Frequently asked questions</h2>
      {FAQ_ITEMS.map((item) => (
        <div key={item.question} className="mt-3">
          <h3 className="text-[13px] font-bold">{item.question}</h3>
          <p className="text-muted mt-1 text-[13px] leading-relaxed">{item.answer}</p>
        </div>
      ))}

      <p className="text-muted mt-3 text-[13px]">
        <a href="/privacy" className="underline">
          Privacy policy
        </a>{' '}
        ·{' '}
        <a href="https://www.wyoroad.info" className="underline">
          Wyoming 511
        </a>{' '}
        ·{' '}
        <a href="https://511.idaho.gov" className="underline">
          Idaho 511
        </a>
      </p>
    </section>
  );
}
