# Trailhead restyle — verification screenshots (2026-08-10)

Captured during the Trailhead restyle cycle's visual verification pass (Playwright against a locally seeded `wrangler dev` instance, merged at commit `1f48e79`). The seed data covered only 3 of 6 route-directions, so the drive-times list shows 3 rows here; production renders all routes with data.

| File | What it is |
|---|---|
| `1-phone-light.png` | Full home page, 390px, light |
| `1b-phone-light-viewport.png` | 390×844 viewport crop (shows the fixed report-pill overlap on first paint) |
| `2-phone-dark.png` | Full home page, 390px, dark (`prefers-color-scheme: dark`) |
| `3-desktop-light.png` | 1280px desktop — camera right rail, header report button + tagline |
| `4-report-sheet.png` | Report-conditions bottom sheet open (design card 2d) |
| `5-feedback-modal.png` | Feedback modal open (design card 2e) |
| `mock-*.png` | Renders of the design-handoff cards (1a, 2a, 2b, 2d, 2e) used for side-by-side comparison |

Design source of truth: `design/design_handoff_tetonpasscam/`. Open design judgment calls at time of capture: report-pill overlap on phone first paint, banner sub-line contrast (13px/opacity-90), visibility displayed in raw feet, wind average not displayed.
