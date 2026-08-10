import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ShareButton, { buildShareUrl } from '../../src/app/components/ShareButton';

function defineNavProp(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

// @testing-library/user-event's `setup()` installs its own real
// `navigator.clipboard.writeText` polyfill as a side effect (needed for its
// own copy/paste keyboard-shortcut support) -- calling it AFTER our
// `defineNavProp('clipboard', ...)` mock silently clobbers the mock with
// user-event's real implementation, which is what caused
// `expect(navigator.clipboard.writeText).toHaveBeenCalledWith(...)` to fail
// with "is not a spy" on a first pass at this file. So every test below
// calls `userEvent.setup()` FIRST, then installs the navigator mocks.
function setupUser() {
  const user = userEvent.setup();
  defineNavProp('clipboard', { writeText: vi.fn().mockResolvedValue(undefined) });
  return user;
}

describe('buildShareUrl', () => {
  it('eb (default direction) has no query param', () => {
    const url = buildShareUrl(42, 'eb');
    expect(url).toBe(`${window.location.origin}/s/42`);
  });

  it('wb direction appends ?dir=wb', () => {
    const url = buildShareUrl(42, 'wb');
    expect(url).toBe(`${window.location.origin}/s/42?dir=wb`);
  });
});

describe('ShareButton', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when statusSnapshotId is null (pollerDead/no snapshot)', () => {
    render(<ShareButton statusSnapshotId={null} direction="eb" />);
    expect(screen.queryByRole('button', { name: /share current conditions/i })).not.toBeInTheDocument();
  });

  it('renders an accessible share control when a snapshot id is present', () => {
    render(<ShareButton statusSnapshotId={7} direction="eb" />);
    expect(screen.getByRole('button', { name: /share current conditions/i })).toBeInTheDocument();
  });

  describe('when navigator.share is available', () => {
    it('calls navigator.share with the snapshot-pinned URL and title, and shows no toast', async () => {
      const user = setupUser();
      defineNavProp('share', vi.fn().mockResolvedValue(undefined));

      render(<ShareButton statusSnapshotId={7} direction="wb" />);
      await user.click(screen.getByRole('button', { name: /share current conditions/i }));

      expect(navigator.share).toHaveBeenCalledWith({
        title: 'Teton Pass conditions',
        url: `${window.location.origin}/s/7?dir=wb`,
      });
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('AbortError (user cancelled the native share sheet) is a silent no-op: no toast, no clipboard fallback', async () => {
      const user = setupUser();
      const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
      defineNavProp('share', vi.fn().mockRejectedValue(abortError));

      render(<ShareButton statusSnapshotId={7} direction="eb" />);
      await user.click(screen.getByRole('button', { name: /share current conditions/i }));

      await waitFor(() => expect(navigator.share).toHaveBeenCalled());
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('a non-abort share() rejection falls back to clipboard + toast', async () => {
      const user = setupUser();
      defineNavProp('share', vi.fn().mockRejectedValue(new Error('no share target')));

      render(<ShareButton statusSnapshotId={7} direction="eb" />);
      await user.click(screen.getByRole('button', { name: /share current conditions/i }));

      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/s/7`),
      );
      expect(await screen.findByRole('status')).toHaveTextContent(/link copied/i);
    });
  });

  describe('when navigator.share is unavailable', () => {
    it('copies the URL to the clipboard and shows a "Link copied" toast', async () => {
      const user = setupUser();
      defineNavProp('share', undefined);

      render(<ShareButton statusSnapshotId={99} direction="wb" />);
      await user.click(screen.getByRole('button', { name: /share current conditions/i }));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/s/99?dir=wb`);
      expect(await screen.findByRole('status')).toHaveTextContent(/link copied/i);
    });
  });
});
