import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Header from '../../src/app/components/Header';

const NOW = new Date('2026-08-09T12:12:00');

describe('Header', () => {
  it('renders the wordmark "Teton Pass Cam"', () => {
    render(<Header onReport={vi.fn()} now={NOW} />);
    expect(screen.getByText('Teton Pass Cam')).toBeInTheDocument();
  });

  it('renders the route-22 mark before the wordmark, decorative (empty alt)', () => {
    const { container } = render(<Header onReport={vi.fn()} now={NOW} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/icons/icon-192.png');
    expect(img).toHaveAttribute('width', '40');
    expect(img).toHaveAttribute('height', '40');
    expect(img).toHaveAttribute('alt', '');
  });

  it('renders the local time as "Sat 6:12 AM"-style text (weekday-short + h:mm AM/PM)', () => {
    render(<Header onReport={vi.fn()} now={NOW} />);
    expect(screen.getByText(/^[A-Z][a-z]{2} \d{1,2}:\d{2} (AM|PM)$/)).toBeInTheDocument();
  });

  it('does not render a report button in the default (phone) variant', () => {
    render(<Header onReport={vi.fn()} now={NOW} />);
    expect(screen.queryByRole('button', { name: /report conditions/i })).not.toBeInTheDocument();
  });

  it('renders an inline report button in the desktop variant and calls onReport when clicked', async () => {
    const onReport = vi.fn();
    const user = userEvent.setup();
    render(<Header onReport={onReport} now={NOW} variant="desktop" />);

    const button = screen.getByRole('button', { name: /report conditions/i });
    await user.click(button);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('prefixes the desktop-variant time with the "Live cams & conditions ·" tagline', () => {
    render(<Header onReport={vi.fn()} now={NOW} variant="desktop" />);
    expect(
      screen.getByText(/^Live cams & conditions · [A-Z][a-z]{2} \d{1,2}:\d{2} (AM|PM)$/),
    ).toBeInTheDocument();
  });

  it('does not render the desktop tagline in the default (phone) variant', () => {
    render(<Header onReport={vi.fn()} now={NOW} />);
    expect(screen.queryByText(/live cams & conditions/i)).not.toBeInTheDocument();
  });
});
