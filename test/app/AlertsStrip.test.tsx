import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AlertsStrip from '../../src/app/components/AlertsStrip';
import type { PublicAlert } from '../../src/shared/types';

const NOW = new Date('2026-08-09T18:00:00.000Z');

function alert(overrides: Partial<PublicAlert>): PublicAlert {
  return {
    id: 1,
    type: 'crash',
    note: null,
    direction: null,
    createdAt: '2026-08-09T17:42:00.000Z', // 18 min before NOW
    ...overrides,
  };
}

describe('AlertsStrip', () => {
  // FROZEN (task-5-brief.md): exact empty-state string.
  it('renders the exact empty-state string when there are no alerts', () => {
    render(<AlertsStrip alerts={[]} id33Advisory={null} now={NOW} />);
    expect(screen.getByText('No reports in the last 3 hours.')).toBeInTheDocument();
  });

  // FROZEN (task-5-brief.md): "Unverified community report" label.
  it('renders "Unverified community report" per item', () => {
    render(
      <AlertsStrip
        alerts={[alert({ id: 1 }), alert({ id: 2, type: 'wildlife' })]}
        id33Advisory={null}
        now={NOW}
      />,
    );
    expect(screen.getAllByText('Unverified community report')).toHaveLength(2);
  });

  it('pins the "From the road" section heading', () => {
    render(<AlertsStrip alerts={[]} id33Advisory={null} now={NOW} />);
    expect(screen.getByRole('heading', { name: 'From the road' })).toBeInTheDocument();
  });

  it('renders the item title as "TypeLabel · westbound to Victor" for a wb alert', () => {
    render(
      <AlertsStrip alerts={[alert({ type: 'slick', direction: 'wb' })]} id33Advisory={null} now={NOW} />,
    );
    expect(screen.getByText('Slick/Ice · westbound to Victor')).toBeInTheDocument();
  });

  it('renders the item title as "TypeLabel · eastbound to Jackson" for an eb alert', () => {
    render(
      <AlertsStrip alerts={[alert({ type: 'crash', direction: 'eb' })]} id33Advisory={null} now={NOW} />,
    );
    expect(screen.getByText('Crash · eastbound to Jackson')).toBeInTheDocument();
  });

  it('renders the item title as just the type label when direction is absent', () => {
    render(
      <AlertsStrip alerts={[alert({ type: 'wildlife', direction: null })]} id33Advisory={null} now={NOW} />,
    );
    expect(screen.getByText('Wildlife')).toBeInTheDocument();
  });

  it('renders age as "18 min ago" for an alert 18 minutes old', () => {
    render(<AlertsStrip alerts={[alert({})]} id33Advisory={null} now={NOW} />);
    expect(screen.getByText('18 min ago')).toBeInTheDocument();
  });

  it('renders age in hours once an hour has passed', () => {
    render(
      <AlertsStrip
        alerts={[alert({ createdAt: '2026-08-09T15:00:00.000Z' })]} // 3h before NOW
        id33Advisory={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('3 h ago')).toBeInTheDocument();
  });

  it('renders the note in quotes followed by the age', () => {
    const { container } = render(
      <AlertsStrip
        alerts={[alert({ note: 'Glare ice near the summit turnout' })]}
        id33Advisory={null}
        now={NOW}
      />,
    );
    const meta = container.querySelector('[data-testid="alert-meta"]');
    expect(meta?.textContent).toBe('"Glare ice near the summit turnout" · 18 min ago');
  });

  it('renders the note text and does not use dangerouslySetInnerHTML (plain text escaping)', () => {
    render(
      <AlertsStrip
        alerts={[alert({ note: '<script>alert(1)</script>' })]}
        id33Advisory={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('renders no quote marks or separator in the meta line when there is no note', () => {
    const { container } = render(<AlertsStrip alerts={[alert({ note: null })]} id33Advisory={null} now={NOW} />);
    const meta = container.querySelector('[data-testid="alert-meta"]');
    expect(meta?.textContent).toBe('18 min ago');
  });

  it('renders the emoji for each alert type per the type->emoji map', () => {
    render(
      <AlertsStrip
        alerts={[alert({ id: 1, type: 'slick' }), alert({ id: 2, type: 'closure' })]}
        id33Advisory={null}
        now={NOW}
      />,
    );
    expect(screen.getByText('❄')).toBeInTheDocument();
    expect(screen.getByText('🚧')).toBeInTheDocument();
  });

  // FROZEN (task-5-brief.md): id33 advisory presence -- pinned text unchanged,
  // restyle (muted card) is allowed.
  it('renders a clearly-labeled ID-33 advisory line when non-null, distinct from the alerts list', () => {
    render(<AlertsStrip alerts={[]} id33Advisory="Chains required near Victor" now={NOW} />);
    expect(screen.getByText(/ID-33/)).toBeInTheDocument();
    expect(screen.getByText(/Chains required near Victor/)).toBeInTheDocument();
  });

  it('renders no ID-33 advisory line when null', () => {
    render(<AlertsStrip alerts={[]} id33Advisory={null} now={NOW} />);
    expect(screen.queryByText(/ID-33/)).not.toBeInTheDocument();
  });
});
