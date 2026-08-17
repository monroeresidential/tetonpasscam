import type { ForecastHour } from '../../shared/types';
import { formatTemp, type TempUnit } from '../units';
import { glyphFor, precipGlyphFor } from '../weatherGlyphs';

/** Hour-of-day in America/Denver, so every viewer sees pass-local time
 *  rather than their own. `1 PM`, not `13:00` -- this sits beside `54°F`
 *  and `5.6 mph`, all of which are US-conventional. */
const HOUR_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  hour12: true,
});

export default function HourlyStrip({
  hourly,
  unit = 'F',
}: {
  // Declared non-optional on `ApiStatus`, but a payload rehydrated from
  // `localStorage['last-status']` (see useStatus.ts) is only as fresh as
  // the bundle that wrote it, and one written before this field existed has
  // no `hourly` key at all. Guarded here rather than at the call site so
  // every future consumer inherits the protection -- the same hazard that
  // blanked the home screen when `forecast` was added.
  hourly: ForecastHour[] | undefined;
  unit?: TempUnit;
}) {
  if (!hourly?.length) return null;

  return (
    <section aria-labelledby="hourly-heading" className="mt-4">
      <h2 id="hourly-heading" className="font-display text-[15px] font-bold">
        Next 12 hours
      </h2>
      {/* Scrolls rather than shrinks: twelve cards across a 360px phone is
          30px each, which is unreadable. `overflow-x-auto` keeps the scroll
          inside this container so the page itself never scrolls sideways. */}
      <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
        {hourly.map((h) => (
          <div
            key={h.startTime}
            data-testid="hour-card"
            // `grow shrink-0 basis-[62px]` (not `flex-1`, which is
            // `1 1 0%`): grows to fill the 960px desktop row, but never
            // shrinks below 62px on phone -- it overflows into the
            // existing horizontal scroll instead.
            //
            // `relative` is load-bearing, not decoration. Tailwind's
            // `sr-only` is `position: absolute`, and an absolutely
            // positioned box resolves against its nearest positioned
            // ancestor -- with none, that is the page. The off-screen cards'
            // sr-only spans were therefore laid out against the document,
            // escaping this strip's `overflow-x-auto` clipping and
            // extending `documentElement.scrollWidth` to 816px on a 360px
            // phone, so the WHOLE PAGE panned sideways. Making the card a
            // containing block confines them. Measured before/after:
            // docScrollWidth 816 -> 360, page pan yes -> no, strip scroll
            // yes -> yes.
            className="bg-card border-card-border rounded-card relative flex grow shrink-0 basis-[62px] flex-col items-center gap-1 border px-1 py-2 text-center"
          >
            <p className="text-muted text-[10.5px] uppercase">
              {HOUR_FORMAT.format(new Date(h.startTime))}
            </p>
            <div
              data-testid="glyph-tile"
              className="bg-icon-tile flex h-8 w-8 items-center justify-center rounded-[10px] text-[16px]"
            >
              {/* `aria-hidden` sits on the glyph itself (not the tile) so a
                  screen reader skips the emoji and reads only the sr-only
                  text beside it -- "Snow", not "snowflake emoji Snow". */}
              <span aria-hidden="true">{glyphFor(h.category, h.isDaytime)}</span>
              <span className="sr-only">{h.shortForecast ?? h.category}</span>
            </div>
            <p className="font-display text-[13px] font-extrabold">
              {h.tempF !== null ? formatTemp(h.tempF, unit) : '—'}
            </p>
            <p className="text-muted text-[10.5px] whitespace-nowrap">
              {h.precipPct !== null ? `${precipGlyphFor(h.category)} ${h.precipPct}%` : '—'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
