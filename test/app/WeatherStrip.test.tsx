import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import WeatherStrip from '../../src/app/components/WeatherStrip';
import type { WeatherReading } from '../../src/worker/poller/wydot-weather';

const reading: WeatherReading = {
  airF: 28,
  surfaceF: 22,
  windAvgMph: 8,
  windGustMph: 15,
  windDir: 'W',
  visibilityFt: 6562,
  humidityPct: 34,
  dewPointF: 12,
  reportedAt: '2026-01-09T18:00:00.000Z',
};

describe('WeatherStrip', () => {
  it('always renders exactly four tiles, including when surface is absent', () => {
    // Two renders in one `it`: RTL only auto-cleans up BETWEEN tests, not
    // between render() calls within one, so the first tree must be
    // unmounted or this would see 8 tiles on the second assertion.
    const { unmount } = render(<WeatherStrip weather={reading} surfaceCondition="Dry" />);
    expect(screen.getAllByTestId('weather-tile')).toHaveLength(4);
    unmount();

    render(<WeatherStrip weather={reading} surfaceCondition={null} />);
    expect(screen.getAllByTestId('weather-tile')).toHaveLength(4);
  });

  it('combines air and road into one tile', () => {
    render(<WeatherStrip weather={reading} />);
    expect(screen.getByText('Air / Road')).toBeInTheDocument();
    // The separator is a muted <span> (see the test below), so getByText's
    // regex form can't traverse it -- getNodeText only joins an element's
    // own direct text-node children, not nested elements. Read the whole
    // tile's textContent instead, which does recurse.
    const tile = screen.getAllByTestId('weather-tile')[0];
    expect(tile.textContent).toMatch(/28°F\s*\/\s*22°F/);
  });

  it('renders the Air/Road separator as muted', () => {
    render(<WeatherStrip weather={reading} />);
    const tile = screen.getAllByTestId('weather-tile')[0];
    const separator = within(tile).getByText('/');
    expect(separator.tagName).toBe('SPAN');
    expect(separator).toHaveClass('text-muted');
  });

  it('says "No report" rather than an em-dash when there is no surface reading', () => {
    // Ruling R2: a bare em-dash under SURFACE reads as a condition WYDOT
    // reported. "No report" keeps the fixed 2x2 and removes that reading.
    render(<WeatherStrip weather={reading} surfaceCondition={null} />);
    expect(screen.getByText('No report')).toBeInTheDocument();
  });

  it('rounds gust to whole mph so it cannot wrap', () => {
    render(<WeatherStrip weather={{ ...reading, windGustMph: 11.2 }} />);
    expect(screen.getByText('11 mph W')).toBeInTheDocument();
    expect(screen.queryByText(/11\.2/)).not.toBeInTheDocument();
  });

  it('puts the elevation on the header row, not under the heading', () => {
    render(<WeatherStrip weather={reading} />);
    expect(screen.getByText('WY-22 · 8,431 ft')).toBeInTheDocument();
  });

  it('renders a fallback when weather is null', () => {
    render(<WeatherStrip weather={null} />);
    expect(screen.getByText(/weather data unavailable/i)).toBeInTheDocument();
  });

  describe('visibility formatting (feet -> miles)', () => {
    it.each([
      [52800, '10 mi'],
      [13200, '2.5 mi'],
      [2640, '0.5 mi'],
      [2639, '2639 ft'],
      [500, '500 ft'],
      // 15839 ft = 2.99981... mi -- rounds to 3.0 at 1 decimal, so this must
      // take the whole-number branch ("3 mi"), not "3.0 mi" (review fix).
      [15839, '3 mi'],
    ])('formats %i ft as %s', (visibilityFt, expected) => {
      render(<WeatherStrip weather={{ ...reading, visibilityFt }} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it('leaves the placeholder unchanged when visibility is null', () => {
      render(<WeatherStrip weather={{ ...reading, visibilityFt: null }} />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('weatherStale (LH T2 finding 4)', () => {
    it('shows no staleness copy when weatherStale is false (the default)', () => {
      render(<WeatherStrip weather={reading} />);
      expect(screen.queryByText(/outdated/i)).not.toBeInTheDocument();
    });

    it('shows a muted "as of" suffix, formatted from reportedAt, when weatherStale is true', () => {
      render(<WeatherStrip weather={reading} weatherStale />);
      // reading.reportedAt = '2026-01-09T18:00:00.000Z' -> 11:00 AM America/Denver (MST, UTC-7).
      expect(screen.getByText(/outdated/i)).toBeInTheDocument();
      expect(screen.getByText(/as of 11:00 AM/i)).toBeInTheDocument();
    });

    it('still renders the tiles (last-known beats nothing) when weatherStale is true', () => {
      render(<WeatherStrip weather={reading} weatherStale />);
      expect(screen.getByText(/28°F/)).toBeInTheDocument();
    });

    it('omits the "(as of ...)" time when reportedAt is null, but keeps the outdated flag', () => {
      render(<WeatherStrip weather={{ ...reading, reportedAt: null }} weatherStale />);
      expect(screen.getByText(/outdated/i)).toBeInTheDocument();
      expect(screen.queryByText(/as of/i)).not.toBeInTheDocument();
    });
  });
});

// The road-surface condition ("Dry", "Snow packed") is a WYDOT observation
// distinct from the OPEN/CLOSED status -- see ApiStatus.surfaceCondition.
describe('WeatherStrip — surface condition tile', () => {
  it('renders the condition as its own tile when present', () => {
    render(<WeatherStrip weather={reading} surfaceCondition="Dry" />);
    expect(screen.getByText('Surface')).toBeInTheDocument();
    expect(screen.getByText('Dry')).toBeInTheDocument();
  });

  it('always renders the tile, saying "No report" when the condition is null', () => {
    // Ruling R2: the tile is fixed in the 2x2 grid regardless of whether
    // WYDOT sent a surface reading -- see the "No report" test above.
    render(<WeatherStrip weather={reading} surfaceCondition={null} />);
    expect(screen.getByText('Surface')).toBeInTheDocument();
    expect(screen.getByText('No report')).toBeInTheDocument();
  });

  it('truncates a long WYDOT condition string visually, but keeps it in full via title', () => {
    // WYDOT emits multi-word strings ("Snow packed, slick in spots") that
    // run about twice this tile's ~149px inner width at this type size --
    // jsdom does no layout, so a plain getByText assertion here would pass
    // regardless of whether the tile can actually hold the string (this is
    // exactly what happened: the old version of this test asserted the
    // string rendered "in full, without truncating it", which was true in
    // jsdom and false on screen). The value element now carries `truncate`
    // deliberately -- don't revert it to `whitespace-nowrap` because this
    // test looks green; the CSS is doing real work the DOM query can't see.
    render(<WeatherStrip weather={reading} surfaceCondition="Snow packed, slick in spots" />);
    const value = screen.getByText('Snow packed, slick in spots');
    expect(value).toHaveClass('truncate');
    // The full string still reaches hover and assistive tech via `title`,
    // even though the tail is visually clipped.
    expect(value).toHaveAttribute('title', 'Snow packed, slick in spots');
  });

  it('renders "No report" for the Surface tile when no condition is supplied at all', () => {
    render(<WeatherStrip weather={reading} />);
    expect(screen.getByText('Air / Road')).toBeInTheDocument();
    expect(screen.getByText('Visibility')).toBeInTheDocument();
    expect(screen.getByText('Surface')).toBeInTheDocument();
    expect(screen.getByText('No report')).toBeInTheDocument();
  });
});

describe('WeatherStrip — temperature unit', () => {
  it('renders temperatures in Celsius when the unit is C', () => {
    render(<WeatherStrip weather={reading} unit="C" />);
    // reading.airF is 28 -> -2°C, surfaceF is 22 -> -6°C. Read via
    // textContent, not getByText, since the separator span breaks up the
    // tile's direct text-node children (see the combined-tile test above).
    const tile = screen.getAllByTestId('weather-tile')[0];
    expect(tile.textContent).toMatch(/-2°C\s*\/\s*-6°C/);
  });

  it('defaults to Fahrenheit when no unit is supplied', () => {
    render(<WeatherStrip weather={reading} />);
    expect(screen.getByText(/28°F/)).toBeInTheDocument();
  });

  it('labels the tiles as summit readings with a visible heading', () => {
    render(<WeatherStrip weather={reading} />);
    const heading = screen.getByRole('heading', { name: 'Summit conditions' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(/8,431 ft/)).toBeInTheDocument();
  });

  it('names the section from the visible heading rather than duplicating it', () => {
    render(<WeatherStrip weather={reading} />);
    expect(screen.getByRole('region', { name: 'Summit conditions' })).toBeInTheDocument();
  });

  it('keeps the heading when there is no weather data at all', () => {
    render(<WeatherStrip weather={null} />);
    expect(screen.getByRole('heading', { name: 'Summit conditions' })).toBeInTheDocument();
    expect(screen.getByText('Weather data unavailable.')).toBeInTheDocument();
  });
});
