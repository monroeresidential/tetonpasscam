import StatusBanner from './components/StatusBanner';
import DriveTimes from './components/DriveTimes';
import WeatherStrip from './components/WeatherStrip';
import AlertsStrip from './components/AlertsStrip';
import Cameras from './components/Cameras';
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

function App() {
  const { data, error, refreshedAt, refresh, offline, offlineSince } = useStatus();

  if (!data) {
    return (
      <main className="min-h-screen bg-white dark:bg-neutral-900 p-4">
        <p
          role="status"
          aria-live="polite"
          className="text-center text-neutral-500 dark:text-neutral-400"
        >
          {error ? 'Unable to load pass status. Retrying…' : 'Loading pass status…'}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white pb-24 dark:bg-neutral-900">
      {offline && (
        <div role="alert" className="w-full bg-red-800 p-3 text-center font-bold text-white">
          OFFLINE — showing last known status from{' '}
          {offlineSince ? OFFLINE_TIME_FORMAT.format(offlineSince) : 'an earlier visit'}
        </div>
      )}
      <StatusBanner data={data} />
      <DriveTimes travelTimes={data.travelTimes} />
      <AlertsStrip alerts={data.alerts} id33Advisory={data.id33Advisory} />
      <Cameras refreshedAt={refreshedAt} />
      <WeatherStrip weather={data.weather} />
      <ReportModal onSuccess={refresh} />
      <Sponsor />
      <Footer />
    </main>
  );
}

export default App;
