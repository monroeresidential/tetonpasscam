import { useState } from 'react';

import StatusBanner from './components/StatusBanner';
import DriveTimes, { idahoTownOf, type Town } from './components/DriveTimes';
import { effectivePassStatus } from './effectiveStatus';
import WeatherStrip from './components/WeatherStrip';
import ForecastStrip from './components/ForecastStrip';
import HourlyStrip from './components/HourlyStrip';
import AlertsStrip from './components/AlertsStrip';
import Cameras from './components/Cameras';
import Header from './components/Header';
import HomeHistoryCard from './components/HomeHistoryCard';
import ReportModal from './components/ReportModal';
import Sponsor from './components/Sponsor';
import About from './components/About';
import Footer from './components/Footer';
import TempUnitToggle from './components/TempUnitToggle';
import { useStatus } from './useStatus';
import { useTempUnit } from './units';
import { useIsDesktop } from './useIsDesktop';

const OFFLINE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function App() {
  const { data, error, refreshedAt, refresh, offline, offlineSince } = useStatus();
  const isDesktop = useIsDesktop();
  const [reportOpen, setReportOpen] = useState(false);
  const [direction, setDirection] = useState<'eb' | 'wb'>('eb');
  const [town, setTown] = useState<Town>('victor');
  const { unit, setUnit } = useTempUnit();

  if (!data) {
    return (
      <main className="min-h-screen bg-page p-4">
        <p role="status" aria-live="polite" className="text-center text-muted">
          {error ? 'Unable to load pass status. Retrying…' : 'Loading pass status…'}
        </p>
      </main>
    );
  }

  const passStatus = effectivePassStatus(data);

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
          stack as phone, just capped to a wider `lg:max-w-[960px]` reading
          width. Header/banner/footer stay full-width inside this
          capped-width wrapper, same as the mockup. */}
      <div className="mx-auto max-w-[30rem] px-3.5 lg:max-w-[960px] lg:px-7">
        {/* The page's only h1, deliberately invisible. The visible title at
            the top of the screen is the header's logo-plus-wordmark lockup,
            not a heading, and the shell's real H1 in index.html is hidden the
            moment React mounts -- so without this the rendered DOM would have
            no h1 at all for screen readers or for Google's post-JS snapshot.
            Text is kept identical to that shell H1; App.test.tsx pins it. */}
        <h1 className="sr-only">Teton Pass — live cams &amp; conditions</h1>

        <Header onReport={() => setReportOpen(true)} variant={isDesktop ? 'desktop' : 'phone'} />

        <StatusBanner data={data} direction={direction} />

        <div className="mt-2 flex flex-col gap-2">
          <div>
            <DriveTimes
              travelTimes={data.travelTimes}
              direction={direction}
              town={town}
              status={passStatus}
              onTownChange={setTown}
              onFlip={() => setDirection((d) => (d === 'eb' ? 'wb' : 'eb'))}
              variant={isDesktop ? 'desktop' : 'phone'}
            />
          </div>
          {(() => {
            // The home history teaser follows the first VISIBLE route
            // (handoff Interactions note): on desktop that's simply the
            // first route for this direction (DriveTimes shows both towns
            // unfiltered there, README §2); on phone it's the first route
            // matching both the direction and the Victor/Driggs picker,
            // since that's the town filter Home is actually applying.
            // Gated on the same status as DriveTimes above: this teaser is
            // "When should you leave?" over a drive-time chart, and rendering
            // it directly beneath a section that just explained why times
            // over the pass do not apply is the page contradicting itself in
            // consecutive elements. One concept -- no drive-time content
            // while we cannot say the road is drivable.
            if (passStatus === 'closed' || passStatus === 'unknown') return null;
            const historyRoute = data.travelTimes
              .filter((t) => t.slug.endsWith(`-${direction}`))
              .find((t) => isDesktop || idahoTownOf(t.slug) === town);
            return historyRoute ? (
              <div>
                <HomeHistoryCard slug={historyRoute.slug} routeName={historyRoute.name} />
              </div>
            ) : null;
          })()}
          <div>
            <AlertsStrip alerts={data.alerts} id33Advisory={data.id33Advisory} />
          </div>
          <div>
            <Cameras refreshedAt={refreshedAt} />
          </div>
          <div>
            <div className="mb-1 flex justify-end">
              <TempUnitToggle unit={unit} onChange={setUnit} />
            </div>
            <WeatherStrip
              weather={data.weather}
              surfaceCondition={data.surfaceCondition}
              weatherStale={data.weatherStale}
              unit={unit}
            />
            {/* `forecastStale` governs BOTH the hourly and 5-day rows below --
                one upstream fetch, one freshness signal, no second flag. It
                used to live inside ForecastStrip, below the hourly row, which
                meant an NWS outage captioned the 5-day section but left the
                hourly row showing a day-old model run with no caption at all.
                Hoisted here, above both strips, so a reader sees it once and
                it unambiguously applies to everything below it. Gated on
                there being anything to caption -- a bare "may be outdated"
                floating over two empty strips would be worse than saying
                nothing. */}
            {data.forecastStale && (data.hourly?.length || data.forecast?.length) ? (
              <p className="text-muted mb-1 text-[11px]">Forecast may be outdated</p>
            ) : null}
            <HourlyStrip hourly={data.hourly} unit={unit} />
            <ForecastStrip forecast={data.forecast} unit={unit} />
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
