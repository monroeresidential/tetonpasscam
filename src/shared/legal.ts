/**
 * The byte-frozen CLOSED-state legal sentence (Wyoming closure is a legal
 * prohibition, W.S. 24-1-109 -- CLAUDE.md hard rule #5: must say "do not
 * attempt", never "not recommended", and must never invent a reopening
 * estimate). Hoisted here (share-cards T1) so every surface that renders a
 * CLOSED state -- the live StatusBanner, the edge-injected crawler snapshot
 * (seo-inject.ts), and the /og share-card renderer -- shows the identical
 * wording from one source rather than three independently-maintained copies
 * that could drift apart.
 */
export const CLOSED_LEGAL_COPY =
  'Closed — do not attempt. Traveling a closed Wyoming road is illegal (up to $750 fine).';

/**
 * The same warning for the live StatusBanner, whose own headline already reads
 * "Closed" in 40px type directly above it.
 *
 * Rendering CLOSED_LEGAL_COPY there printed "Closed — do not attempt" twice
 * within two lines of each other (mobile screenshots, 2026-08-18) while the
 * headline itself wrapped across four lines, pushing the detour -- the thing a
 * driver at a closed pass actually needs -- below the fold. Drew's call: the
 * headline says the state, this line says what to do about it.
 *
 * Hard rule #5 is preserved, not weakened: "do not attempt" is still stated
 * verbatim, still directly under the headline, still at full weight, and the
 * statutory consequence still names a figure. Only the duplicated "Closed —"
 * is gone. The surfaces with no separate headline of their own -- the
 * crawler snapshot and the /og share card -- keep CLOSED_LEGAL_COPY above,
 * where the full self-contained sentence is what they need.
 */
export const CLOSED_BANNER_WARNING =
  'Do not attempt. A closed Wyoming road is illegal — up to $750.';
