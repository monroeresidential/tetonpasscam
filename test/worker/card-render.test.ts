// Pure-function layer of the /og share-card renderer (src/worker/card/
// render.ts): builds the HTML string `workers-og` parses into satori's
// element tree, with zero Workers-runtime/WASM dependency -- so this suite
// asserts status text/routes/footer content directly against that string,
// independent of whether satori/resvg's WASM initializes cleanly in a given
// test environment (the actual PNG rasterization is covered separately in
// test/worker/card-route.test.ts's real-render integration test).
import { describe, expect, it } from 'vitest';

import { CLOSED_LEGAL_COPY } from '../../src/shared/legal';
import { buildCardHtml } from '../../src/worker/card/render';
import type { CardInput } from '../../src/worker/card/render';

const AS_OF = '2026-08-10T20:15:00.000Z'; // 2:15 PM America/Denver (MDT, UTC-6 in August)

function baseInput(overrides: Partial<CardInput> = {}): CardInput {
  return {
    status: 'open',
    restrictions: [],
    routes: [],
    asOfIso: AS_OF,
    ...overrides,
  };
}

describe('buildCardHtml', () => {
  it('OPEN: headline + route rows + as-of footer', () => {
    const html = buildCardHtml(
      baseInput({
        routes: [
          { name: 'Victor → Jackson', durationSec: 38 * 60 },
          { name: 'Driggs → Jackson', durationSec: 46 * 60 },
        ],
      }),
    );
    expect(html).toContain('The pass is OPEN');
    // Rendered with a plain ASCII ">" in place of the DB's literal U+2192
    // arrow -- see render.ts's `routeNameHtml` comment on why (no embedded
    // font actually has that glyph, confirmed via wrangler-dev sample
    // renders).
    expect(html).toContain('Victor > Jackson');
    expect(html).toContain('38 min');
    expect(html).toContain('Driggs > Jackson');
    expect(html).toContain('46 min');
    expect(html).toContain('as of 2:15 PM MT · Aug 10 · tetonpasscam.com');
  });

  it('RESTRICTED: headline includes the first restriction string', () => {
    const html = buildCardHtml(
      baseInput({ status: 'restricted', restrictions: ['chains required', 'other'] }),
    );
    expect(html).toContain('RESTRICTED — chains required');
    expect(html).not.toContain('other');
  });

  it('RESTRICTED with no restriction strings: bare "RESTRICTED", no dangling dash', () => {
    const html = buildCardHtml(baseInput({ status: 'restricted', restrictions: [] }));
    expect(html).toContain('RESTRICTED');
    expect(html).not.toContain('RESTRICTED —');
  });

  it('CLOSED: headline + byte-exact legal copy, still shows the as-of footer', () => {
    const html = buildCardHtml(baseInput({ status: 'closed' }));
    expect(html).toContain('Closed — do not attempt');
    expect(html).toContain(CLOSED_LEGAL_COPY);
    expect(html).toContain('as of 2:15 PM MT · Aug 10 · tetonpasscam.com');
  });

  it('CLOSED with route rows present: still renders them (mirrors the live app, which shows drive times independent of status)', () => {
    const html = buildCardHtml(
      baseInput({ status: 'closed', routes: [{ name: 'Victor → Jackson', durationSec: 38 * 60 }] }),
    );
    expect(html).toContain('Victor > Jackson');
    expect(html).toContain('38 min');
  });

  it('UNKNOWN: never shows drive times, even if routes were passed in (safety invariant)', () => {
    const html = buildCardHtml(
      baseInput({
        status: 'unknown',
        routes: [{ name: 'Victor → Jackson', durationSec: 38 * 60 }],
      }),
    );
    expect(html).toContain('UNKNOWN — check Wyoming 511');
    expect(html).not.toContain('Victor &gt; Jackson');
    expect(html).not.toContain('38 min');
    // The as-of footer is mandatory on every variant, including UNKNOWN --
    // the card is a historical snapshot by design (design doc, binding).
    expect(html).toContain('as of 2:15 PM MT · Aug 10 · tetonpasscam.com');
  });

  it('zero routes (fresh cycle had none): omits the route section, keeps the footer', () => {
    const html = buildCardHtml(baseInput({ routes: [] }));
    expect(html).not.toMatch(/\d+ min/);
    expect(html).toContain('as of 2:15 PM MT · Aug 10 · tetonpasscam.com');
  });

  it('caps route rows at 3 even if more are passed in', () => {
    const routes = Array.from({ length: 6 }, (_, i) => ({
      name: `Route ${i}`,
      durationSec: (30 + i) * 60,
    }));
    const html = buildCardHtml(baseInput({ routes }));
    for (let i = 0; i < 3; i++) expect(html).toContain(`Route ${i}`);
    expect(html).not.toContain('Route 3');
    expect(html).not.toContain('Route 4');
    expect(html).not.toContain('Route 5');
  });

  it('neutralizes an HTML-significant restriction string (XSS regression pin -- strips "<", not HTML-entity-escapes: see render.ts\'s `sanitizeText` comment on why)', () => {
    const html = buildCardHtml(
      baseInput({ status: 'restricted', restrictions: ['<script>alert(1)</script>'] }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('script>alert(1)/script>');
  });

  it('neutralizes an HTML-significant route name', () => {
    const html = buildCardHtml(
      baseInput({ routes: [{ name: '<b>Victor</b> → Jackson', durationSec: 60 }] }),
    );
    expect(html).not.toContain('<b>Victor</b>');
    expect(html).toContain('b>Victor/b> > Jackson');
  });

  // Share-legibility restyle (option 3a): bigger, bolder route-row and
  // headline typography so the card reads at share-sheet thumbnail sizes.
  it('uses the larger option-3a typography for headline and route rows', () => {
    const html = buildCardHtml(
      baseInput({ routes: [{ name: 'Victor → Jackson', durationSec: 38 * 60 }] }),
    );
    expect(html).toContain('font-size:72px'); // headline
    expect(html).toContain('font-weight:700;font-size:60px'); // route name
    expect(html).toContain('font-size:64px'); // route time
    expect(html).toContain('padding:20px 0'); // row padding
  });
});
