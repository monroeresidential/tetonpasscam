import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Segmented from '../../src/app/components/Segmented';

const OPTIONS = [
  { value: 'victor', label: 'Victor' },
  { value: 'driggs', label: 'Driggs' },
] as const;

describe('Segmented', () => {
  it('exposes the selection as pressed state, not just styling', () => {
    render(<Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" />);
    expect(screen.getByRole('button', { name: 'Victor' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Driggs' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('groups the two buttons under the given label', () => {
    render(<Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" />);
    expect(screen.getByRole('group', { name: 'Idaho town' })).toBeInTheDocument();
  });

  it('reports the newly picked value', async () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value="victor" onChange={onChange} ariaLabel="Idaho town" />);
    await userEvent.click(screen.getByRole('button', { name: 'Driggs' }));
    expect(onChange).toHaveBeenCalledWith('driggs');
  });

  it('does not fire onChange when the active segment is re-clicked', () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value="victor" onChange={onChange} ariaLabel="Idaho town" />);
    screen.getByRole('button', { name: 'Victor' }).click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives every segment a 44px minimum tap target', () => {
    render(<Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" />);
    // The prototype's padding alone yields ~34px; the min-height is what
    // reaches the 44px the handoff requires.
    for (const name of ['Victor', 'Driggs']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-[44px]');
    }
  });
});
