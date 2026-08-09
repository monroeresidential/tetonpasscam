import StatusBanner from './components/StatusBanner';
import DriveTimes from './components/DriveTimes';
import WeatherStrip from './components/WeatherStrip';
import AlertsStrip from './components/AlertsStrip';
import Cameras from './components/Cameras';
import ReportModal from './components/ReportModal';
import Sponsor from './components/Sponsor';
import Footer from './components/Footer';
import { useStatus } from './useStatus';

function App() {
  const { data, error, refreshedAt, refresh } = useStatus();

  if (!data) {
    return (
      <main className="min-h-screen bg-white dark:bg-neutral-900 p-4">
        <h1 className="sr-only">Teton Pass Cam</h1>
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
      <h1 className="sr-only">Teton Pass Cam</h1>
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
