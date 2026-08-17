import type { ForecastCategory } from '../shared/types';

/**
 * Category-to-glyph metadata for both forecast strips, hoisted here rather
 * than exported from either component -- the same reasoning as
 * `alertTypes.ts`, whose structure this mirrors: neither strip owns weather
 * metadata, and the two must not drift.
 *
 * Every glyph uses EMOJI presentation, with an explicit U+FE0F on the
 * characters that would otherwise default to monochrome text (U+2600 sun,
 * U+2601 cloud, U+2744 snowflake). A row of twelve mixing flat-ink and
 * full-colour glyphs looks broken in a way neither style does alone. Note
 * this differs from `alertTypes.ts`'s bare `❄`/`⚠` -- those render one at a
 * time, so the inconsistency never shows.
 */
export const WEATHER_GLYPH: Record<ForecastCategory, string> = {
  clear: '☀️',
  'partly-cloudy': '⛅',
  cloudy: '☁️',
  rain: '🌧️',
  snow: '❄️',
  mixed: '🌨️',
  thunderstorm: '⛈️',
  fog: '🌫️',
};

/**
 * Night variants for the only two categories where a daytime glyph is
 * actively wrong. A clear 10 PM hour showing a sun is the sort of small
 * wrongness that makes a whole strip feel untrustworthy; rain and snow look
 * the same after dark.
 */
export const WEATHER_GLYPH_NIGHT: Partial<Record<ForecastCategory, string>> = {
  clear: '🌙',
  'partly-cloudy': '☁️',
};

export function glyphFor(category: ForecastCategory, isDaytime: boolean): string {
  if (!isDaytime) {
    const night = WEATHER_GLYPH_NIGHT[category];
    if (night) return night;
  }
  return WEATHER_GLYPH[category];
}

/**
 * The glyph prefixing a precipitation percentage. Distinct from
 * `WEATHER_GLYPH`: that answers "what is the weather", this answers "what
 * would fall", so it collapses eight categories to two.
 *
 * `mixed` takes the snowflake rather than the droplet -- it is rain AND
 * snow, and on a pass the frozen half is the one a driver needs to see.
 * That is the same severity bias `rollupDaily`'s tie-break already applies.
 */
export function precipGlyphFor(category: ForecastCategory): string {
  return category === 'snow' || category === 'mixed' ? '❄️' : '💧';
}
