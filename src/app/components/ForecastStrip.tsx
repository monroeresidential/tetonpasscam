import { useState } from 'react';

import type { ForecastDay } from '../../shared/types';
import { formatTemp, type TempUnit } from '../units';

/** Weekday from a `yyyy-mm-dd` key. Parsed as UTC noon rather than
 *  `new Date('2026-08-16')` local-midnight: a Denver browser reading a
 *  midnight-UTC date lands on the previous evening and names the wrong day. */
function weekdayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(at);
}

const DENVER_DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Icons are square at their rendered size; declaring both dimensions keeps
 *  five late-arriving images from shifting the page (the P1 Lighthouse
 *  mobile >= 90 gate is sensitive to CLS). */
const ICON_PX = 40;

export default function ForecastStrip({
  forecast,
  forecastStale = false,
  now = new Date(),
  unit = 'F',
}: {
  forecast: ForecastDay[];
  forecastStale?: boolean;
  now?: Date;
  unit?: TempUnit;
}) {
  // Dates whose icon failed to load. Keyed by date rather than a single
  // boolean so one dead image never blanks the other four.
  const [brokenIcons, setBrokenIcons] = useState<Set<string>>(() => new Set());

  // Nothing to show renders nothing -- an empty framed section would imply
  // we have a forecast and it is blank.
  if (forecast.length === 0) return null;

  const todayKey = DENVER_DATE_KEY.format(now);

  return (
    <section aria-labelledby="forecast-heading" className="mt-4">
      <h2 id="forecast-heading" className="font-display text-[15px] font-bold">
        5-day forecast
      </h2>
      {forecastStale && <p className="text-muted mb-1 text-[11px]">Forecast may be outdated</p>}
      <div className="mt-1 grid grid-cols-5 gap-2">
        {forecast.map((d) => (
          <div
            key={d.date}
            className="bg-card border-card-border rounded-card flex flex-col items-center gap-0.5 border p-2 text-center"
          >
            <p className="text-muted text-[10.5px] uppercase">
              {d.date === todayKey ? 'Today' : weekdayLabel(d.date)}
            </p>
            {/* Fixed-size box present whether or not an image ends up inside
                it -- a missing/failed icon must not let the temperature and
                precip lines below shift up to fill the gap, which would
                visibly misalign that card against its neighbors in the
                five-across row. */}
            <div className="h-10 w-10" data-testid="icon-slot">
              {d.iconPath && !brokenIcons.has(d.date) && (
                <img
                  src={d.iconPath}
                  alt={d.shortForecast ?? d.category}
                  width={ICON_PX}
                  height={ICON_PX}
                  loading="lazy"
                  className="h-10 w-10 rounded"
                  // A dead image drops out entirely rather than leaving a
                  // broken-image glyph -- the temperatures are the point of
                  // the card and they are unaffected. The slot above keeps
                  // its footprint either way.
                  onError={() =>
                    setBrokenIcons((prev) => {
                      const next = new Set(prev);
                      next.add(d.date);
                      return next;
                    })
                  }
                />
              )}
            </div>
            <p className="font-display text-[13px] font-extrabold">
              {d.highF !== null && d.lowF !== null
                ? `${formatTemp(d.highF, unit)} / ${formatTemp(d.lowF, unit)}`
                : '—'}
            </p>
            <p className="text-muted text-[10.5px]">
              {d.precipPct !== null ? `${d.precipPct}%` : '—'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
