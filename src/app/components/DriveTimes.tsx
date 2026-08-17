import type { ApiStatus } from '../../shared/types';
import Segmented from './Segmented';

type Direction = 'eb' | 'wb';
export type Town = 'victor' | 'driggs';
type TravelTime = ApiStatus['travelTimes'][number];

function directionOf(slug: string): Direction | null {
  if (slug.endsWith('-eb')) return 'eb';
  if (slug.endsWith('-wb')) return 'wb';
  return null;
}

// Destination sublabel is a route-pair identity, not a direction: it comes
// from the slug's non-Idaho-side segment (see seed-routes.ts slugPrefixes),
// so the same route reads "Town Square"/"JHMR"/"Airport" whichever way it's
// flipped.
function sublabelFor(slug: string): string {
  if (slug.includes('tetonvillage')) return 'JHMR';
  if (slug.includes('airport')) return 'Airport';
  return 'Town Square';
}

// Ruling R3: the Idaho town is the slug's FIRST segment regardless of
// direction -- seed-routes.ts builds every slug as
// `${idahoSlug}-${jacksonSlug}-${direction}` (e.g. `victor-jackson-eb`,
// `driggs-airport-wb`), so the Idaho side never moves to the end just because
// a route is reversed. This is the same reasoning `sublabelFor` above already
// relies on: the slug's segments are a route-pair identity, not an
// origin/destination pairing. Implementing this as "eb: filter by origin, wb:
// filter by destination" would reintroduce a direction dependency the slug
// design deliberately removed, for the same three-line answer either way.
export function idahoTownOf(slug: string): Town | null {
  if (slug.startsWith('victor-')) return 'victor';
  if (slug.startsWith('driggs-')) return 'driggs';
  return null;
}

type DeltaTone = 'pos' | 'neg' | 'muted';

const DELTA_TONE_CLASS: Record<DeltaTone, string> = {
  pos: 'text-delta-pos',
  neg: 'text-delta-neg',
  muted: 'text-muted',
};

// Verbal delta mapping (spec, verbatim): diffSec = durationSec - typicalSec.
// Threshold-then-round, in that order: the +-5min band ("about usual") is
// decided on the raw SIGNED SECOND value (-300s/+300s exactly at the edge),
// and only once a band is crossed do we round the seconds to whole minutes
// for display. Rounding to minutes first and thresholding on that would pull
// -299s (Math.round(-299/60) = -5) into the "faster" band, contradicting the
// -299s => "about usual" pin -- so the raw-second comparison must come first.
function deltaCopy(durationSec: number, typicalSec: number | null): { text: string; tone: DeltaTone } | null {
  if (typicalSec === null) return null;
  const diffSec = durationSec - typicalSec;
  if (diffSec <= -300) {
    const diffMin = Math.round(diffSec / 60);
    return { text: `${-diffMin} min faster than usual`, tone: 'pos' };
  }
  if (diffSec >= 300) {
    const diffMin = Math.round(diffSec / 60);
    return { text: `${diffMin} min slower than usual`, tone: 'neg' };
  }
  return { text: 'about usual', tone: 'muted' };
}

// "10:50 PM" -- no date, since overnight staleness is never ambiguous (a
// reading timestamped 10:50 PM read at 3 AM obviously means the evening
// before). Used once now, in the section header's "Updated ..." freshness
// line -- no longer per row (see DriveTimeCard below).
function formatAsOf(capturedAt: string): string {
  return new Date(capturedAt).toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  });
}

function DriveTimeCard({ travelTime }: { travelTime: TravelTime }) {
  // A stale row shows the muted numeral and nothing beneath it -- no delta
  // (it would be comparing a stale duration to "usual") and no per-row "as
  // of" timestamp (freshness is now stated once, in the section header).
  const delta = travelTime.stale ? null : deltaCopy(travelTime.durationSec, travelTime.typicalSec);
  const minutes = Math.round(travelTime.durationSec / 60);

  return (
    <li
      data-testid="drive-row"
      className="bg-card border border-card-border rounded-card flex items-center justify-between px-3.5 py-3"
    >
      <div>
        <div className="font-display text-[16.5px] font-bold tracking-[-0.01em]">{travelTime.name}</div>
        <div className="text-muted text-[11.5px]">{sublabelFor(travelTime.slug)}</div>
      </div>
      <div className="text-right">
        <div
          className={
            travelTime.stale
              ? 'text-muted font-display text-[19px] font-extrabold'
              : 'font-display text-[19px] font-extrabold'
          }
        >
          {minutes} min
        </div>
        {delta && <div className={`text-[11.5px] font-bold ${DELTA_TONE_CLASS[delta.tone]}`}>{delta.text}</div>}
        {/* Rule 8: staleness must be surfaced independently of the visual
         *  (a muted numeral is colour alone, WCAG 1.4.1). The header's
         *  "Updated ..." states the OLDEST visible row's time (see
         *  `oldestCapturedAt` below), but a driver on THIS row still
         *  benefits from its own timestamp -- sr-only rather than visible
         *  so the muted-numeral treatment stays visually unchanged. */}
        {travelTime.stale && <span className="sr-only">as of {formatAsOf(travelTime.capturedAt)}</span>}
      </div>
    </li>
  );
}

export default function DriveTimes({
  travelTimes,
  direction,
  town,
  onTownChange,
  onFlip,
  variant = 'phone',
}: {
  travelTimes: ApiStatus['travelTimes'];
  direction: Direction;
  town: Town;
  onTownChange: (town: Town) => void;
  onFlip: () => void;
  /**
   * Mirrors Header's `variant` prop (App.tsx's `useIsDesktop` breakpoint
   * check) -- needed here for the same reason: the Victor/Driggs town filter
   * changes which travel-time rows actually mount, not just how they look, so
   * unlike the header's flip-link/phone-picker split (plain CSS, both always
   * in the DOM) this can't be done with `lg:hidden` alone. Desktop's 2-up
   * grid shows all 6 routes for a direction -- both Idaho towns -- with no
   * town filtering (README §2); only the phone layout, which has room for
   * just one town's 3 cards, filters by the picker below.
   */
  variant?: 'phone' | 'desktop';
}) {
  const byDirection = travelTimes.filter((t) => directionOf(t.slug) === direction);
  const rows = variant === 'desktop' ? byDirection : byDirection.filter((t) => idahoTownOf(t.slug) === town);

  // OLDEST of the visible rows, not newest -- same rule as `olderReportTime`
  // in src/worker/poller/run.ts (a reader should never see a freshness
  // timestamp fresher than the least-current contributor). It matters here
  // specifically because a row goes `stale` precisely when ITS OWN
  // capturedAt lags while its siblings are current: taking the max would
  // print "Updated <fresh time>" directly above a stale, colour-only-muted
  // numeral, overstating the freshness of the one row that most needs its
  // staleness surfaced.
  const oldestCapturedAt = rows.reduce<string | null>((oldest, t) => {
    if (!oldest) return t.capturedAt;
    return new Date(t.capturedAt) < new Date(oldest) ? t.capturedAt : oldest;
  }, null);

  return (
    <section aria-labelledby="drive-times-heading" className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="drive-times-heading" className="font-display text-[15px] font-bold">
          Drive times right now
        </h2>
        <div className="text-muted flex items-baseline gap-3 text-[11.5px]">
          {oldestCapturedAt && <span>Updated {formatAsOf(oldestCapturedAt)}</span>}
          {/* Desktop keeps the "⇄ Flip direction" text link next to "Updated
              ..."; phone drops it in favor of the → WY/→ ID segmented control
              below. Plain CSS visibility (not gated on `variant`) -- unlike
              the row filter above, showing this link never changes which DOM
              nodes exist, so there's no jsdom query-ambiguity risk the way
              Header's single "Report conditions" button had. */}
          <span className="hidden items-baseline gap-3 lg:inline-flex">
            <span aria-hidden="true">·</span>
            <button type="button" aria-pressed={direction === 'wb'} onClick={onFlip} className="text-accent text-xs font-bold">
              ⇄ Flip direction
            </button>
          </span>
        </div>
      </div>

      {/* Phone-only controls (lg:hidden): Victor/Driggs picks the Idaho town
          (Ruling R3, filters both directions identically); → WY/→ ID mirrors
          the desktop flip link as a segmented control instead of a text
          link, since there's no room for the header's inline copy on a
          narrow screen. */}
      <div className="mt-2 flex flex-wrap justify-between gap-2 lg:hidden">
        <Segmented
          options={
            [
              { value: 'victor', label: 'Victor' },
              { value: 'driggs', label: 'Driggs' },
            ] as const
          }
          value={town}
          onChange={onTownChange}
          ariaLabel="Idaho town"
        />
        <Segmented
          options={
            [
              { value: 'eb', label: '→ WY' },
              { value: 'wb', label: '→ ID' },
            ] as const
          }
          value={direction}
          onChange={onFlip}
          ariaLabel="Direction"
        />
      </div>

      <ul className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        {rows.map((t) => (
          <DriveTimeCard key={t.slug} travelTime={t} />
        ))}
        {rows.length === 0 && (
          <li className="text-muted py-2 text-sm">No drive-time data for this direction yet.</li>
        )}
      </ul>
    </section>
  );
}
