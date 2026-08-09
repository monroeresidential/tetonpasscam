# tetonpasscam.com — Product Spec v2

Created Aug 9, 2026 (v1: static status page). v2 expands to: live Google-powered drive times, historic travel-time database, community alerts, feedback, and a single codebase that ships as web + iOS + Android.

## Strategy in one paragraph

The most-used searches for checking the pass are "teton pass camera / cameras / webcam" (5,400/mo each) and the open/closed family (~1,850/mo, winter-spiking). This product's job is to become the **daily habit**: the fastest answer to "can I cross, and how long will it take right now?" Sponsored by Teton Flats; the sponsor block markets the property to the exact audience (Jackson commuters). tetonflats.com/webcams remains the SEO asset; this is the utility/brand asset. Launch before November.

## Screens

### 1. Home (the one screen that matters)
1. **Status banner** — huge, four states (never a boolean): `OPEN` (green) / `RESTRICTED — [chain law / no unnecessary travel / no trailers / etc.]` (amber) / `CLOSED` (red) / `UNKNOWN — check Wyoming 511` (gray, linked). Always show WYDOT's last-report time ("last confirmed open 5:48 PM"). Staleness is surfaced independently of status: WYDOT updates every few hours in calm weather, so flag stale only past ~12h (tunable by season) rather than hiding status. **Never default to OPEN.** CLOSED copy must reflect that a Wyoming closure is a legal prohibition (W.S. 24-1-109: up to $750 fine / 30 days) — say "Closed — do not attempt", never "not recommended". No invented reopening estimates, ever.
2. **Live drive times** (Google Routes API, traffic-aware), each row showing current time vs. typical-for-now (from our own history DB): green/amber/red delta.
   - Victor → Jackson (Town Square)
   - Driggs → Jackson (Town Square)
   - Victor → Teton Village (JHMR)
   - *(confirm route set with Drew — "Jackson" = Town Square assumed; Teton Village included because winter workers/skiers head there, not downtown. Reverse directions shown with a flip toggle.)*
3. **Community alerts strip** — recent user reports (see Alerts), newest first, with age ("18 min ago") and type icon. Empty state: "No reports in the last 3 hours."
4. **The three WY-22 cams** — timestamped, captioned, linked to WYDOT, attributed "Imagery: WYDOT Wyoming 511."
5. **Summit weather strip** — air temp, road surface temp, wind gust/direction, visibility (WYDOT Teton Pass RWIS station).
6. **Report button** — persistent, thumb-reachable: "⚠ Report conditions" (see Alerts).
7. **Sponsor block** — "Sponsored by **Teton Flats** — modern 1 & 2 bed apartments in Victor, 35 minutes from Jackson. Live here, check this page less." → `https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor`
8. **Footer** — Wyoming 511, Idaho 511, START Teton Valley Commuter links; "Not affiliated with WYDOT"; privacy policy; feedback link.

### 2. History
- Chart: travel time by hour-of-day for each route — today's line overlaid on the historic typical band (median + p25–p75) for the same weekday/season.
- Secondary: "worst days" table, monthly pattern, winter vs summer comparison.
- This is the feature that makes the site quotable ("the data says leave before 6:40") and linkable by local media.

### 3. Report an alert (modal, 2 taps + optional note)
- Tap types (big buttons): `Crash` · `Slide-off` · `Slick/Ice` · `Wildlife` · `Stopped traffic` · `Closure` · `Other`
- Optional: free-text note (140 chars), direction (WB to Victor / EB to Jackson).
- No account required. Anti-abuse: per-device rate limit (e.g., 2 reports/30 min), IP throttle, profanity filter, honeypot field.
- Every alert displays as **"Unverified community report"** and auto-expires (crash/stopped: 2h; slick/wildlife: 3h; closure: until WYDOT confirms or 1h).
- **Hard rule:** community reports never change the official status banner. A user "closure" report shows in the alert strip with "unconfirmed — check 511"; only WYDOT data drives OPEN/CLOSED. (Trust + liability.)
- Admin: simple moderation view (delete, ban device/IP), email/push notification to Drew on each report initially.

### 4. Feedback (one form)
- Single text box + optional email. Writes to DB + emails Drew. That's it.

## Data pipeline

### Sources (verified live Aug 8–9, 2026; ordering per the Teton Pass monitoring brief)
| Priority | Data | Endpoint | Notes |
|---|---|---|---|
| **PRIMARY** | Open/closed | `https://www.wyoroad.info/highway/conditions/RoadClosures.html` (HTML) | Has an explicit **Closure Reason** column: literal `Road Open` when open — an unambiguous binary. Find the row containing the exact string `Between Wilson and the Idaho State Line` **by text match, never by cell index** (Route/Town cells use `rowspan`, so the pass row has fewer cells). `Between Jackson and Wilson` = valley segment, secondary. |
| Fallback | Conditions per segment | `https://www.wyoroad.info/pls/Browse/WRR.RoutesResults?SelectedRoute=WY22` (HTML) | No Closure Reason column; closed ⟺ `CLOSED` in the Conditions column. Same rowspan hazard. Also carries the District 3 comments block (surface WY22 comments in the UI). |
| Cross-check | Grouped statewide summary | `https://www.wyoroad.info/pls/Browse/MEDIA.Statewide` (HTML) | Groups segments under condition headings (structurally immune to rowspan/cell-order issues) — disagree between primary and fallback → consult this, still UNKNOWN if unresolved. |
| — | Summit weather | `https://www.wyoroad.info/pls/Browse/Sensors.StationResults?SelectedStation=Teton+Pass` (HTML) | Air/surface temp, wind, visibility, timestamp. Verified working despite the map feed being obfuscated. |
| — | Idaho approach (ID-33) | **Idaho 511 API** — `https://511.idaho.gov/api/v2/get/event?key=…&format=json` (free key: 511.idaho.gov/my511/register; throttle 10 calls/60s) | Real documented JSON API. Filter `RoadwayName` containing `33` near Victor (~43.62, −111.10); `IsFullClosure` is the money field. Secondary signal only — never the authority on the pass itself. |
| — | Cameras | Three WY-22 cam images (Wilson, summit, state line — same sources as tetonflats.com/webcams) | See camera caveat below. |
| — | Live drive times | **Google Routes API** (`computeRoutes`, `TRAFFIC_AWARE`) | Server-side only, on schedule. |
| — | Detour status (shown only when CLOSED) | `WRR.RoutesResults?SelectedRoute=US26` and `US89` | When the pass closes, everyone's next question is the Swan Valley/Alpine detour — answer it in place. |
| P2/P3 | Closure history | `https://www.wyoroad.info/api/histData/get/YYYY-MM` (monthly PDFs) + HistoricalInfo.html | WYDOT's own closure-frequency stats — feed the History screen's seasonal context. |
| P2/P3 | Forecast | `api.weather.gov` (documented free JSON) | Proper forecast integration for the weather strip. |

No public WYDOT JSON API exists — verified (server-rendered HTML, mod_plsql, no content negotiation; the `/api/` path serves historical PDFs only). **Do NOT build on the 511 map's protobuf feed** (`map.wyoroad.info/wti511map-data/Msg-*.pbf`): field names are obfuscated, strings XOR-encoded with a build-time key, filenames change on deploy — it breaks silently and is clearly not intended for third parties.

**Camera caveat:** the map feed delivers camera URLs via that protobuf, so automated URL discovery is fragile. tetonflats.com already embeds working WYDOT image URLs — reuse those, but treat them as breakable: verify each image loaded (onerror → swap to a "View on Wyoming 511" link card, and alert admin). Linking out is the durable fallback, embedding is the better UX while it works.

**Status parsing rules (from the brief, adopt verbatim):** open ⟺ Closure Reason == `Road Open`; closed ⟺ closure language present; chain law / no-unnecessary-travel / no-trailer / high-profile restrictions promote OPEN → RESTRICTED; anything else (fetch error, missing segment row, unrecognized shape) → UNKNOWN. `Falling Rock` has been a **standing advisory all summer 2026** — treat standing advisories as background state (display, don't alert); only alert on advisory *changes*.

### Polling & cost control
- One scheduled worker, **seasonal cadence:** every 15 minutes in summer, every 5–10 minutes in winter (Nov–Apr) — WYDOT's own refresh is 300s, so never faster than 5 min. Each run: fetch WYDOT primary (+ fallback on disagreement/failure) + weather → upsert `status`; fetch Routes API per route-direction → insert into `travel_times`; poll Idaho 511 events (respect its 10-calls/60s throttle — one call per cycle is plenty).
- 30s timeouts; retry 5xx with backoff, but **retry into UNKNOWN, never into OPEN**; always cache last-known-good state with its timestamp ("last confirmed open at 5:48 PM").
- **The browser/app only ever reads our own API** — never WYDOT or Google directly. One poller serves all users; cost is flat regardless of traffic.
- Routes API volume: 6 route-directions × 6/hr × 18h (05:00–23:00, skip overnight) ≈ 650 calls/day ≈ **~20k/month**. Check current Google pricing/free tier before launch (pricing changed to per-SKU free calls in 2025); dial to 15-min intervals (~13k/mo) or fewer overnight hours to fit budget/free tier. Budget assumption: $0–150/mo; a $200 cap alert in Google Cloud billing from day 1.
- User-Agent on WYDOT fetches: descriptive, with contact email.

### Database (any Postgres/SQLite-at-edge, e.g. Supabase, Neon, or Cloudflare D1)
```sql
routes(id, name, origin, destination, direction, polyline_cache)
travel_times(id, route_id, captured_at, duration_sec, static_duration_sec, distance_m, condition_snapshot)
status_snapshots(id, captured_at, segment, condition, advisories, restrictions, wydot_report_time, is_closed)
weather_snapshots(id, captured_at, air_f, surface_f, wind_avg, wind_gust, wind_dir, visibility_ft)
alerts(id, created_at, expires_at, type, note, direction, device_hash, ip_hash, status: active|expired|removed)
feedback(id, created_at, body, email_optional)
```
- `travel_times` is the historic-reporting asset: aggregate to typical-by-(route, weekday-class, hour, season) nightly for the History screen and the "vs typical" deltas.
- Retention: keep raw travel_times forever (it's small — ~20k rows/mo); snapshots 2 years; hash device/IP identifiers, no PII beyond optional feedback email.

## One codebase → web + App Store + Play Store

**Recommendation: web-first + Capacitor.**
- Build as a normal responsive web app (React + Vite to match the tetonflats.com toolchain; SSR not needed — this is an app, not a content site; keep the landing/SEO shell prerendered).
- **Capacitor** wraps the same build for iOS and Android; one repo, one UI, three targets. (Expo/React Native is the alternative but makes web the second-class citizen; this product is web-first.)
- PWA features regardless: installable, home-screen icon, offline shell showing last-known status with a big "stale" warning.
- Native adds via Capacitor plugins (these justify app-store presence): **push notifications** (pass closed/reopened — the killer feature), app icon badge, maybe widgets later.
- **App Store review warning:** Apple rejects thin website wrappers (guideline 4.2 minimum functionality). Ship the iOS app WITH push alerts and offline last-status from day one — that's the difference between "website in a box" (rejected) and a utility app (approved). Android/Play is lenient (TWA/Capacitor both fine).
- App-store requirements to prepare: privacy policy page (no accounts, anonymized reports, what's stored), support contact, screenshots. No login = no account-deletion requirement.

## SEO (light touch — utility, not content)

- Title: `Teton Pass Cam — Live Cameras, Conditions & Drive Times`
- Meta: `Live Teton Pass cameras, WYDOT road conditions, summit weather, real-time Victor and Driggs to Jackson drive times, and community alerts. Is the pass open? Check before you cross.`
- H1: `Teton Pass — live cams & conditions`
- FAQPage schema: "Is Teton Pass open right now?", "How long is the drive from Victor to Jackson?" (answer can honestly cite the historic median once data accrues — uniquely quotable).
- Prerendered shell with one 100–150-word explanatory paragraph; sitemap; indexable; GSC from day 1.
- Cross-links: footer → tetonflats.com (sponsor, UTM) and tetonflats.com/webcams; one mention back from /webcams. No link-network games.

## Pre-launch checklist (non-code)

1. Email WYDOT Traveler Information/511: introduce the site, polling cadence, imagery attribution; ask about official feeds.
2. Google Cloud project: enable Routes API, billing cap alert, restrict API key server-side.
2b. Register for a free Idaho 511 API key (511.idaho.gov/my511/register) — covers the ID-33 Victor approach.
2c. Subscribe Drew to WYDOT 511 Notify for WY-22 (one tier only — subscribing to both closure tiers duplicates messages) as an independent verification channel while the parser bakes in.
3. Register `tetonpasscams.com` (+ optionally `tetonpass.info`) → 301.
4. Privacy policy + "not affiliated with WYDOT" disclaimer drafted.
5. Apple Developer + Google Play accounts (lead time: Apple D-U-N-S/verification can take weeks — start now for a pre-November launch).
6. GSC + analytics (privacy-light).

## Measurement

- #1 repeat direct visitors / app opens (the habit metric), winter dailies.
- #2 UTM referrals to tetonflats.com + "how did you hear about us" at leasing.
- #3 push-notification opt-ins (owned audience).
- #4 GSC on "teton pass cam" family over 6–12 months.

## Phases

- **P1 (before November):** Home screen complete (status, live times with vs-typical once 2+ weeks of data, alerts, cams, weather, sponsor), DB + poller, web live at tetonpasscam.com, PWA installable.
- **P2:** iOS/Android via Capacitor with push closure alerts; History screen (needs a season of data to be honest — launch the screen when the chart isn't embarrassing).
- **P3:** widgets, Grand Targhee strip, winter-driving guide page linking tetonflats.com/victor-to-jackson-commute.

---

# BUILD PROMPT (paste into Claude Code where the app will be built)

Build **tetonpasscam.com**: a Teton Pass status web app (React + Vite, mobile-first, dark-mode aware) with a small backend, that will later wrap with Capacitor for iOS/Android — structure the repo accordingly (UI framework-agnostic core, no SSR dependencies in app code; a prerendered landing shell for SEO).

**Backend (scheduled worker + API + Postgres/D1):**
1. Scheduled worker (15-min cadence summer / 5–10-min winter, 05:00–23:00 America/Denver; hourly overnight):
   (a) **Status, PRIMARY:** fetch `https://www.wyoroad.info/highway/conditions/RoadClosures.html`; locate the `<tr>` containing the exact string `Between Wilson and the Idaho State Line` **by text search — never by cell index** (rowspan on Route/Town cells makes positional indexing silently wrong); status: `Road Open` in the Closure Reason column → OPEN; closure language → CLOSED; chain law / no unnecessary travel / no trailer / high-profile restrictions promote OPEN → RESTRICTED; fetch error, missing row, or unrecognized shape → UNKNOWN (never OPEN; retries also resolve to UNKNOWN). Parse `Last Report Time` as America/Denver; store staleness separately (flag > ~12h, tunable).
   (b) **Status, fallback + cross-check:** on failure or ambiguity, `WRR.RoutesResults?SelectedRoute=WY22` (closed ⟺ `CLOSED` in Conditions; same text-match rule; also capture District 3 comments mentioning WY22) and `MEDIA.Statewide` (which condition heading the Wilson→State Line segment appears under). Disagreement unresolved → UNKNOWN.
   (c) **Weather:** parse `Sensors.StationResults?SelectedStation=Teton+Pass` (air temp, surface temp, wind avg/gust/direction, visibility, timestamp).
   (d) **Drive times:** Google Routes API computeRoutes, TRAFFIC_AWARE, per configured route-direction: Victor↔Jackson Town Square, Driggs↔Jackson Town Square, Victor↔Teton Village (ASK ME to confirm routes and exact coordinates before hardcoding).
   (e) **Idaho approach:** Idaho 511 events API (I'll supply the free key; respect 10 calls/60s — one per cycle): filter RoadwayName containing "33" near Victor; store any `IsFullClosure` events as an ID-33 advisory (displayed separately; never affects the pass banner).
   (f) **When status is CLOSED:** also fetch `WRR.RoutesResults` for `US26` and `US89` and store detour-route conditions for display.
   Store everything per the spec schema (routes, travel_times, status_snapshots, weather_snapshots, alerts, feedback).
2. Descriptive User-Agent with contact email on WYDOT fetches; 30s timeouts. Google + Idaho keys server-side only, never shipped to clients. Do NOT integrate the 511 map's protobuf feed (`map.wyoroad.info/wti511map-data/*.pbf`) under any circumstances — it is obfuscated and changes on their deploys.
2b. Advisory handling: `Falling Rock` is a standing advisory on this segment — display standing advisories as background state; only generate alert-worthy events on advisory *changes*. Camera images: reuse the working WYDOT image URLs from the tetonflats.com repo, with onerror fallback to a "View on Wyoming 511" link card + admin alert (their URL scheme can change without notice).
3. Public API: GET /api/status (current status+weather+latest travel times+typical-for-now comparison), GET /api/history?route=, POST /api/alerts (rate-limited: 2/device/30min + IP throttle + honeypot + profanity filter), GET /api/alerts (active only), POST /api/feedback.
4. Nightly job: aggregate travel_times into typical-by-(route, weekday-class, hour, season) medians and p25/p75.
5. Failure behavior: if WYDOT parse fails or data >2h stale, status=UNKNOWN. Never report OPEN without fresh parsed data. Alerts NEVER alter official status.

**Frontend (one screen + modals):**
6. Status banner (OPEN green / RESTRICTED amber with the restriction named / CLOSED red / UNKNOWN gray with Wyoming 511 link), always showing WYDOT last-report time ("last confirmed open 5:48 PM"). CLOSED copy: "Closed — do not attempt. Traveling a closed Wyoming road is illegal (up to $750 fine)." Never display invented reopening estimates. When CLOSED, show the detour block (US-26/US-89 via Swan Valley–Alpine, ~85 mi / ~1h40 typical, current detour-route conditions from the poller). Also recommend WYDOT's own 511 Notify SMS/email alerts (511notify.wyoroad.info) in the footer as an infrastructure-independent backstop.
7. Drive-time rows with current vs typical delta (hide the delta until ≥2 weeks of history), direction flip toggle.
8. Community alerts strip: type icon, age, direction, note; label "Unverified community report"; auto-expiry per type (crash/stopped 2h, slick/wildlife 3h, closure 1h or until WYDOT confirms).
9. "⚠ Report conditions" persistent button → 2-tap modal (type grid: Crash, Slide-off, Slick/Ice, Wildlife, Stopped traffic, Closure, Other; optional 140-char note + direction). No accounts.
10. Three WY-22 cam images (pull exact image URLs from the tetonflats.com repo webcam pages), timestamped, linked to WYDOT, attributed "Imagery: WYDOT Wyoming 511".
11. Summit weather strip (surface temp prominent in winter).
12. Sponsor block linking `https://tetonflats.com/?utm_source=tetonpasscam&utm_medium=referral&utm_campaign=sponsor`.
13. Footer: Wyoming 511, Idaho 511, START bus, privacy policy, feedback form, "Not affiliated with WYDOT".
14. PWA: installable, offline shell shows last-known status with a prominent stale warning.
15. SEO shell: title `Teton Pass Cam — Live Cameras, Conditions & Drive Times`, meta + H1 + FAQPage schema per spec, 100–150-word explainer paragraph, sitemap.xml, robots allowing all.
16. Admin: minimal auth-protected moderation page (list/delete alerts, ban device hash); email notification to me on each alert and feedback at launch.

**Definition of done:** deployed page passes curl checks (title/H1/meta present in HTML); poller writes all four data types on schedule; kill the poller → banner degrades to UNKNOWN; POST /api/alerts rate-limits correctly; Lighthouse mobile ≥ 90; the same build runs `npx cap sync` cleanly for iOS/Android targets (push wiring can be P2, but the project must not block it).

Ask me before: finalizing route origins/destinations, choosing the hosting/DB vendor, and anything requiring paid account setup.
