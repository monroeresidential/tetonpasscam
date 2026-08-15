import type { WeatherReading } from '../../worker/poller/wydot-weather';
import { formatTemp, type TempUnit } from '../units';

interface Tile {
  label: string;
  value: string;
  /** Widen this tile to two grid cells. Used only by the road-surface
   *  condition, whose value is prose ("Snow packed, slick in spots") rather
   *  than a short reading, and would otherwise wrap badly in a narrow cell. */
  wide?: boolean;
}

const REPORTED_AT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/**
 * Winter (Nov-Apr) vs summer (May-Oct) split, same months as the backend's
 * `denverParts` season rule -- but read from the CLIENT's local wall clock,
 * not America/Denver, because this only decides display ORDER (which stat
 * leads), not anything safety-relevant. A user viewing right at a month
 * boundary in a non-Denver timezone could see the "wrong" order for a few
 * hours; that's an acceptable tradeoff for a cosmetic ordering preference.
 */
function isWinterMonth(date: Date): boolean {
  const month = date.getMonth() + 1; // 1-12
  return month >= 11 || month <= 4;
}

function gustValue(weather: WeatherReading): string {
  if (weather.windGustMph === null) return '—';
  return weather.windDir !== null ? `${weather.windGustMph} mph ${weather.windDir}` : `${weather.windGustMph} mph`;
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
  now = new Date(),
  unit = 'F',
}: {
  weather: WeatherReading | null;
  /** WYDOT's road-surface description from the RoutesResults "Conditions"
   *  cell ("Dry", "Snow packed"). Comes from a DIFFERENT page than the
   *  sensor readings above and can be absent on its own, so the tile is
   *  omitted entirely rather than rendered with an em-dash: an empty
   *  "Surface —" would imply we checked and the road had no condition. */
  surfaceCondition?: string | null;
  weatherStale?: boolean;
  now?: Date;
  unit?: TempUnit;
}) {
  if (!weather) {
    return (
      <section aria-label="Summit weather" className="mt-4">
        <p className="text-muted text-sm">Weather data unavailable.</p>
      </section>
    );
  }

  const airTile: Tile = { label: 'Air', value: weather.airF !== null ? formatTemp(weather.airF, unit) : '—' };
  const roadTile: Tile = {
    label: 'Road',
    value: weather.surfaceF !== null ? formatTemp(weather.surfaceF, unit) : '—',
  };
  const gustTile: Tile = { label: 'Gust', value: gustValue(weather) };
  const visibilityTile: Tile = { label: 'Visibility', value: visibilityValue(weather.visibilityFt) };

  // Road (surface) temp matters most in winter (ice risk); air temp leads
  // the rest of the year.
  const tempTiles = isWinterMonth(now) ? [roadTile, airTile] : [airTile, roadTile];
  const tiles: Tile[] = [...tempTiles, gustTile, visibilityTile];
  if (surfaceCondition) {
    tiles.push({ label: 'Surface', value: surfaceCondition, wide: true });
  }

  // The grid is sized so every row comes out exactly full rather than
  // leaving an orphan: 4 sensor tiles fill a 4-column row, and adding the
  // double-width surface tile makes 6 cells, which fill two 3-column rows.
  const gridCols = surfaceCondition ? 'grid-cols-3' : 'grid-cols-4';

  // A missing/unparseable reportedAt still lets the tiles render (the
  // numeric readings are independent of it) -- the "as of" suffix simply
  // omits the time rather than showing a fabricated one.
  const reportedAtLabel =
    weatherStale && weather.reportedAt ? REPORTED_AT_FORMAT.format(new Date(weather.reportedAt)) : null;

  return (
    <section aria-label="Summit weather" className="mt-4">
      {weatherStale && (
        <p className="text-muted mb-1 text-[11px]">
          Weather may be outdated{reportedAtLabel ? ` — (as of ${reportedAtLabel})` : ''}
        </p>
      )}
      <div className={`grid ${gridCols} gap-2`}>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={`bg-card border-card-border rounded-card border p-3 text-center${
              tile.wide ? ' col-span-2' : ''
            }`}
          >
            <p className="font-display text-lg font-extrabold">{tile.value}</p>
            <p className="text-muted text-[10.5px] uppercase">{tile.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
