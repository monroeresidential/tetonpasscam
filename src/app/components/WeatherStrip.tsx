import type { WeatherReading } from '../../worker/poller/wydot-weather';

interface Tile {
  label: string;
  value: string;
}

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

export default function WeatherStrip({
  weather,
  now = new Date(),
}: {
  weather: WeatherReading | null;
  now?: Date;
}) {
  if (!weather) {
    return (
      <section aria-label="Summit weather" className="p-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Weather data unavailable.</p>
      </section>
    );
  }

  const airTile: Tile = { label: 'Air temp', value: weather.airF !== null ? `${weather.airF}°F` : '—' };
  const surfaceTile: Tile = {
    label: 'Surface temp',
    value: weather.surfaceF !== null ? `${weather.surfaceF}°F` : '—',
  };
  const windTile: Tile = {
    label: 'Wind',
    value:
      weather.windAvgMph !== null || weather.windGustMph !== null
        ? `${weather.windAvgMph ?? '—'} avg / ${weather.windGustMph ?? '—'} gust mph`
        : '—',
  };
  const windDirTile: Tile = { label: 'Wind direction', value: weather.windDir ?? '—' };
  const visibilityTile: Tile = {
    label: 'Visibility',
    value: weather.visibilityFt !== null ? `${weather.visibilityFt} ft` : '—',
  };

  // Surface temp matters most in winter (ice risk); air temp leads the rest
  // of the year.
  const tempTiles = isWinterMonth(now) ? [surfaceTile, airTile] : [airTile, surfaceTile];
  const tiles: Tile[] = [...tempTiles, windTile, windDirTile, visibilityTile];

  return (
    <section aria-label="Summit weather" className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-md bg-neutral-100 dark:bg-neutral-800 p-3 text-center"
        >
          <p className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{tile.label}</p>
          <p className="text-lg font-semibold">{tile.value}</p>
        </div>
      ))}
    </section>
  );
}
