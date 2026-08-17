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

  // Layout cannot be asserted in jsdom (no CSS), so pin the structural
  // contract that produces it. The bug: Home's two phone controls were sized
  // to their labels in a flex-wrap row, so the direction control dropped onto
  // its own line once the pair no longer fit -- which happens on an ordinary
  // phone as soon as the reader increases their text size. Halves cannot wrap.
  describe('fullWidth', () => {
    it('hugs its labels by default, so /history\'s standalone control is unchanged', () => {
      render(<Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" />);
      const group = screen.getByRole('group', { name: 'Idaho town' });
      expect(group).toHaveClass('inline-flex');
      expect(group).not.toHaveClass('w-full');
      expect(screen.getByRole('button', { name: 'Victor' })).not.toHaveClass('flex-1');
    });

    it('fills its parent and splits the segments evenly when set', () => {
      render(
        <Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" fullWidth />,
      );
      const group = screen.getByRole('group', { name: 'Idaho town' });
      expect(group).toHaveClass('flex', 'w-full');
      expect(group).not.toHaveClass('inline-flex');
      // basis-0 alongside flex-1 is what makes the two segments equal
      // regardless of label length ("Victor" vs "Driggs", "\u2192 WY" vs "\u2192 ID").
      for (const name of ['Victor', 'Driggs']) {
        expect(screen.getByRole('button', { name })).toHaveClass('flex-1', 'basis-0');
      }
    });

    it('keeps the 44px tap target and stops labels wrapping when full width', () => {
      render(
        <Segmented options={OPTIONS} value="victor" onChange={() => {}} ariaLabel="Idaho town" fullWidth />,
      );
      for (const name of ['Victor', 'Driggs']) {
        const btn = screen.getByRole('button', { name });
        expect(btn).toHaveClass('min-h-[44px]', 'whitespace-nowrap');
      }
    });
  });
});
