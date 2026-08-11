import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ShareSheet from '../../src/app/components/ShareSheet';
import { buildShareUrl } from '../../src/app/components/ShareButton';

function defineNavProp(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

// See ShareButton.test.tsx's comment on why userEvent.setup() must run
// BEFORE the navigator.clipboard mock is installed (user-event's own
// clipboard polyfill would otherwise clobber it).
function setupUser() {
  const user = userEvent.setup();
  defineNavProp('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) });
  return user;
}

const CODE = '20260810-1412';

describe('ShareSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders as a labeled dialog', () => {
    render(<ShareSheet shareCode={CODE} direction="eb" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /share current conditions/i })).toBeInTheDocument();
  });

  it('shows the eb preview image for the given code', () => {
    render(<ShareSheet shareCode={CODE} direction="eb" onClose={vi.fn()} />);
    expect(screen.getByAltText(/preview of the card/i)).toHaveAttribute(
      'src',
      `/og/${CODE}-eb.png`,
    );
  });

  it('shows the wb preview image when direction is wb', () => {
    render(<ShareSheet shareCode={CODE} direction="wb" onClose={vi.fn()} />);
    expect(screen.getByAltText(/preview of the card/i)).toHaveAttribute(
      'src',
      `/og/${CODE}-wb.png`,
    );
  });

  describe('Copy link', () => {
    it('writes the buildShareUrl output to the clipboard and shows a toast, keeping the sheet open', async () => {
      const user = setupUser();
      render(<ShareSheet shareCode={CODE} direction="wb" onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /copy link/i }));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(buildShareUrl(CODE, 'wb'));
      expect(await screen.findByRole('status')).toHaveTextContent(/link copied/i);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  describe('Message', () => {
    it('is a link with an sms: href using the ?&body= form and the encoded share url', () => {
      render(<ShareSheet shareCode={CODE} direction="eb" onClose={vi.fn()} />);
      const link = screen.getByRole('link', { name: /message/i });
      const url = buildShareUrl(CODE, 'eb');
      expect(link).toHaveAttribute('href', `sms:?&body=${encodeURIComponent(url)}`);
    });
  });

  describe('More…', () => {
    it('is present when navigator.share exists and calls it with the share url', async () => {
      const user = setupUser();
      defineNavProp('share', vi.fn().mockResolvedValue(undefined));

      render(<ShareSheet shareCode={CODE} direction="wb" onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /^more/i }));

      expect(navigator.share).toHaveBeenCalledWith({
        title: 'Teton Pass conditions',
        url: buildShareUrl(CODE, 'wb'),
      });
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('AbortError is a silent no-op: no toast, no clipboard fallback', async () => {
      const user = setupUser();
      const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
      defineNavProp('share', vi.fn().mockRejectedValue(abortError));

      render(<ShareSheet shareCode={CODE} direction="eb" onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /^more/i }));

      await waitFor(() => expect(navigator.share).toHaveBeenCalled());
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('a non-abort rejection falls back to copying the link', async () => {
      const user = setupUser();
      defineNavProp('share', vi.fn().mockRejectedValue(new Error('no share target')));

      render(<ShareSheet shareCode={CODE} direction="eb" onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /^more/i }));

      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(buildShareUrl(CODE, 'eb')),
      );
      expect(await screen.findByRole('status')).toHaveTextContent(/link copied/i);
    });

    it('is not rendered at all when navigator.share is unavailable', () => {
      defineNavProp('share', undefined);
      render(<ShareSheet shareCode={CODE} direction="eb" onClose={vi.fn()} />);

      expect(screen.queryByRole('button', { name: /^more/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /message/i })).toBeInTheDocument();
    });
  });

  describe('closing', () => {
    it('calls onClose on Escape', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ShareSheet shareCode={CODE} direction="eb" onClose={onClose} />);

      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on backdrop click', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ShareSheet shareCode={CODE} direction="eb" onClose={onClose} />);

      await user.click(screen.getByRole('dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on a click inside the sheet panel', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ShareSheet shareCode={CODE} direction="eb" onClose={onClose} />);

      await user.click(screen.getByText(/share current conditions/i));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close when a drag starts inside the panel and releases on the backdrop', () => {
      const onClose = vi.fn();
      render(<ShareSheet shareCode={CODE} direction="eb" onClose={onClose} />);

      // Text-selection drag: mousedown on panel content, mouseup + the
      // browser-synthesized click both land on the backdrop.
      const dialog = screen.getByRole('dialog');
      fireEvent.mouseDown(screen.getByText(/share current conditions/i));
      fireEvent.mouseUp(dialog);
      fireEvent.click(dialog);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('calls onClose from the ✕ button', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ShareSheet shareCode={CODE} direction="eb" onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
