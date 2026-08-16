import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HourlyStrip from '../../src/app/components/HourlyStrip';
import { WEATHER_GLYPH, WEATHER_GLYPH_NIGHT } from '../../src/app/weatherGlyphs';
import type { ForecastHour } from '../../src/shared/types';

function hour(over: Partial<ForecastHour> & { startTime: string }): ForecastHour {
  return {
    tempF: 62,
    category: 'clear',
    isDaytime: true,
    shortForecast: 'Sunny',
    precipPct: 20,
    ...over,
  };
}

const TWELVE: ForecastHour[] = Array.from({ length: 12 }, (_, i) =>
  hour({ startTime: `2026-08-16T${String(13 + i).padStart(2, '0')}:00:00-06:00` }),
);

describe('HourlyStrip', () => {
  it('renders a card per hour under the rolling heading', () => {
    render(<HourlyStrip hourly={TWELVE} />);
    expect(screen.getByRole('heading', { name: 'Next 12 hours' })).toBeInTheDocument();
    expect(screen.getAllByTestId('hour-card')).toHaveLength(12);
  });

  it('labels hours in America/Denver regardless of the viewer', () => {
    render(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00' })]} />);
    expect(screen.getByText('1 PM')).toBeInTheDocument();
  });

  it('renders temperatures in the selected unit', () => {
    const { rerender } = render(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00' })]} unit="F" />);
    expect(screen.getByText('62°F')).toBeInTheDocument();
    rerender(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00' })]} unit="C" />);
    expect(screen.getByText('17°C')).toBeInTheDocument();
  });

  it('uses the night glyph after dark', () => {
    render(
      <HourlyStrip
        hourly={[hour({ startTime: '2026-08-16T22:00:00-06:00', isDaytime: false, category: 'clear' })]}
      />,
    );
    expect(screen.getByTestId('glyph-tile')).toHaveTextContent(WEATHER_GLYPH_NIGHT.clear!);
    expect(screen.getByTestId('glyph-tile')).not.toHaveTextContent(WEATHER_GLYPH.clear);
  });

  it('shows an em-dash for a null precip, never 0%', () => {
    render(<HourlyStrip hourly={[hour({ startTime: '2026-08-16T13:00:00-06:00', precipPct: null })]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('renders nothing at all when empty', () => {
    const { container } = render(<HourlyStrip hourly={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the prop is missing entirely (pre-schema cached payload)', () => {
    const { container } = render(<HourlyStrip hourly={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
