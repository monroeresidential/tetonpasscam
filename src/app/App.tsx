import { useEffect, useState } from 'react';

import StatusBanner from './components/StatusBanner';
import DriveTimes from './components/DriveTimes';
import WeatherStrip from './components/WeatherStrip';
import AlertsStrip from './components/AlertsStrip';
import Cameras from './components/Cameras';
import Header from './components/Header';
import ReportModal from './components/ReportModal';
import Sponsor from './components/Sponsor';
import About from './components/About';
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

      {/* Single centered column at every width -- DOM order below is the
          visual order on phone and desktop alike: header/banner/
          drive-times/alerts/cameras/weather/sponsor/footer. Desktop no
          longer splits into a two-column grid; it's the same flex-column
          stack as phone, just capped to a wider `lg:max-w-[720px]` reading
          width. Header/banner/footer stay full-width inside this
          capped-width wrapper, same as the mockup. */}
      <div className="mx-auto max-w-[30rem] px-3.5 lg:max-w-[720px] lg:px-7">
        <Header onReport={() => setReportOpen(true)} variant={isDesktop ? 'desktop' : 'phone'} />

        <StatusBanner data={data} />

        <div className="mt-2 flex flex-col gap-2">
          <div>
            <DriveTimes travelTimes={data.travelTimes} statusSnapshotId={data.statusSnapshotId} />
          </div>
          <div>
            <AlertsStrip alerts={data.alerts} id33Advisory={data.id33Advisory} />
          </div>
          <div>
            <Cameras refreshedAt={refreshedAt} />
          </div>
          <div>
            <WeatherStrip weather={data.weather} weatherStale={data.weatherStale} />
          </div>
          <div>
            <Sponsor />
          </div>
        </div>

        <About />

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
