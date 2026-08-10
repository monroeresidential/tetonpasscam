/**
 * Header time is deliberately *device* local time (no `timeZone` override,
 * unlike StatusBanner/DriveTimes which pin `America/Denver` for WYDOT report
 * timestamps) -- this is just a friendly clock, not sourced data. Two
 * `toLocaleString` calls concatenated with a space (rather than one
 * `Intl.DateTimeFormat` call with both `weekday` and `hour`/`minute`) because
 * `en-US` inserts a comma after the weekday when both are requested together
 * ("Sat, 6:12 AM"), which the design's "Sat 6:12 AM" copy doesn't have.
 */
function formatHeaderTime(now: Date): string {
  const weekday = now.toLocaleString('en-US', { weekday: 'short' });
  const time = now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${weekday} ${time}`;
}

export default function Header({
  onReport,
  variant = 'phone',
  now = new Date(),
}: {
  onReport: () => void;
  /**
   * Card 1a (phone) has no button in the header at all -- only the fixed
   * bottom pill (rendered by ReportModal). Card 2a (desktop) moves the
   * trigger up here instead. App decides which variant to pass based on a
   * real `matchMedia` breakpoint check (see `useIsDesktop` in App.tsx) rather
   * than rendering both and hiding one with CSS: jsdom applies no
   * stylesheet, so two simultaneously-present "Report conditions" buttons
   * would make any `getByRole('button', { name: /report conditions/i })`
   * query ambiguous. This prop is what lets Header.test.tsx exercise the
   * desktop rendering path directly without trying to fake a viewport width.
   */
  variant?: 'phone' | 'desktop';
  now?: Date;
}) {
  return (
    <header className="flex items-center justify-between gap-3 px-3.5 pt-4 pb-2.5 lg:px-7 lg:py-4">
      <div className="font-display text-[19px] font-extrabold tracking-tight text-ink lg:text-[21px]">
        Teton Pass Cam
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-muted lg:text-[12px]">
          {variant === 'desktop'
            ? `Live cams & conditions · ${formatHeaderTime(now)}`
            : formatHeaderTime(now)}
        </span>
        {variant === 'desktop' && (
          <button
            type="button"
            onClick={onReport}
            className="hidden rounded-full bg-btn-bg px-[18px] py-[9px] font-display text-[13px] font-bold text-btn-ink lg:inline-flex"
          >
            ⚠ Report conditions
          </button>
        )}
      </div>
    </header>
  );
}
