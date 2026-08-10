import { useState } from 'react';

import type { ApiStatus } from '../../shared/types';
import ShareButton from './ShareButton';

type Direction = 'eb' | 'wb';
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

function DriveTimeCard({ travelTime }: { travelTime: TravelTime }) {
  const delta = deltaCopy(travelTime.durationSec, travelTime.typicalSec);
  const minutes = Math.round(travelTime.durationSec / 60);

  return (
    <li className="bg-card border border-card-border rounded-card flex items-center justify-between px-3.5 py-3">
      <div>
        <div className="text-sm font-bold">{travelTime.name}</div>
        <div className="text-muted text-[11.5px]">{sublabelFor(travelTime.slug)}</div>
      </div>
      <div className="text-right">
        <div className="font-display text-[22px] font-extrabold">{minutes} min</div>
        {delta && (
          <div className={`text-[11.5px] font-bold ${DELTA_TONE_CLASS[delta.tone]}`}>{delta.text}</div>
        )}
      </div>
    </li>
  );
}

export default function DriveTimes({
  travelTimes,
  shareCode = null,
}: {
  travelTimes: ApiStatus['travelTimes'];
  // Additive/optional (share-cards T2): defaults to null so every existing
  // caller/test that doesn't pass it gets the same "share button hidden"
  // behavior as an explicit null, rather than needing to update every call
  // site just to keep compiling.
  shareCode?: string | null;
}) {
  const [direction, setDirection] = useState<Direction>('eb');
  const rows = travelTimes.filter((t) => directionOf(t.slug) === direction);

  return (
    <section aria-labelledby="drive-times-heading" className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="drive-times-heading" className="font-display text-[15px] font-bold">
          Drive times right now
        </h2>
        <div className="flex items-baseline gap-3">
          <button
            type="button"
            aria-pressed={direction === 'wb'}
            onClick={() => setDirection((d) => (d === 'eb' ? 'wb' : 'eb'))}
            className="text-accent text-xs font-bold"
          >
            ⇄ Flip direction
          </button>
          <ShareButton shareCode={shareCode} direction={direction} />
        </div>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
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
