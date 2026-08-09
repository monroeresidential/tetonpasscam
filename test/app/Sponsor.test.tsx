import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Sponsor from '../../src/app/components/Sponsor';

describe('Sponsor', () => {
  it('renders the exact sponsor copy and UTM link', () => {
    render(<Sponsor />);
    const section = screen.getByLabelText('Sponsor');
    expect(section.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Sponsored by Teton Flats — modern 1 & 2 bed apartments in Victor, 35 minutes from Jackson. Live here, check this page less.',
    );

    const link = screen.getByRole('link', { name: 'Teton Flats' });
    expect(link).toHaveAttribute(
      'href',
      'https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor',
    );
  });
});
