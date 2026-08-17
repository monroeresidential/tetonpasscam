/**
 * jsdom implements no `matchMedia`, and `useIsDesktop` treats its absence as
 * "not desktop" -- so without this stub every test silently exercises the
 * phone branch and a desktop assertion passes for the wrong reason.
 *
 * Call in the test body BEFORE render; `useIsDesktop` reads the query in a
 * `useState` initializer, so stubbing after mount has no effect.
 */
export function setMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
