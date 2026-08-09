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
phrase, so there's no fixed "open" phrase to test for here.

Unlike RoadClosures, where every one of the ~80 rows uses the same constant
class `noimpactcond` regardless of actual status (so the class itself
carries no information there), this page's own CSS legend declares distinct
`closedcond` / `lowimpactcond` / `modimpactcond` / `highimpactcond` /
`extendedcond` classes for the `*cond` column, and our live capture uses
`lowimpactcond` (not the RoadClosures-constant value) for a `Dry` report --
i.e. the class genuinely varies here. `parseRoutesResults` therefore
classifies on that class (`closedcond` -> closed; the other four,
low/mod/high/extendedcond, plus `noimpactcond` included defensively from
RoadClosures' shared taxonomy -> open/restricted), the same way
`parseStatewide` classifies on heading class rather than heading text --
this is immune to closure prose varying ("CLOSED", "Road Closed due to
winter conditions", "Closure due to Avalanche Control" all carry the same
`closedcond` class), where an earlier revision of this parser matched only
the literal word "closed" in the cell's text and so misclassified
"Closure ..." wording as open. The page also carries a single-row "District
Comments" table (`class="region"` / `class="comments"`, same markup as
Statewide's) with only a District 3 row present in this capture.

`routesresults-wy22-closed.html` is a hand-edited copy: the Wilson-
Stateline row's `*cond` cell changed from `class="lowimpactcond"` / `Dry`
to `class="closedcond"` / `CLOSED due to Avalanche Control` -- both the
class AND the text, so the fixture exercises the real closedcond shape
(a closure-carrying class alongside realistic non-"CLOSED"-literal closure
prose), not just a text substitution that happened to still say "closed".
Everything else, including the generic CLOSED-legend row near the page
footer (a distractor with no `closurelocation` cell, must not be picked up
as the data row), is untouched.

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
Closure</th>`, since no live closedtitle example exists to capture. The
`closedtitle` class name itself is **verified**, not inferred: it's declared
as `.mediagrid th.closedtitle` in WYDOT's public stylesheet at
https://www.wyoroad.info/css/body2.css (an externally linked stylesheet,
which is why a single page capture alone couldn't show it). That same
stylesheet does not declare a `.lowtitle` rule, so `parseStatewide`'s 'low'
branch is believed dead in practice; it's kept defensively rather than
dropped (see the code comment in `wydot-status.ts`).

## sensors-tetonpass*.html

Source page: https://www.wyoroad.info/pls/Browse/Sensors.StationResults?SelectedStation=Teton+Pass

`sensors-tetonpass.html` is a live capture, taken 2026-08-09, 11:10 AM
Denver-local (air 70°F, surface 95°F, wind average 1.9 mph, wind gust
6.2 mph, wind direction SW, visibility 6562 ft), via:

```bash
curl -s -A "tetonpasscam.com poller (drew@monroeresidential.com)" \
  "https://www.wyoroad.info/pls/Browse/Sensors.StationResults?SelectedStation=Teton+Pass" > test/fixtures/sensors-tetonpass.html
```

Unlike RoadClosures/RoutesResults/Statewide, this page has no CSS-class
taxonomy at all: it's one plain two-column `<table>`, one `<tr>` per sensor,
with a bare `<td>Label</td>` / `<td>Value</td>` pair (each wrapped in a
`<font size="-1">` tag, occasionally with a `bgcolor` banding attribute).
Confirmed real labels (verbatim): "Air temperature", "Relative humidity"
(unused by `WeatherReading`), "Dew point" (unused), "Visibility", "Surface
temperature", "Wind gust", "Wind average", "Wind direction". There is
exactly one row per label in this capture -- no duplicate/multiple sensor
groups, despite the brief's defensive warning about e.g. two surface
sensors. Every value cell reports the US unit first with the metric
conversion following in parens (e.g. `70&#176F (21&#176C)`,
`6.2 mph (10.0 km/h)`), so `parseSensorPage` takes the first number in the
cell's text. Visibility is already reported in feet on this page
(`6562 ft (2000 m)`), so `extractVisibilityFt` is a passthrough for the
live shape here; it also detects a standalone "mi" vs "ft" unit token in
the cell text and converts miles -> feet (x5280) if a page reshape ever
reports visibility in miles instead, since `visibilityFt` is a typed feet
contract that must never silently store a mile value 5280x too small
(covered by a synthetic-HTML-string test in `weather.test.ts`, no fixture
file needed since no live "mi" example exists to capture).
The report timestamp (`Aug 9, 2026, 11:10 AM`) sits as plain text before
the table, not in any cell, in the same Denver-local no-explicit-TZ format
RoadClosures/RoutesResults's "Last Report Time" uses, so it reuses
`denverToUtcIso` from `wydot-status.ts` rather than duplicating that logic.

A gotcha this capture revealed: every real value `<td>` is immediately
preceded by a commented-out `<!--<td>...</td>-->` holding a *different,
stale* example reading for that same sensor (e.g. `<!--...25°F...-->`
right before the real `70°F` air-temperature cell) -- apparently a template
leftover WYDOT never strips from the served page. `parseSensorPage` strips
HTML comments before extracting any row/cell, so it can't accidentally
prefer the stale commented value over the real one.

`sensors-tetonpass-blank-air.html` is a hand-edited copy: only the Air
temperature row's real value cell content changed from
`70&#176F (21&#176C)` to empty (`<font size="-1"></font>`), simulating a
single sensor going offline/blank. Everything else, including that row's
stale commented-out `<!--...25°F...-->` value (which must NOT be picked up
as a fallback), is untouched. Exercises the "an individual missing sensor
value comes back as a null field without failing the rest of the reading"
contract: `airF` is `null`, every other field on this fixture still parses
normally.
