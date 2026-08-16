import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ChartLegend from '../../src/app/components/ChartLegend';

// The legend used to be hand-written markup at each call site, with plain
// text glyphs ("—", "▬") rendered in one muted colour regardless of the
// series they described. A reader could not tell which entry went with
// which line, and one site silently omitted two of its four series.
describe('ChartLegend', () => {
  it('renders a labelled swatch per entry', () => {
    render(
      <ChartLegend
        items={[
          { label: 'Today', kind: 'line', color: 'var(--color-accent)' },
          { label: 'Typical day', kind: 'line', color: 'var(--color-status-open)' },
          { label: 'Typical range', kind: 'band', color: 'var(--color-status-open)' },
        ]}
      />,
    );
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Typical day')).toBeTruthy();
    expect(screen.getByText('Typical range')).toBeTruthy();
    expect(screen.getAllByTestId('legend-swatch')).toHaveLength(3);
  });

  it("paints each swatch in its series' own colour", () => {
    // The whole point: a legend entry must never claim a colour the line it
    // describes does not have.
    render(
      <ChartLegend
        items={[
          { label: 'Today', kind: 'line', color: 'var(--color-accent)' },
          { label: 'Typical day', kind: 'line', color: 'var(--color-status-open)' },
        ]}
      />,
    );
    const swatches = screen.getAllByTestId('legend-swatch');
    expect(swatches[0].getAttribute('style')).toContain('--color-accent');
    expect(swatches[1].getAttribute('style')).toContain('--color-status-open');
  });

  it('distinguishes a band swatch from a line swatch', () => {
    render(
      <ChartLegend
        items={[
          { label: 'Typical day', kind: 'line', color: 'var(--color-status-open)' },
          { label: 'Typical range', kind: 'band', color: 'var(--color-status-open)' },
        ]}
      />,
    );
    const [line, band] = screen.getAllByTestId('legend-swatch');
    // Same colour, different mark -- the band is the taller translucent
    // block, the line a thin bar.
    expect(line.getAttribute('data-kind')).toBe('line');
    expect(band.getAttribute('data-kind')).toBe('band');
  });

  it('renders a dashed swatch for a dashed series', () => {
    render(
      <ChartLegend
        items={[{ label: 'Road surface, typical', kind: 'dashed', color: 'var(--color-muted)' }]}
      />,
    );
    expect(screen.getByTestId('legend-swatch').getAttribute('data-kind')).toBe('dashed');
  });

  it('uses no hardcoded hex -- colours come from tokens', () => {
    const { container } = render(
      <ChartLegend items={[{ label: 'Today', kind: 'line', color: 'var(--color-accent)' }]} />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
