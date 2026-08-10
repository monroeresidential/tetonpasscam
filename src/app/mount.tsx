import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';

/**
 * Hides the static SEO shell (`#seo-shell` in index.html) once React is
 * about to take over -- see that element's own comment for why it has to
 * stay in the raw HTML at all (crawlers, no-JS visitors). Split out of
 * main.tsx into its own function (rather than inlined top-level code there)
 * so test/app/mount.test.tsx can call it directly against a container it
 * builds and owns, instead of exercising it via main.tsx's real module
 * side effect -- which also creates a live, uncapturable React root (see
 * `mount` below for why that specifically matters for tests).
 */
export function hideSeoShell(): void {
  document.getElementById('seo-shell')?.setAttribute('hidden', '');
}

/**
 * Creates a React root in `container` and renders `<App />` into it,
 * returning the `Root` so the caller can `.unmount()` it later. main.tsx
 * (the real browser entry point) never unmounts this -- the page just
 * navigates away -- but tests must: an unmounted root leaves useStatus's
 * `setInterval`/`visibilitychange` listener and pending scheduler work
 * alive past that test file's jsdom teardown, which previously surfaced as
 * an intermittent cross-file `ReferenceError: window is not defined` when
 * react-dom's scheduler fired after teardown.
 */
export function mount(container: Element): Root {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return root;
}
