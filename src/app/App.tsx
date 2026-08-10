import { useEffect, useState } from 'react';

import StatusBanner from './components/StatusBanner';
import DriveTimes from './components/DriveTimes';
import WeatherStrip from './components/WeatherStrip';
import AlertsStrip from './components/AlertsStrip';
import Cameras from './components/Cameras';
import Header from './components/Header';
import ReportModal from './components/ReportModal';
import Sponsor from './components/Sponsor';
import Footer from './components/Footer';
import { useStatus } from './useStatus';

const OFFLINE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Live `matchMedia`-backed breakpoint check, used solely to decide which of
 * the two "⚠ Report conditions" trigger buttons is mounted (Header's inline
 * desktop button vs. ReportModal's own fixed phone pill) -- never both at
 * once. Everything else about the phone/desktop layout (the grid, the
 * camera rail) is plain responsive `lg:` Tailwind classes on a single set of
 * DOM nodes and needs no JS at all; the trigger button is the one exception
 * because the two variants are genuinely different elements per the design
 * (not the same node repositioned), and jsdom loads no stylesheet, so
 * `hidden`/`lg:inline-flex`-style classes alone would leave both
 * simultaneously present and accessible in tests -- ambiguous for any
 * `getByRole('button', { name: /report conditions/i })` query. Defaults to
 * `false` when `matchMedia` isn't available (jsdom), which is also why the
 * frozen submit-refetch test below still finds exactly one such button.
 */
function useIsDesktop(): boolean {
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

function App() {
  const { data, error, refreshedAt, refresh, offline, offlineSince } = useStatus();
  const isDesktop = useIsDesktop();
  const [reportOpen, setReportOpen] = useState(false);

  if (!data) {
    return (
      <main className="min-h-screen bg-page p-4">
        <p role="status" aria-live="polite" className="text-center text-muted">
          {error ? 'Unable to load pass status. Retrying…' : 'Loading pass status…'}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page pb-28 lg:pb-10">
      {offline && (
        <div role="alert" className="w-full bg-status-closed p-3 text-center font-bold text-white">
          OFFLINE — showing last known status from{' '}
          {offlineSince ? OFFLINE_TIME_FORMAT.format(offlineSince) : 'an earlier visit'}
        </div>
      )}

      {/* Phone: plain flex column, DOM order below is the visual order --
          matches design card 1a's header/banner/drive-times/alerts/
          cameras/weather/sponsor/footer stack. Desktop (card 2a): only
          this inner section becomes a `1fr 380px` grid, with every child
          explicitly `lg:col-start-1`/`lg:row-start-N`-placed and Cameras
          pinned to column 2 spanning those rows -- explicit placement
          throughout (rather than relying on implicit grid auto-flow around
          Cameras's span) so the two-column desktop arrangement can't
          silently reorder around the phone-order DOM. Header/banner/footer
          stay full-width inside this capped-width wrapper, same as the
          mockup. */}
      <div className="mx-auto max-w-[30rem] px-3.5 lg:max-w-[1080px] lg:px-7">
        <Header onReport={() => setReportOpen(true)} variant={isDesktop ? 'desktop' : 'phone'} />

        <StatusBanner data={data} />

        <div className="mt-2 flex flex-col gap-2 lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-5">
          <div className="lg:col-start-1 lg:row-start-1">
            <DriveTimes travelTimes={data.travelTimes} />
          </div>
          <div className="lg:col-start-1 lg:row-start-2">
            <AlertsStrip alerts={data.alerts} id33Advisory={data.id33Advisory} />
          </div>
          <div className="lg:col-start-2 lg:row-start-1 lg:row-span-4">
            <Cameras refreshedAt={refreshedAt} />
          </div>
          <div className="lg:col-start-1 lg:row-start-3">
            <WeatherStrip weather={data.weather} />
          </div>
          <div className="lg:col-start-1 lg:row-start-4">
            <Sponsor />
          </div>
        </div>

        <Footer />
      </div>

      <ReportModal
        onSuccess={refresh}
        open={reportOpen}
        onOpenChange={setReportOpen}
        renderTrigger={!isDesktop}
      />
    </main>
  );
}

export default App;
