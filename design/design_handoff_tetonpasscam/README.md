# Handoff: tetonpasscam.com — "Trailhead" design

## Overview
Visual design for tetonpasscam.com, a Teton Pass status utility (see `TETONPASSCAM-SPEC.md` for the full product spec and build prompt). Covers: Home (desktop light + phone dark + phone light), History, the Report-conditions modal, and Feedback. Direction chosen: **"Trailhead"** — warm, rounded, local-and-friendly.

## About the Design Files
`Teton Pass Cam.dc.html` is a **design reference created in HTML** — a static mockup document showing intended look and layout, not production code. It renders a canvas of option cards; the sections labeled **1a, 2a, 2b, 2c, 2d, 2e** are the chosen direction (ignore 1b and 1c — rejected explorations kept for history). Your task is to **recreate these designs in the app's stack** (React + Vite per the spec), using real data wiring per the spec's build prompt.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and copy are final intent — recreate pixel-close. Camera tiles are striped placeholders; replace with live WYDOT `<img>` elements (same aspect ratios) with the onerror fallback described in the spec.

## Which cards to build from
- **1a** — Home, phone, light, OPEN state (includes sticky bottom report button)
- **2a** — Home, desktop ≥1024px, light, OPEN state (two-column: content left, cameras right rail 380px)
- **2b** — Home, phone, dark mode
- **2c** — History screen, desktop (chart: today line vs typical p25–p75 band; route pill tabs; two summary tables)
- **2d** — Report modal (bottom sheet, 2-tap: type grid → direction → optional note → send)
- **2e** — Feedback form

Status banner has four states (spec §Home.1). Mocks show OPEN (green). For the other states reuse the same banner block with these fills:
- RESTRICTED: amber `oklch(0.62 0.13 60)`, headline "RESTRICTED — [restriction name]"
- CLOSED: red `oklch(0.50 0.17 25)`, headline "Closed — do not attempt" + legal copy + detour block (see 1c card for detour-block content structure)
- UNKNOWN: gray `#8a8072`, linked to Wyoming 511

## Design Tokens

### Color — light mode
- Page background: `#faf7f0`
- Text: `#2b2620` · Muted: `#8a8072` · Faint: `#b0a690`
- Card: `#fff`, border `#eae4d8`, radius 14px
- Status OPEN: `oklch(0.55 0.13 150)` (white text)
- Positive delta: `oklch(0.50 0.13 150)` · Negative delta: `oklch(0.55 0.15 30)`
- Accent (links, flip toggle): `oklch(0.55 0.13 60)`
- Sponsor card: bg `oklch(0.95 0.03 60)`, border `oklch(0.88 0.05 60)`, label `oklch(0.55 0.11 60)`
- Primary button: `#2b2620` bg, white text, fully rounded (999px)

### Color — dark mode
- Page background: `#211d17`
- Text: `#f0ebe1` · Muted: `#a39880` · Faint: `#6e6553`
- Card: `#2b2620`, border `#3a342b`
- Status OPEN: `oklch(0.45 0.11 150)`
- Positive delta: `oklch(0.72 0.12 150)` · Negative: `oklch(0.72 0.14 30)`
- Accent: `oklch(0.75 0.11 60)`
- Sponsor card: bg `oklch(0.30 0.03 60)`, border `oklch(0.38 0.04 60)`, label `oklch(0.75 0.09 60)`
- Primary button inverts: `#f0ebe1` bg, `#211d17` text

### Typography (Google Fonts)
- Display/headings/numerals/buttons: **Bricolage Grotesque**, weight 700–800, letter-spacing -0.01 to -0.02em
- Body/UI: **Atkinson Hyperlegible**, 400/700
- Scale: banner headline 40px phone / 46px desktop; drive-time numeral 22–24px 800; section heading 15–16px 700; body 13–14px; captions 10.5–12px
- Attribution/placeholder labels: ui-monospace 10–11px

### Spacing & shape
- Phone gutter 14px; desktop gutter 22–28px
- Card padding 12–16px; gap between cards 8px
- Radii: cards 14px, banner 16–18px, pills/buttons 999px, sponsor 14px
- Buttons min height ~48px (44px+ hit targets on mobile)

## Screens — key layout notes

### Home (phone: 1a/2b, desktop: 2a)
Order: header → status banner → drive times (3 rows, flip toggle) → community alerts ("From the road") → cameras (summit full-width 16:8, Wilson + state line half-width) → weather strip (air / road / gust / visibility) → sponsor card → footer links → sticky "⚠ Report conditions" pill (phone only; desktop puts it in the header).
Desktop is a 1fr + 380px grid: cameras stack in the right rail; drive times, alerts, weather, sponsor on the left.
Drive-time row: route name + sublabel left; big numeral + delta text right. Delta copy is verbal: "2 min faster than usual" / "about usual" / "8 min slower than usual" (hide delta until ≥2 weeks of history, per spec).
Banner always shows "Last confirmed open 5:48 AM · WYDOT" and standing advisories as a pill chip.

### History (2c)
Route pill tabs → chart card (SVG/canvas: today line in amber, typical median line green, p25–p75 band green at 16% alpha, "now" point annotated) → green takeaway callout ("The data says: …") → two half-width tables: "Worst days this season" and "Winter vs summer".

### Report modal (2d)
Bottom sheet over dimmed page, drag handle, title "What are you seeing?", 2-col type grid (Crash 💥, Slide-off 🛞, Slick/Ice ❄, Wildlife 🦌, Stopped traffic 🚗, Closure 🚧, Other full-width), selected = 2px `#2b2620` border; direction segmented pills (WB → Victor / EB → Jackson); optional 140-char note; "Send report" primary pill; fine print about not changing official status + rate limit.

### Feedback (2e)
Heading "Tell us what's broken (or what you'd love)", subline "Goes straight to a human in Teton Valley.", textarea, optional email, send pill.

## Interactions & Behavior
- Flip toggle reverses all three route directions at once.
- Alerts show type icon, direction, quoted note, age, and "Unverified community report" label; auto-expire per spec.
- Camera tiles link to Wyoming 511; onerror → "View on Wyoming 511" link card.
- Report flow: tap type → tap direction → send (note optional). Rate limits per spec.
- Dark mode: `prefers-color-scheme` aware with the dark token set above.
- All copy in the mocks is final-intent; status/legal copy rules in the spec are binding (never default to OPEN, no invented reopening estimates).

## State Management & Data
All data comes from the app's own API per the spec (`GET /api/status`, `/api/history`, `/api/alerts`, `POST /api/alerts`, `POST /api/feedback`). Numbers in the mocks are sample values.

## Assets
- No image assets — camera tiles are placeholders for live WYDOT imagery (attribute "Imagery: WYDOT Wyoming 511").
- Fonts from Google Fonts: Bricolage Grotesque, Atkinson Hyperlegible.
- Icons are emoji in the mocks; swap for a consistent icon set if preferred, keeping the friendly tone.

## Files
- `Teton Pass Cam.dc.html` — the design document (open in a browser; newest work at top; build from 1a, 2a–2e)
- `TETONPASSCAM-SPEC.md` — full product spec + backend build prompt
