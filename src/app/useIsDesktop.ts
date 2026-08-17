import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Live `matchMedia`-backed breakpoint check, shared by anything that needs
 * to render genuinely different markup (not just different classes) above
 * vs. below 1024px -- e.g. App's phone/desktop Report-conditions trigger,
 * and TypicalChart's phone/desktop geometry profiles, where the tick COUNT
 * changes and not just the styling.
 *
 * Defaults to `false` when `matchMedia` isn't available (jsdom loads no
 * stylesheet and implements no `matchMedia`), so an unstubbed test always
 * gets the phone branch -- see `test/app/matchMedia.ts` for the stub that
 * makes a desktop assertion mean anything.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(DESKTOP_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}
