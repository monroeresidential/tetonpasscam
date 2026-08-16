import type { ForecastDay } from '../../shared/types';
import { formatTemp, type TempUnit } from '../units';
import { glyphFor } from '../weatherGlyphs';

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

export default function ForecastStrip({
  forecast,
  now = new Date(),
  unit = 'F',
}: {
  // `ApiStatus.forecast` is declared non-optional -- every LIVE `/api/status`
  // response always includes it -- but a payload read back out of
  // `localStorage['last-status']` (see useStatus.ts) is only ever as fresh
  // as whichever bundle version wrote it. A cache entry written before this
  // field existed has no `forecast` key at all, so at runtime this can still
  // arrive as `undefined` despite the type saying otherwise. Guarded here
  // (component-side) rather than at the App.tsx call site so every future
  // consumer of this prop inherits the same protection.
  forecast: ForecastDay[] | undefined;
  now?: Date;
  unit?: TempUnit;
}) {
  // Nothing to show renders nothing -- an empty framed section would imply
  // we have a forecast and it is blank. `forecast?.length` (not
  // `forecast.length`) is the actual fix: see the prop comment above.
  if (!forecast?.length) return null;

  const todayKey = DENVER_DATE_KEY.format(now);

  return (
    <section aria-labelledby="forecast-heading" className="mt-4">
      <h2 id="forecast-heading" className="font-display text-[15px] font-bold">
        5-day forecast
      </h2>
      <div className="mt-1 grid grid-cols-5 gap-2">
        {forecast.map((d) => (
          <div
            key={d.date}
            className="bg-card border-card-border rounded-card flex flex-col items-center gap-0.5 border p-2 text-center"
          >
            <p className="text-muted text-[10.5px] uppercase">
              {d.date === todayKey ? 'Today' : weekdayLabel(d.date)}
            </p>
            <div
              data-testid="glyph-tile"
              className="bg-icon-tile flex h-10 w-10 items-center justify-center rounded-[10px] text-[20px]"
            >
              {/* Daily cards always take the day glyph: a whole-day summary
                  is not an hour, so a moon would be as wrong at noon as a
                  sun is at midnight. `aria-hidden` sits on the glyph itself
                  (not the tile) so a screen reader skips the emoji and reads
                  only the sr-only text beside it -- "Snow", not "snowflake
                  emoji Snow". */}
              <span aria-hidden="true">{glyphFor(d.category, true)}</span>
              <span className="sr-only">{d.shortForecast ?? d.category}</span>
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
