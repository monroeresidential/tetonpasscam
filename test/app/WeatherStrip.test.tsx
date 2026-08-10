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
});
