const SPONSOR_URL =
  'https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor';

export default function Sponsor() {
  return (
    <section aria-label="Sponsor" className="border-t border-neutral-200 p-4 dark:border-neutral-700">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Sponsored by{' '}
        <a href={SPONSOR_URL} className="font-semibold underline">
          Teton Flats
        </a>{' '}
        — modern 1 &amp; 2 bed apartments in Victor, 35 minutes from Jackson. Live here, check this
        page less.
      </p>
    </section>
  );
}
