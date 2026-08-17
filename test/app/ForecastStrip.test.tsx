import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ForecastStrip from '../../src/app/components/ForecastStrip';
import { WEATHER_GLYPH } from '../../src/app/weatherGlyphs';
import type { ForecastDay } from '../../src/shared/types';
import { setMatchMedia } from './matchMedia';

const NOON_MDT = new Date('2026-08-16T18:00:00.000Z'); // Sunday Aug 16, noon Denver

function day(over: Partial<ForecastDay> & { date: string }): ForecastDay {
  return {
    highF: 62,
    lowF: 38,
    category: 'clear',
    shortForecast: 'Sunny',
    precipPct: 20,
    ...over,
  };
}

const FIVE: ForecastDay[] = [
  day({ date: '2026-08-16' }),
  day({ date: '2026-08-17', category: 'snow', shortForecast: 'Snow', precipPct: 70 }),
  day({ date: '2026-08-18' }),
  day({ date: '2026-08-19' }),
  day({ date: '2026-08-20' }),
];

describe('ForecastStrip', () => {
  it('renders one card per day, labelling the first as Today', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(
      screen.getByRole('heading', { name: '5-day forecast · high / low °F' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Thu')).toBeInTheDocument();
  });

  it('renders temperatures in the selected unit', () => {
    // High/low render as separate elements (bold high, muted low) rather
    // than one combined string -- see the "drops the unit" test below for
    // why a single joined string can't carry two different styles.
    const { rerender } = render(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="F" />);
    expect(screen.getAllByText('62°').length).toBeGreaterThan(0);
    expect(screen.getAllByText('38°').length).toBeGreaterThan(0);

    rerender(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="C" />);
    expect(screen.getAllByText('17°').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3°').length).toBeGreaterThan(0);
  });

  it('shows an em-dash for a null precip chance, never 0%', () => {
    render(<ForecastStrip forecast={[day({ date: '2026-08-16', precipPct: null })]} now={NOON_MDT} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('renders nothing at all when there is no forecast', () => {
    const { container } = render(<ForecastStrip forecast={[]} now={NOON_MDT} />);
    expect(container).toBeEmptyDOMElement();
  });

  // The "flags a stale forecast without hiding it" test previously here
  // exercised a `forecastStale` prop that no longer exists on this
  // component: final review Fix 1 hoisted the single "Forecast may be
  // outdated" caption out of ForecastStrip and into App.tsx, above both the
  // hourly and 5-day rows, so it can no longer be tested against
  // ForecastStrip in isolation. See App.test.tsx's "forecast staleness
  // caption" tests for the replacement coverage.

  // The four tests previously here (`renders the text card when an icon
  // path is missing`, `drops an icon that fails to load...`, `reserves the
  // icon box...`, `keeps the icon slot occupied...`) all exercised the
  // image-fallback/onError machinery this task removes: a glyph tile is
  // always present regardless of data, so there is no "missing icon" state
  // left to test. Replaced by the two glyph-tile tests below.

  it('renders a glyph tile per card rather than a remote image', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('glyph-tile')).toHaveLength(5);
  });

  it('uses the day glyph for daily cards regardless of the hour', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    const tiles = screen.getAllByTestId('glyph-tile');
    expect(tiles[1]).toHaveTextContent(WEATHER_GLYPH.snow);
  });

  // Final review Fix 2: the deleted `<img alt={...}>` was the only thing
  // announcing the condition to a screen reader; `aria-hidden` on the glyph
  // with nothing else in the card left it unannounced. This asserts the
  // replacement text is actually IN the accessibility tree -- `getByText`
  // finds it regardless of the `sr-only` class visually hiding it, which is
  // exactly the property that matters (a screen reader reads DOM text
  // content, not computed CSS visibility for off-screen-clipped text).
  it('carries the condition to a screen reader via sr-only text beside the aria-hidden glyph', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getByText('Snow')).toBeInTheDocument();
    expect(screen.getAllByText('Sunny').length).toBeGreaterThan(0);
  });

  it('falls back to the category when shortForecast is null', () => {
    render(
      <ForecastStrip
        forecast={[day({ date: '2026-08-16', shortForecast: null, category: 'partly-cloudy' })]}
        now={NOON_MDT}
      />,
    );
    expect(screen.getByText('partly-cloudy')).toBeInTheDocument();
  });

  it('states the unit once in the heading, and follows the toggle', () => {
    const { rerender } = render(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="F" />);
    expect(screen.getByRole('heading', { name: '5-day forecast · high / low °F' })).toBeInTheDocument();
    rerender(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="C" />);
    // The handoff hardcodes °F; the site has a toggle, so the heading takes
    // the unit or it contradicts its own values.
    expect(screen.getByRole('heading', { name: '5-day forecast · high / low °C' })).toBeInTheDocument();
  });

  it('drops the unit from the card values', () => {
    // getAllByText, not getByText: FIVE has four identical non-snow days,
    // all rendering "62°" -- see the file-level pitfall note about
    // page-wide text queries colliding on repeated fixture values.
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="F" />);
    expect(screen.queryByText(/62°F/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/62°/).length).toBeGreaterThan(0);
  });

  it('uses a snowflake precip glyph on snow days and a droplet otherwise', () => {
    // Same collision as above: four of the five FIVE days share the
    // default precipPct, so the droplet line is asserted with
    // getAllByText rather than getByText.
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getByText('❄️ 70%')).toBeInTheDocument();
    expect(screen.getAllByText('💧 20%').length).toBeGreaterThan(0);
  });

  it('keeps the sr-only condition text in both layouts', () => {
    setMatchMedia(true);
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getByText('Snow')).toBeInTheDocument();
    setMatchMedia(false);
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getAllByText('Snow').length).toBeGreaterThan(0);
  });
});
