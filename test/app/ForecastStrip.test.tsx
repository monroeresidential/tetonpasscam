import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ForecastStrip from '../../src/app/components/ForecastStrip';
import type { ForecastDay } from '../../src/shared/types';

const NOON_MDT = new Date('2026-08-16T18:00:00.000Z'); // Sunday Aug 16, noon Denver

function day(over: Partial<ForecastDay> & { date: string }): ForecastDay {
  return {
    highF: 62,
    lowF: 38,
    category: 'clear',
    iconPath: '/api/wx-icon/land/day/few',
    shortForecast: 'Sunny',
    precipPct: 10,
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
    expect(screen.getByRole('heading', { name: '5-day forecast' })).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Thu')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(5);
  });

  it('describes each icon with the forecast text', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} />);
    expect(screen.getByRole('img', { name: 'Snow' })).toBeInTheDocument();
  });

  it('renders temperatures in the selected unit', () => {
    const { rerender } = render(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="F" />);
    expect(screen.getAllByText('62°F / 38°F').length).toBeGreaterThan(0);

    rerender(<ForecastStrip forecast={FIVE} now={NOON_MDT} unit="C" />);
    expect(screen.getAllByText('17°C / 3°C').length).toBeGreaterThan(0);
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

  it('flags a stale forecast without hiding it', () => {
    render(<ForecastStrip forecast={FIVE} now={NOON_MDT} forecastStale />);
    expect(screen.getByText(/may be outdated/i)).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('renders the text card when an icon path is missing', () => {
    render(<ForecastStrip forecast={[day({ date: '2026-08-16', iconPath: null })]} now={NOON_MDT} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('drops an icon that fails to load, keeping the rest of the card', () => {
    render(<ForecastStrip forecast={[day({ date: '2026-08-16' })]} now={NOON_MDT} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('62°F / 38°F')).toBeInTheDocument();
  });
});
