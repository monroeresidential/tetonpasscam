import { CLOSED_LEGAL_COPY } from '../../shared/legal';
import type { PassStatus } from '../../shared/types';
import { CARD_FONT_NAME_BODY, CARD_FONT_NAME_DISPLAY } from './fonts';

/** One drive-time row to render on the card, already resolved to a single
 *  reading per route (see data.ts) -- no `typicalSec`/delta copy, per the
 *  design doc's stripped-down card layout ("Victor → Jackson   38 min"). */
export interface CardRoute {
  name: string;
  durationSec: number;
}

export interface CardInput {
  status: PassStatus;
  /** Mirrors StatusBanner's `data.restrictions[0]` usage -- only the first
   *  restriction string is shown, same as the live banner. */
  restrictions: string[];
  /** Up to 3 rows, already filtered to the sharer's direction and ordered;
   *  see data.ts's `loadCardData`. Empty when the cycle had no fresh travel
   *  time for any of the routes. Capped at 3 (not 4) here so the larger
   *  share-legibility typography (option 3a) doesn't overflow the fixed
   *  630px card height. */
  routes: CardRoute[];
  /** The timestamp the "as of" footer reports -- resolved by the caller to
   *  whichever of wydotReportTime/capturedAt is trustworthy (same
   *  preference order as seo-inject.ts's `buildLiveStatusHtml`, duplicated
   *  rather than shared: see data.ts's comment on why). */
  asOfIso: string;
}

// Hex equivalents of the live UI's oklch status tokens (src/app/index.css)
// -- satori/resvg (the /og renderer's engine) doesn't support the oklch()
// color function, only hex/rgb(a)/hsl(a)/named colors, so these are
// pre-computed once here rather than re-derived at request time. Computed
// via the standard OKLab conversion (Björn Ottosson's formulas) from each
// token's exact L/C/H; `unknown` already had a plain hex in index.css
// (`--color-status-unknown: #8a8072`, no oklch involved) so it's copied
// verbatim instead of converted.
const STATUS_COLOR: Record<PassStatus, string> = {
  open: '#298646', // oklch(0.55 0.13 150)
  restricted: '#be7125', // oklch(0.62 0.13 60)
  closed: '#b02a2d', // oklch(0.5 0.17 25)
  unknown: '#8a8072', // index.css --color-status-unknown, same as --color-muted
};

const CREAM_BG = '#faf7f0'; // index.css --color-page
const INK = '#2b2620'; // index.css --color-ink
const MUTED = '#8a8072'; // index.css --color-muted
const CARD_BORDER = '#eae4d8'; // index.css --color-card-border

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  month: 'short',
  day: 'numeric',
});

/**
 * Neutralizes the one character that can actually break out of a text node
 * in the markup this module builds: `<`, which opens a new element for any
 * real HTML parser, including `HTMLRewriter` (what `workers-og` uses
 * internally to parse the HTML string this module hands it) -- a raw `<`
 * left in WYDOT-derived text (a restriction/condition string) could
 * otherwise inject an arbitrary element into the rendered card.
 *
 * Deliberately NOT the standard 5-character HTML-entity escape seo-inject.ts
 * and admin.html each use (`&amp;`/`&lt;`/`&gt;`/`&quot;`/`&#39;`) -- that
 * pattern assumes something downstream will entity-DECODE the result back
 * to the literal character when displaying it, same as every browser does.
 * Confirmed empirically (`wrangler dev` sample renders, see the design
 * doc's report) that `workers-og`'s pipeline does NOT decode entities when
 * compositing the final image: an escaped `<b>` rendered as the literal,
 * garbled text "&lt;b&gt;" rather than either a real element or safely
 * nothing. `>`/`&`/`"`/`'` need no neutralizing at all -- none of them can
 * open a new element (only `<` can), so leaving them completely as-is is
 * both safe and the only way they display correctly as literal characters.
 */
function sanitizeText(raw: string): string {
  return raw.replace(/</g, '');
}

/** Mirrors StatusBanner.tsx's headline copy per state (`The pass is OPEN`,
 *  `RESTRICTED — {restriction}`, `Closed — do not attempt`, `UNKNOWN — check
 *  Wyoming 511`) -- the card is a snapshot of the same product surface, so
 *  it uses the same words rather than inventing new phrasing. */
function headlineFor(status: PassStatus, restrictions: string[]): string {
  switch (status) {
    case 'open':
      return 'The pass is OPEN';
    case 'restricted':
      return `RESTRICTED${restrictions.length > 0 ? ` — ${restrictions[0]}` : ''}`;
    case 'closed':
      return 'Closed — do not attempt';
    case 'unknown':
      return 'UNKNOWN — check Wyoming 511';
  }
}

function minutesLabel(durationSec: number): string {
  return `${Math.round(durationSec / 60)} min`;
}

/** Route names from seed-routes.ts are e.g. "Victor → Jackson" -- a literal
 *  U+2192 RIGHTWARDS ARROW. Neither embedded card font (Atkinson
 *  Hyperlegible 400, Bricolage Grotesque 700/800 -- see fonts.ts) actually
 *  contains that glyph, and two attempts at drawing a substitute shape
 *  instead both failed empirically (via `wrangler dev` sample renders): a
 *  CSS border-triangle (zero-size box, transparent top/bottom borders, one
 *  solid side) rendered as a solid square, and an inline `<svg><path>`
 *  rendered as nothing at all -- `workers-og`'s HTML-string mode parses
 *  markup via `HTMLRewriter` (an HTML, not XML, parser), which doesn't
 *  reliably support a self-closing `<path .../>`. Simplest fix that
 *  actually renders correctly: swap the arrow for a plain ASCII `>`, always
 *  present in any Latin-text font's basic glyph set. */
function routeNameHtml(name: string): string {
  return sanitizeText(name.replace(' → ', ' > '));
}

/**
 * Builds the 1200x630 card's markup as a plain HTML string for `workers-og`
 * to parse (its `og()`/`ImageResponse` accept either a React element or an
 * HTML string, parsed via `HTMLRewriter` into the same satori element tree
 * either way) -- kept a pure function with zero Workers-runtime
 * dependencies so it's unit-testable without satori/resvg's WASM at all
 * (see test/worker/card-render.test.ts): assert the composed string
 * contains the right status text/routes/footer, independent of whether the
 * WASM rasterization stage works in a given test environment.
 *
 * Safety invariant (binding, see design doc): an UNKNOWN card must never
 * show drive times, even if the caller passed some in -- an unknown-status
 * share must not imply the pass is passable. Enforced here, not left to the
 * caller, since data.ts always fetches routes when they exist regardless of
 * status.
 */
export function buildCardHtml(input: CardInput): string {
  const { status, restrictions, asOfIso } = input;
  const color = STATUS_COLOR[status];
  const headline = sanitizeText(headlineFor(status, restrictions));
  const showRoutes = status !== 'unknown' && input.routes.length > 0;
  const asOfDate = new Date(asOfIso);
  const footer = `as of ${TIME_FMT.format(asOfDate)} MT · ${DATE_FMT.format(asOfDate)} · tetonpasscam.com`;

  const routeRowsHtml = input.routes
    .slice(0, 3)
    .map(
      (r) => `
        <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;width:100%;padding:20px 0;border-bottom:2px solid ${CARD_BORDER};">
          <span style="display:flex;font-family:'${CARD_FONT_NAME_BODY}';font-weight:700;font-size:60px;color:${INK};">${routeNameHtml(r.name)}</span>
          <span style="font-family:'${CARD_FONT_NAME_DISPLAY}';font-weight:700;font-size:64px;color:${INK};">${minutesLabel(r.durationSec)}</span>
        </div>`,
    )
    .join('');

  return `
  <div style="display:flex;flex-direction:column;width:1200px;height:630px;background-color:${CREAM_BG};font-family:'${CARD_FONT_NAME_BODY}';color:${INK};">
    <div style="display:flex;flex-direction:column;width:100%;background-color:${color};color:#ffffff;padding:56px 64px 40px 64px;">
      <div style="display:flex;font-family:'${CARD_FONT_NAME_DISPLAY}';font-weight:800;font-size:72px;line-height:1.08;">${headline}</div>
      ${
        status === 'closed'
          ? `<div style="display:flex;margin-top:18px;font-size:26px;font-weight:700;">${sanitizeText(CLOSED_LEGAL_COPY)}</div>`
          : ''
      }
    </div>
    <div style="display:flex;flex-direction:column;flex:1;width:100%;padding:32px 64px;">
      ${
        showRoutes
          ? `<div style="display:flex;flex-direction:column;width:100%;">${routeRowsHtml}</div>`
          : `<div style="display:flex;flex:1;"></div>`
      }
      <div style="display:flex;flex:1;"></div>
      <div style="display:flex;font-size:24px;color:${MUTED};">${sanitizeText(footer)}</div>
    </div>
  </div>`;
}
