import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HomeHistoryCard from '../../src/app/components/HomeHistoryCard';

describe('HomeHistoryCard', () => {
  it('links to the full history page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          route: { slug: 'victor-jackson-eb', name: 'Victor → Jackson' },
          typicals: [],
          today: [],
          summary: { worstDays: null, seasonMedians: null, closureDays: null },
        }),
      })),
    );
    render(<HomeHistoryCard slug="victor-jackson-eb" />);
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/history'));
  });
});
