// Explainer relocation (Drew-requested scope addition): the static
// #seo-shell in index.html must stay in the raw HTML for crawlers/no-JS
// (see test/parsers/index-html.test.ts, unmodified), but real users should
// never see it -- main.tsx hides it once React takes over. This is a
// module-side-effect test: main.tsx's top-level code (not wrapped in a
// function) runs the hide-and-mount logic as soon as it's imported, so each
// test builds a fresh #seo-shell/#root pair, resets the module registry so
// the import actually re-executes, and checks the attribute synchronously
// (no need to wait on React's render, since the hide happens before/
// alongside it in the same synchronous module body).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('main.tsx', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="seo-shell"></div><div id="root"></div>';
    // Avoid real network calls from the mounted App's useStatus poll --
    // offline handling is exercised elsewhere (App.test.tsx); here it's
    // just noise this test doesn't care about.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('hides the static #seo-shell once the React app mounts', async () => {
    await import('../../src/app/main');
    expect(document.getElementById('seo-shell')).toHaveAttribute('hidden');
  });

  it('does not remove or mutate #root, which the app mounts into', async () => {
    await import('../../src/app/main');
    expect(document.getElementById('root')).not.toBeNull();
  });
});
