/**
 * An executable statement of the assumptions `parseRoadClosures` and
 * `parseRoutesResults` make about WYDOT's table markup.
 *
 * Deliberately NOT a parser and deliberately not in `src/`: it extracts no
 * status and makes no judgement about the road. It answers one question --
 * "is this page still shaped the way our parsers believe it is?" -- across
 * every row on the page, not just the Wilson-Stateline one. Checking every
 * row is what gives it teeth: our own segment is open the overwhelming
 * majority of the time, so the closed-row shape is only ever observable on
 * OTHER Wyoming segments.
 *
 * Used two ways:
 *   - offline, against committed captures (test/parsers/row-shape-contract.test.ts),
 *     which guards our code against regressions;
 *   - online, against the live pages (test/contract/wydot-live.test.ts,
 *     `npm run test:contract`), which is the only thing that can catch WYDOT
 *     changing the markup underneath us -- the failure mode that produced the
 *     2026-08-18 incident and that no fixture test can ever see.
 */

/** Every `*cond` class we have ever observed, from live captures and from
 *  WYDOT's own published CSS legend. `parseRoutesResults` classifies on this
 *  class, so a class outside this set silently resolves to 'unknown' -- which
 *  is safe but blind. An addition here is a deliberate act: decide whether
 *  the new severity means closed or passable, and update
 *  ROUTESRESULTS_CLOSED_COND_CLASSES / ROUTESRESULTS_OPEN_COND_CLASSES to
 *  match, rather than just widening this list to make a test go green. */
export const KNOWN_COND_CLASSES = new Set([
  'noimpactcond',
  'lowimpactcond',
  'modimpactcond',
  'highimpactcond',
  'extendedcond',
  'closedcond',
]);

export interface RowShapeReport {
  /** Human-readable contract breaches. Empty means the page is shaped the way
   *  the parsers assume. */
  violations: string[];
  /** Rows in the open shape: `*cond` with colspan 1, plus *impact and
   *  *restrict cells. */
  openShapeRows: number;
  /** Rows in the merged/elevated shape: `*cond` spanning >= 2 columns, with
   *  no *impact or *restrict cells. This is the count that is zero whenever
   *  no Wyoming road happens to be closed -- see `mergedShapeRows` handling in
   *  the live contract test, which reports rather than asserts on it. */
  mergedShapeRows: number;
  /** Distinct `*cond` classes seen, for reporting. */
  condClasses: string[];
}

interface Cell {
  className: string;
  colspan: number;
}

/** Cells of one row, in order, with their colspan. Mirrors the parser's own
 *  `extractClassCells` (class must be purely alphabetic; attributes after the
 *  class are tolerated) so the contract is checked against the same view of
 *  the markup the parser gets. */
function cellsOf(rowBlock: string): Cell[] {
  const cells: Cell[] = [];
  const rx = /<td\s+class="([a-zA-Z]+)"([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(rowBlock)) !== null) {
    const colspanMatch = /colspan="(\d+)"/i.exec(m[2]);
    cells.push({
      className: m[1].toLowerCase(),
      colspan: colspanMatch ? Number(colspanMatch[1]) : 1,
    });
  }
  return cells;
}

const isCond = (c: Cell) => /cond$/.test(c.className);
const isImpact = (c: Cell) => /impact$/.test(c.className) && !/restrict$/.test(c.className);
const isRestrict = (c: Cell) => /restrict$/.test(c.className);

/**
 * Check a RoadClosures.html or WRR.RoutesResults page against the shape
 * contract. Never throws: a malformed or unexpected page yields violations,
 * which is the point.
 */
export function checkRowShapes(html: string): RowShapeReport {
  const violations: string[] = [];
  const condClasses = new Set<string>();
  let openShapeRows = 0;
  let mergedShapeRows = 0;
  let dataRows = 0;

  for (const rowBlock of html.split(/<tr[\s>]/i)) {
    const cells = cellsOf(rowBlock);
    const cond = cells.find(isCond);
    // A block with no *cond cell is not a data row (page chrome, legends,
    // District Comments). Only rows that claim to report a condition are held
    // to the contract.
    if (!cond) continue;
    dataRows++;
    condClasses.add(cond.className);

    // (2) A severity class we do not know about.
    if (!KNOWN_COND_CLASSES.has(cond.className)) {
      violations.push(
        `unknown *cond class "${cond.className}" -- decide whether it means closed or passable before widening the parser`,
      );
    }

    // (1) The location invariant both parsers rely on.
    if (!cells.some((c) => c.className === 'rpttime')) {
      violations.push(`row with *cond "${cond.className}" has no rpttime cell`);
    }

    // (3) The colspan <-> cell-set relation, the clause that broke in 2026-08.
    const hasImpact = cells.some(isImpact);
    const hasRestrict = cells.some(isRestrict);
    if (cond.colspan >= 2) {
      mergedShapeRows++;
      if (hasImpact || hasRestrict) {
        violations.push(
          `merged row (*cond "${cond.className}" colspan=${cond.colspan}) unexpectedly still carries ` +
            `${hasImpact ? 'an *impact' : ''}${hasImpact && hasRestrict ? ' and ' : ''}${hasRestrict ? 'a *restrict' : ''} cell`,
        );
      }
    } else {
      openShapeRows++;
      if (!hasImpact || !hasRestrict) {
        violations.push(
          `unmerged row (*cond "${cond.className}" colspan=1) is missing ` +
            `${!hasImpact ? 'its *impact' : ''}${!hasImpact && !hasRestrict ? ' and ' : ''}${!hasRestrict ? 'its *restrict' : ''} cell`,
        );
      }
    }
  }

  // A page with nothing to check is a failure, not a pass. Without this, an
  // error page, a WAF challenge or an empty body reports a clean contract --
  // exactly the false reassurance this whole file exists to prevent.
  if (dataRows === 0) {
    violations.push('no data rows found at all -- page is empty, blocked, or completely reshaped');
  }

  return {
    violations,
    openShapeRows,
    mergedShapeRows,
    condClasses: [...condClasses].sort(),
  };
}
