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
  it('renders 5 stat tiles', () => {
    render(<WeatherStrip weather={reading} now={new Date('2026-01-15T12:00:00.000Z')} />);
    expect(screen.getByText('Air temp')).toBeInTheDocument();
    expect(screen.getByText('Surface temp')).toBeInTheDocument();
    expect(screen.getByText('Wind')).toBeInTheDocument();
    expect(screen.getByText('Wind direction')).toBeInTheDocument();
    expect(screen.getByText('Visibility')).toBeInTheDocument();
  });

  it('puts surface temp before air temp Nov-Apr (winter, client clock)', () => {
    render(<WeatherStrip weather={reading} now={new Date('2026-01-15T12:00:00.000Z')} />);
    const labels = screen.getAllByText(/temp$/).map((el) => el.textContent);
    expect(labels).toEqual(['Surface temp', 'Air temp']);
  });

  it('puts air temp before surface temp May-Oct (summer, client clock)', () => {
    render(<WeatherStrip weather={reading} now={new Date('2026-07-15T12:00:00.000Z')} />);
    const labels = screen.getAllByText(/temp$/).map((el) => el.textContent);
    expect(labels).toEqual(['Air temp', 'Surface temp']);
  });

  it('renders a fallback when weather is null', () => {
    render(<WeatherStrip weather={null} />);
    expect(screen.getByText(/weather data unavailable/i)).toBeInTheDocument();
  });
});
