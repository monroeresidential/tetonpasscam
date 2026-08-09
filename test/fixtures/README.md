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
