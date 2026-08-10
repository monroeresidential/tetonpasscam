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
