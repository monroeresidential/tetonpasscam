const SPONSOR_URL =
  'https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor';

export default function Sponsor() {
  return (
    <section aria-label="Sponsor" className="p-4">
      <div className="bg-sponsor-bg border-sponsor-border rounded-card border p-4">
        <p className="text-sponsor-label text-[10.5px] font-bold uppercase tracking-wide">
          Sponsored by{' '}
          <a href={SPONSOR_URL} className="underline">
            Teton Flats
          </a>
        </p>
        <p className="mt-1 text-sm">
          {' '}
          — modern 1 &amp; 2 bed apartments in Victor, 35 minutes from Jackson. Live here, check this
          page less.
        </p>
      </div>
    </section>
  );
}
