import { useState } from 'react';

import type { ApiStatus } from '../../shared/types';

type Direction = 'eb' | 'wb';
type TravelTime = ApiStatus['travelTimes'][number];

function directionOf(slug: string): Direction | null {
  if (slug.endsWith('-eb')) return 'eb';
  if (slug.endsWith('-wb')) return 'wb';
  return null;
}

// Delta thresholds (plan): diff = durationSec - typicalSec.
//   diff <= +5min (300s)          => green
//   +5min < diff <= +15min (900s) => amber
//   diff >  +15min                => red
// Boundaries are inclusive on the low side of each band ("≤"/">" in the
// plan), so a diff of exactly 300s is green and exactly 900s is amber.
const DELTA_GREEN_MAX_SEC = 5 * 60;
const DELTA_AMBER_MAX_SEC = 15 * 60;

type DeltaColor = 'green' | 'amber' | 'red';

function deltaChip(durationSec: number, typicalSec: number | null): { minutes: number; color: DeltaColor } | null {
  if (typicalSec === null) return null;
  const diffSec = durationSec - typicalSec;
  const minutes = Math.round(diffSec / 60);
  const color: DeltaColor =
    diffSec <= DELTA_GREEN_MAX_SEC ? 'green' : diffSec <= DELTA_AMBER_MAX_SEC ? 'amber' : 'red';
  return { minutes, color };
}

const CHIP_COLOR_CLASS: Record<DeltaColor, string> = {
  green: 'text-green-700 dark:text-green-400',
  amber: 'text-amber-700 dark:text-amber-500',
  red: 'text-red-700 dark:text-red-400',
};

function DriveTimeRow({ travelTime }: { travelTime: TravelTime }) {
  const chip = deltaChip(travelTime.durationSec, travelTime.typicalSec);
  const minutes = Math.round(travelTime.durationSec / 60);

  return (
    <li className="flex items-center justify-between py-2">
      <span>{travelTime.name}</span>
      <span className="flex items-center gap-2">
        <span className="font-semibold">{minutes} min</span>
        {chip && (
          <span className={`text-sm font-medium ${CHIP_COLOR_CLASS[chip.color]}`}>
            {chip.minutes >= 0 ? '+' : ''}
            {chip.minutes} min vs typical
          </span>
        )}
      </span>
    </li>
  );
}

export default function DriveTimes({ travelTimes }: { travelTimes: ApiStatus['travelTimes'] }) {
  const [direction, setDirection] = useState<Direction>('eb');
  const rows = travelTimes.filter((t) => directionOf(t.slug) === direction);

  return (
    <section aria-labelledby="drive-times-heading" className="p-4">
      <div className="flex items-center justify-between">
        <h2 id="drive-times-heading" className="text-lg font-bold">
          Drive times
        </h2>
        <div role="group" aria-label="Direction" className="flex gap-1">
          <button
            type="button"
            aria-pressed={direction === 'eb'}
            onClick={() => setDirection('eb')}
            className="rounded px-2 py-1 text-sm aria-pressed:bg-neutral-800 aria-pressed:text-white dark:aria-pressed:bg-neutral-200 dark:aria-pressed:text-black"
          >
            Eastbound
          </button>
          <button
            type="button"
            aria-pressed={direction === 'wb'}
            onClick={() => setDirection('wb')}
            className="rounded px-2 py-1 text-sm aria-pressed:bg-neutral-800 aria-pressed:text-white dark:aria-pressed:bg-neutral-200 dark:aria-pressed:text-black"
          >
            Westbound
          </button>
        </div>
      </div>
      <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-700">
        {rows.map((t) => (
          <DriveTimeRow key={t.slug} travelTime={t} />
        ))}
        {rows.length === 0 && (
          <li className="py-2 text-sm text-neutral-500 dark:text-neutral-400">
            No drive-time data for this direction yet.
          </li>
        )}
      </ul>
    </section>
  );
}
