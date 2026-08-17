import type { WeatherReading } from '../../worker/poller/wydot-weather';
import { formatTemp, type TempUnit } from '../units';

/** The posted highway summit elevation. Deliberately NOT the 8,474 ft the
 *  NWS grid cell self-reports (a 2.5 km cell average, recorded in the
 *  forecast spec purely as evidence the cell covers the pass) -- 8,431 ft is
 *  the number on the sign and the number a driver recognizes. */
const SUMMIT_ELEVATION_LABEL = 'WY-22 · 8,431 ft';

function SummitHeading() {
  return (
    <div className="flex items-baseline justify-between">
      <h2 id="summit-conditions-heading" className="font-display text-[15px] font-bold">
        Summit conditions
      </h2>
      <p className="text-muted text-[11px]">{SUMMIT_ELEVATION_LABEL}</p>
    </div>
  );
}

interface Tile {
  label: string;
  value: string;
}

const REPORTED_AT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function gustValue(weather: WeatherReading): string {
  if (weather.windGustMph === null) return '—';
  // Rounded to a whole number so the value can never wrap inside the tile's
  // fixed height (e.g. "11.2 mph W").
  const rounded = Math.round(weather.windGustMph);
  return weather.windDir !== null ? `${rounded} mph ${weather.windDir}` : `${rounded} mph`;
}

const FEET_PER_MILE = 5280;
// Below half a mile, feet is the more legible unit for a driver (a "0.09 mi"
// reading doesn't parse at a glance); at or above it, switch to miles --
// one decimal under 3 mi (where the digit matters most for a go/no-go
// decision), whole miles at or above 3.
const MILE_THRESHOLD_FT = FEET_PER_MILE / 2;

function visibilityValue(visibilityFt: number | null): string {
  if (visibilityFt === null) return '—';
  if (visibilityFt < MILE_THRESHOLD_FT) return `${visibilityFt} ft`;
  const miles = visibilityFt / FEET_PER_MILE;
  // Decide the <3mi cutoff on the value AFTER rounding to 1 decimal, not
  // before -- otherwise e.g. 2.9998mi (15839 ft) takes the <3 branch and
  // prints "3.0 mi" instead of rounding up front to "3 mi" like the whole-
  // number branch would.
  const rounded = Math.round(miles * 10) / 10;
  return rounded < 3 ? `${rounded.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

export default function WeatherStrip({
  weather,
  surfaceCondition = null,
  weatherStale = false,
  unit = 'F',
}: {
  weather: WeatherReading | null;
  /** WYDOT's road-surface description from the RoutesResults "Conditions"
   *  cell ("Dry", "Snow packed"). Comes from a DIFFERENT page than the
   *  sensor readings above and can be absent on its own -- the tile is
   *  always rendered (the grid is a fixed 2x2), falling back to "No report"
   *  rather than a bare em-dash: an empty "Surface —" would read as a
   *  condition WYDOT actually reported (ruling R2). */
  surfaceCondition?: string | null;
  weatherStale?: boolean;
  unit?: TempUnit;
}) {
  if (!weather) {
    return (
      <section aria-labelledby="summit-conditions-heading" className="mt-4">
        <SummitHeading />
        <p className="text-muted text-sm">Weather data unavailable.</p>
      </section>
    );
  }

  const airValue = weather.airF !== null ? formatTemp(weather.airF, unit) : '—';
  const roadValue = weather.surfaceF !== null ? formatTemp(weather.surfaceF, unit) : '—';
  const tiles: Tile[] = [
    { label: 'Air / Road', value: `${airValue} / ${roadValue}` },
    { label: 'Surface', value: surfaceCondition ?? 'No report' },
    { label: 'Gust', value: gustValue(weather) },
    { label: 'Visibility', value: visibilityValue(weather.visibilityFt) },
  ];

  // A missing/unparseable reportedAt still lets the tiles render (the
  // numeric readings are independent of it) -- the "as of" suffix simply
  // omits the time rather than showing a fabricated one.
  const reportedAtLabel =
    weatherStale && weather.reportedAt ? REPORTED_AT_FORMAT.format(new Date(weather.reportedAt)) : null;

  return (
    <section aria-labelledby="summit-conditions-heading" className="mt-4">
      <SummitHeading />
      {weatherStale && (
        <p className="text-muted mb-1 text-[11px]">
          Weather may be outdated{reportedAtLabel ? ` — (as of ${reportedAtLabel})` : ''}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            data-testid="weather-tile"
            className="bg-card border-card-border rounded-card flex h-16 flex-col justify-center border px-3.5 py-2.5 text-left"
          >
            <p className="text-muted text-[10.5px] uppercase tracking-[0.04em]">{tile.label}</p>
            <p className="font-display text-[19px] font-extrabold whitespace-nowrap">{tile.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
