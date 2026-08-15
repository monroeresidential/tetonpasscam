import { render, screen } from '@testing-library/react';
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
  it('renders 4 stat tiles', () => {
    render(<WeatherStrip weather={reading} now={new Date('2026-01-15T12:00:00.000Z')} />);
    expect(screen.getByText('Air')).toBeInTheDocument();
    expect(screen.getByText('Road')).toBeInTheDocument();
    expect(screen.getByText('Gust')).toBeInTheDocument();
    expect(screen.getByText('Visibility')).toBeInTheDocument();
  });

  it('puts the Road tile before Air Nov-Apr (winter, client clock)', () => {
    render(<WeatherStrip weather={reading} now={new Date('2026-01-15T12:00:00.000Z')} />);
    const labels = screen.getAllByText(/^(Air|Road)$/).map((el) => el.textContent);
    expect(labels).toEqual(['Road', 'Air']);
  });

  it('puts the Air tile before Road May-Oct (summer, client clock)', () => {
    render(<WeatherStrip weather={reading} now={new Date('2026-07-15T12:00:00.000Z')} />);
    const labels = screen.getAllByText(/^(Air|Road)$/).map((el) => el.textContent);
    expect(labels).toEqual(['Air', 'Road']);
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
      render(
        <WeatherStrip
          weather={{ ...reading, visibilityFt }}
          now={new Date('2026-01-15T12:00:00.000Z')}
        />,
      );
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it('leaves the placeholder unchanged when visibility is null', () => {
      render(
        <WeatherStrip
          weather={{ ...reading, visibilityFt: null }}
          now={new Date('2026-01-15T12:00:00.000Z')}
        />,
      );
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('weatherStale (LH T2 finding 4)', () => {
    it('shows no staleness copy when weatherStale is false (the default)', () => {
      render(<WeatherStrip weather={reading} now={new Date('2026-01-15T12:00:00.000Z')} />);
      expect(screen.queryByText(/outdated/i)).not.toBeInTheDocument();
    });

    it('shows a muted "as of" suffix, formatted from reportedAt, when weatherStale is true', () => {
      render(
        <WeatherStrip weather={reading} weatherStale now={new Date('2026-01-15T12:00:00.000Z')} />,
      );
      // reading.reportedAt = '2026-01-09T18:00:00.000Z' -> 11:00 AM America/Denver (MST, UTC-7).
      expect(screen.getByText(/outdated/i)).toBeInTheDocument();
      expect(screen.getByText(/as of 11:00 AM/i)).toBeInTheDocument();
    });

    it('still renders the tiles (last-known beats nothing) when weatherStale is true', () => {
      render(
        <WeatherStrip weather={reading} weatherStale now={new Date('2026-01-15T12:00:00.000Z')} />,
      );
      expect(screen.getByText('28°F')).toBeInTheDocument();
    });

    it('omits the "(as of ...)" time when reportedAt is null, but keeps the outdated flag', () => {
      render(
        <WeatherStrip
          weather={{ ...reading, reportedAt: null }}
          weatherStale
          now={new Date('2026-01-15T12:00:00.000Z')}
        />,
      );
      expect(screen.getByText(/outdated/i)).toBeInTheDocument();
      expect(screen.queryByText(/as of/i)).not.toBeInTheDocument();
    });
  });
});

// The road-surface condition ("Dry", "Snow packed") is a WYDOT observation
// distinct from the OPEN/CLOSED status -- see ApiStatus.surfaceCondition.
describe('WeatherStrip — surface condition tile', () => {
  it('renders the condition as its own tile when present', () => {
    render(
      <WeatherStrip
        weather={reading}
        surfaceCondition="Dry"
        now={new Date('2026-01-15T12:00:00.000Z')}
      />,
    );
    expect(screen.getByText('Surface')).toBeInTheDocument();
    expect(screen.getByText('Dry')).toBeInTheDocument();
  });

  it('omits the tile entirely when the condition is null', () => {
    // Deliberately absent rather than an em-dash placeholder: the other
    // tiles are always-present numeric readings from one sensor page, while
    // this comes from a different page that can fail on its own. An empty
    // "Surface —" tile would imply we looked and the road had no condition.
    render(
      <WeatherStrip
        weather={reading}
        surfaceCondition={null}
        now={new Date('2026-01-15T12:00:00.000Z')}
      />,
    );
    expect(screen.queryByText('Surface')).not.toBeInTheDocument();
  });

  it('renders a long WYDOT condition string in full, without truncating it', () => {
    // WYDOT emits multi-word strings; the tile has to hold them.
    render(
      <WeatherStrip
        weather={reading}
        surfaceCondition="Snow packed, slick in spots"
        now={new Date('2026-01-15T12:00:00.000Z')}
      />,
    );
    expect(screen.getByText('Snow packed, slick in spots')).toBeInTheDocument();
  });

  it('still renders the four sensor tiles when no condition is supplied at all', () => {
    render(<WeatherStrip weather={reading} now={new Date('2026-01-15T12:00:00.000Z')} />);
    expect(screen.getByText('Air')).toBeInTheDocument();
    expect(screen.getByText('Visibility')).toBeInTheDocument();
    expect(screen.queryByText('Surface')).not.toBeInTheDocument();
  });
});
