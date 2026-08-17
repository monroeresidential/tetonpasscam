import type { ForecastDay } from '../../shared/types';
import { fToC, type TempUnit } from '../units';
import { useIsDesktop } from '../useIsDesktop';
import { glyphFor, precipGlyphFor } from '../weatherGlyphs';

/** Degrees without the unit suffix -- the section heading states the unit
 *  once ("high / low °F"), so repeating it on every one of the ten values
 *  in a 5-card row would be redundant in a way the desktop/phone card
 *  layouts (README §7) both explicitly avoid. Mirrors `formatTemp`'s
 *  rounding, just without its `°F`/`°C` suffix. */
function bareTemp(f: number, unit: TempUnit): string {
  return `${Math.round(unit === 'C' ? fToC(f) : f)}°`;
}

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
  const isDesktop = useIsDesktop();

  if (!forecast?.length) return null;

  const todayKey = DENVER_DATE_KEY.format(now);

  return (
    <section aria-labelledby="forecast-heading" className="mt-4">
      <h2 id="forecast-heading" className="font-display text-[15px] font-bold">
        {`5-day forecast · high / low °${unit}`}
      </h2>
      <div className="mt-1 grid grid-cols-5 gap-1.5">
        {forecast.map((d) => {
          const dayLabel = d.date === todayKey ? 'Today' : weekdayLabel(d.date);
          // `aria-hidden` sits on the glyph itself (not the tile) so a
          // screen reader skips the emoji and reads only the sr-only text
          // beside it -- "Snow", not "snowflake emoji Snow". Daily cards
          // always take the day glyph: a whole-day summary is not an hour,
          // so a moon would be as wrong at noon as a sun is at midnight.
          const glyphTile = (className: string) => (
            <div data-testid="glyph-tile" className={className}>
              <span aria-hidden="true">{glyphFor(d.category, true)}</span>
              <span className="sr-only">{d.shortForecast ?? d.category}</span>
            </div>
          );
          const precipLine =
            d.precipPct !== null ? `${precipGlyphFor(d.category)} ${d.precipPct}%` : '—';
          const hasTemps = d.highF !== null && d.lowF !== null;

          if (isDesktop) {
            return (
              <div
                key={d.date}
                className="bg-card border-card-border rounded-card flex flex-col gap-1.5 border p-2"
              >
                <p className="text-muted text-[11.5px] font-bold uppercase">{dayLabel}</p>
                <div className="flex items-center gap-2">
                  {glyphTile(
                    'bg-icon-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[20px]',
                  )}
                  <div className="flex flex-col">
                    {hasTemps ? (
                      <p className="whitespace-nowrap">
                        <span className="font-display text-[17px] font-extrabold">
                          {bareTemp(d.highF as number, unit)}
                        </span>{' '}
                        <span className="text-muted text-[14px]">
                          {bareTemp(d.lowF as number, unit)}
                        </span>
                      </p>
                    ) : (
                      <p className="font-display text-[17px] font-extrabold">—</p>
                    )}
                    <p className="text-muted text-[11px] whitespace-nowrap">{precipLine}</p>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={d.date}
              className="bg-card border-card-border rounded-card flex flex-col items-center gap-0.5 border p-2 text-center"
            >
              <p className="text-muted text-[10.5px] uppercase">{dayLabel}</p>
              {glyphTile(
                'bg-icon-tile flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[16px]',
              )}
              {hasTemps ? (
                <p className="whitespace-nowrap">
                  <span className="font-display text-[13px] font-extrabold">
                    {bareTemp(d.highF as number, unit)}
                  </span>{' '}
                  <span className="text-muted text-[13px]">{bareTemp(d.lowF as number, unit)}</span>
                </p>
              ) : (
                <p className="font-display text-[13px] font-extrabold">—</p>
              )}
              <p className="text-muted text-[10px] whitespace-nowrap">{precipLine}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
