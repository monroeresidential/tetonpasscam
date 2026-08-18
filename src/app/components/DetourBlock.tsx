import { summarizeDetours } from '../detourSummary';
import type { ApiStatus } from '../../shared/types';

/**
 * Shown only when the pass is CLOSED (spec: "everyone's next question is
 * the Swan Valley/Alpine detour -- answer it in place"). The ~85 mi/~1h40
 * figure is the fixed typical detour distance/duration from the spec, not
 * derived from live data; `detours` layers the poller's live US-26/US-89
 * condition readings on top. Deliberately contains no reopening estimate
 * of any kind -- CLOSED copy must never guess when the pass will reopen.
 *
 * The live readings go through `summarizeDetours` rather than being printed
 * verbatim: WYDOT's per-segment prose ran to ~9 phone lines, every one of
 * them saying "Dry" (screenshots, 2026-08-18). See that module for what it
 * will and will not collapse.
 */
export default function DetourBlock({ detours }: { detours: ApiStatus['detours'] }) {
  const lines = summarizeDetours(detours);
  return (
    <div className="mt-4 rounded-card bg-card p-3 text-sm text-ink">
      <p className="font-semibold">Detour · Swan Valley–Alpine</p>
      {/* The old second line ended "plus current detour conditions below",
          which spent a line pointing at the element directly beneath it. */}
      <p>US-26/US-89 · ~85 mi · ~1h40</p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-1">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
