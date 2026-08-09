import type { ApiStatus } from '../../shared/types';

/**
 * Shown only when the pass is CLOSED (spec: "everyone's next question is
 * the Swan Valley/Alpine detour -- answer it in place"). The ~85 mi/~1h40
 * figure is the fixed typical detour distance/duration from the spec, not
 * derived from live data; `detours` layers the poller's live US-26/US-89
 * condition readings on top. Deliberately contains no reopening estimate
 * of any kind -- CLOSED copy must never guess when the pass will reopen.
 */
export default function DetourBlock({ detours }: { detours: ApiStatus['detours'] }) {
  return (
    <div className="mt-4 rounded-card bg-card p-3 text-sm text-ink">
      <p className="font-semibold">Detour: US-26 / US-89 via Swan Valley–Alpine</p>
      <p>~85 mi / ~1h40 typical, plus current detour conditions below.</p>
      {detours && detours.length > 0 && (
        <ul className="mt-2 space-y-1">
          {detours.map((d) => (
            <li key={d.route}>
              {d.route}: {d.conditionText}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
