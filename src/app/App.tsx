import StatusBanner from './components/StatusBanner';
import DriveTimes from './components/DriveTimes';
import WeatherStrip from './components/WeatherStrip';
import { useStatus } from './useStatus';

function App() {
  const { data, error } = useStatus();

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
    <main className="min-h-screen bg-white dark:bg-neutral-900">
      <h1 className="sr-only">Teton Pass Cam</h1>
      <StatusBanner data={data} />
      <DriveTimes travelTimes={data.travelTimes} />
      <WeatherStrip weather={data.weather} />
      {/* TODO (Task 15): community alerts strip */}
      {/* TODO (Task 15): camera strip (wilson/summit/stateline) */}
      {/* TODO (Task 15): report-conditions button + modal */}
      {/* TODO (Task 15): Teton Flats sponsor block */}
      {/* TODO (Task 15): footer (511 Notify link, feedback, history link) */}
    </main>
  );
}

export default App;
