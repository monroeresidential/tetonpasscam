// Testable seam for main.tsx (code-review fix): main.tsx's real entry-point
// wiring is just two calls -- `hideSeoShell(); mount(document.getElementById
// ('root')!)` -- with the actual logic pulled into src/app/mount.tsx so this
// file can exercise it without main.tsx's own module-level side effect.
//
// The previous version of this test dynamically imported main.tsx itself,
// which created a real React root via createRoot(...).render(...) and never
// unmounted it (afterEach only cleared innerHTML). That left useStatus's
// setInterval/visibilitychange listener and pending scheduler work alive
// past this file's jsdom teardown -- code review reproduced an intermittent
// cross-file `ReferenceError: window is not defined` from react-dom's
// scheduler firing after another file's environment had already torn down.
// Testing `hideSeoShell`/`mount` directly instead lets this file capture the
// returned `Root` and `.unmount()` it in `afterEach`, same convention
// useStatus.test.ts already uses for its own renderHook cleanup.
import { act } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hideSeoShell, mount } from '../../src/app/mount';

describe('mount.tsx (main.tsx entry-point helpers)', () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let shell: HTMLDivElement;

  beforeEach(() => {
    shell = document.createElement('div');
    shell.id = 'seo-shell';
    document.body.appendChild(shell);

    container = document.createElement('div');
    document.body.appendChild(container);

    // Avoid a real network call from the mounted App's useStatus poll --
    // offline handling is exercised elsewhere (App.test.tsx); here it's
    // just noise this file doesn't care about.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    vi.restoreAllMocks();
    shell.remove();
    container.remove();
  });

  it('hideSeoShell hides the static #seo-shell', () => {
    hideSeoShell();
    expect(shell).toHaveAttribute('hidden');
  });

  it('hideSeoShell is a no-op (does not throw) when #seo-shell is absent', () => {
    shell.remove();
    expect(() => hideSeoShell()).not.toThrow();
  });

  it('mount renders the app into the given container and returns an unmountable root', async () => {
    await act(async () => {
      root = mount(container);
      // Flush the pending (mocked, rejecting) fetch microtask so the
      // effect's catch path settles within this act() before we assert.
      await Promise.resolve();
    });

    // Proves render() actually committed into this exact container: the
    // mocked fetch rejects, and by the time the flushed microtask above
    // settles, useStatus's error path has already flipped App from its
    // pre-fetch "Loading…" state to this "Unable to load…" retry copy.
    expect(container.textContent).toContain('Unable to load pass status');
  });

  it('unmounting clears up cleanly (no leaked interval/listener assertions needed here -- covered by useStatus.test.ts; this just confirms unmount itself does not throw)', async () => {
    await act(async () => {
      root = mount(container);
      await Promise.resolve();
    });

    await act(async () => {
      root!.unmount();
    });
    root = null; // already unmounted -- afterEach's guard would otherwise double-unmount
    expect(container.textContent).toBe('');
  });
});
