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
});
