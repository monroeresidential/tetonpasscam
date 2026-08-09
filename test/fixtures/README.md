# Fixtures

## roadclosures-*.html

Source page: https://www.wyoroad.info/highway/conditions/RoadClosures.html

`roadclosures-open.html` is a live capture, taken 2026-08-09 (pass open,
standing "Falling Rock" advisory on the Wilson-Stateline segment), via:

```bash
curl -s -A "tetonpasscam.com poller (drew@monroeresidential.com)" \
  https://www.wyoroad.info/highway/conditions/RoadClosures.html > test/fixtures/roadclosures-open.html
```

The other three are hand-edited copies of that capture, each changing only
the cells needed to exercise one code path in
`src/worker/poller/wydot-status.ts`. All other rows (including the
`Between Jackson and Wilson` valley segment, used by the "valley segment not
matched" test) and the rowspan structure are left untouched.

- `roadclosures-closed.html` -- the `Between Wilson and the Idaho State
  Line` row's `*cond` cell changed from `Road Open` to
  `Road Closed due to winter conditions`.
- `roadclosures-restricted.html` -- same row's `*cond` cell left as
  `Road Open`; its `*restrict` cell changed from the standing weight-limit
  boilerplate to `Chain Law Level 1`.
- `roadclosures-mangled.html` -- the entire `<tr>...</tr>` block for the
  `Between Wilson and the Idaho State Line` row deleted, simulating a page
  reshape / scrape failure. Must parse to `unknown`, never `open`.

## routesresults-wy22*.html

Source page: https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=WY22

`routesresults-wy22.html` is a live capture, taken 2026-08-09 (pass open), via:

```bash
curl -s -A "tetonpasscam.com poller (drew@monroeresidential.com)" \
  "https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=WY22" > test/fixtures/routesresults-wy22.html
```

This page shares its `*cond` / `*impact` / `*restrict` / `rpttime` column
scheme with RoadClosures.html (confirmed via the page's own CSS legend, e.g.
`td.closedcond`, `td.noimpactrestrict`), but the segment `<td>` carries class
`closurelocation` (not classless as on RoadClosures), and -- materially
different from RoadClosures -- the `*cond` cell holds a raw surface-condition
report (e.g. `Dry`) rather than a `Road Open` / `Road Closed due to ...`
phrase. There is no "Road Open" phrase anywhere on this page to test for, so
`parseRoutesResults` treats any non-empty `*cond` text that does not contain
the word "closed" as open evidence (that page's equivalent of an explicit
open signal), and the literal word "closed" (e.g. `CLOSED`) as closed
evidence, per the brief's `closed ⟺ CLOSED in the Conditions column` rule.
The page also carries a single-row "District Comments" table (`class="region"`
/ `class="comments"`, same markup as Statewide's) with only a District 3 row
present in this capture.

`routesresults-wy22-closed.html` is a hand-edited copy: only the Wilson-
Stateline row's `*cond` cell text changed from `Dry` to `CLOSED`. Everything
else, including the generic CLOSED-legend row near the page footer (a
distractor with no `closurelocation` cell, must not be picked up as the data
row), is untouched.

## statewide*.html

Source page: https://www.wyoroad.info/pls/Browse/MEDIA.Statewide

`statewide.html` is a live capture, taken 2026-08-09 (pass open, only the
standing "Falling Rock" advisory active statewide), via:

```bash
curl -s -A "tetonpasscam.com poller (drew@monroeresidential.com)" \
  "https://www.wyoroad.info/pls/Browse/MEDIA.Statewide" > test/fixtures/statewide.html
```

Segments are NOT grouped under literal "Open"/"Closed" headings as an
earlier sketch assumed. Each `<table class="mediagrid">` group is headed by
`<th class="XXXtitle">ADVISORY OR EVENT NAME</th>` (e.g.
`<th class="modtitle">Falling Rock</th>`), where the class prefix
(`low`/`mod`/`high`/`extended`/`closed`) reuses the same impact-severity
scheme as RoadClosures/RoutesResults's `*cond`/`*impact` classes, and the
heading text names the specific advisory/event, not a generic status word.
The Wilson-Stateline segment's row in this capture reads exactly
`<td class="nw">Wilson</td><td class="nw">the Idaho State Line</td>`
(confirming the brief's "match on `Wilson` + `State Line`" instruction), and
in this live capture it only appears under the `modtitle` ("Falling Rock")
heading -- there is no live example of a `closedtitle` group to capture,
since the pass is open. `parseStatewide` maps a `closedtitle` match to
`closed`, a `low`/`mod`/`high`/`extended`-title match to `restricted` (an
active advisory is not proof of closure, so it cannot be reported as
`closed`; nor is it proof of `open`, so it cannot be reported as `open`
either -- `restricted` is the only value consistent with the safety
invariant that `open` requires explicit open evidence), and no match at all
to `unknown` per the brief. This also carries the same District Comments
table shape as RoutesResults, but with all five districts' rows present.

`statewide-closed.html` is a hand-edited copy: the Wilson-Stateline row is
moved out of the `modtitle` "Falling Rock" table into a new synthetic
`<table class="mediagrid">` headed `<th class="closedtitle">Winter Storm
Closure</th>`, since no live closedtitle example exists to capture. This
`closedtitle` class name is inferred (not directly observed) from the
confirmed `low/mod/high/extended/closed` + suffix convention already used by
`*cond`/`*impact`/`*restrict` classes elsewhere on wyoroad.info; see the
task report for this caveat.
