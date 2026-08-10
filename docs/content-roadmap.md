# Content roadmap — SEO expansion pages

Documented 2026-08-10 from the OpenSEO audit (261 credits; keyword data US/English, Google-derived monthly averages, difficulty 0–100). Drew-approved for **future implementation** — nothing here is scheduled; each page is a small build cycle when triggered. The single topic that covers nearly all winnable demand: **whether the pass is passable right now.**

**Seasonal deadline that shapes everything:** demand is ~11× higher in December than June (`teton pass camera`: Jul 390 → Oct 8,100 → Dec 18,100 → Feb 9,900). Static pages (§1–3) should publish by **early October 2026** so they're indexed and aged before the ramp. Data-driven pages (§4) publish when the data is credible, not by calendar.

## 1. Static content pages (no new data needed — build any time)

### /road-conditions — "What WYDOT's wording actually means"
Target: `teton pass road conditions` (1,000/mo, KD 1) + `teton pass road conditions today` (260/mo, KD 1) + `wy 22 road conditions today` (110/mo, KD 5).
Brief: a glossary/explainer of WYDOT's actual condition vocabulary as seen on this site — "slick in spots," "black ice," "no unnecessary travel," chain law levels, high-profile-vehicle closures — what each means legally and practically for a commuter. Embed the live status banner data (edge-injected like the homepage). Internal links: home, /closures, /weather. The parser's own captured vocabulary (test fixtures) is source material.

### /closures — "Why Teton Pass closes and what to do"
Target: `teton pass closure` (720/mo, KD 2) + `teton pass closed` (720/mo, KD 16) + `teton pass open or closed` (320/mo, KD 15).
Brief: why it closes (storm cycles, avalanche control near the summit, slide-offs on the 10% grades), typical closure durations (hours not days — link WYDOT's own historical closure stats, spec cites `wyoroad.info/api/histData` monthly PDFs as P2/P3 source), the legal reality (W.S. 24-1-109, up to $750 — never drive a closed pass), and the Swan Valley/Alpine detour via US-26/89 (~85 mi, ~1h40 in good conditions) with its live conditions (the poller already fetches detour data when closed). **This page earns links every time the pass shuts** — the audit's highest-leverage line. Publish before first closure of the season.

### /weather — "Summit weather vs. valley weather"
Target: `teton pass weather` (590/mo, KD 0).
Brief: the site already displays live RWIS summit readings; explain why the summit differs from Wilson and Victor (elevation ~8,431 ft, wind exposure, road-surface temp vs air temp and why surface matters for ice), embed the live weather strip data. Future enhancement pairs with the P2 forecast feature ([[p2-forecast-weathergov]] — api.weather.gov, free, no auth, researched).

## 2. Togwotee Pass expansion (same build, zero competition — DO LAST)
Target: `togwotee pass webcam` (2,900/mo, KD 0) + `togwotee pass weather` (1,300/mo, KD 0).
Same audience, same WYDOT data sources, same components. A /togwotee page (or subdomain/section) reusing the poller pattern against Togwotee's segment + cameras + RWIS station. Only after Teton Pass pages are ranking — the audit is explicit about sequencing. Requires: new WYDOT segment text match, camera feeds, RWIS station name; treat as a mini-P1.

## 3. Link outreach (human work, not a build)
Teton Valley & Jackson Hole chambers, Buckrail, JH News&Guide, Teton Valley News, Facebook commuter groups, r/JacksonHole. The /closures page is the natural link target during events. Owner: Drew.

## 4. Data-unlocked pages (Drew's directive: build as historic commute data accrues)

Data started accruing 2026-08-10 (~12:30 UTC). Thresholds are about credibility, not technology — the API and typicals pipeline already exist.

| Unlock | Data needed | Page |
|---|---|---|
| ~2 weeks (≈Aug 24) | 14 days travel_times | "vs typical" deltas appear automatically on existing drive-time rows (already gated in code — no build) |
| ~6–8 weeks (Oct) | Enough weekday/weekend × hour coverage | **History screen** (P2, design card 2c already drawn: today's line vs typical band, route tabs, worst-days + winter/summer tables; GET /api/history already serves the data) |
| ~3+ months (post-first-storms) | A season's worth incl. weather events | **"Best time to cross" page** — the spec's quotable asset ("the data says leave before 6:40"); commute patterns by hour/day, storm-day vs bluebird-day comparisons; media-linkable |
| Season+ (spring 2027) | Full winter | **Winter retrospective** — closure log (status_snapshots has every cycle), worst days ranked, correlation of closures with weather_snapshots readings |

## Notes for whichever session builds these
- Every new page: static-first HTML (the #seo-shell pattern), edge-injected live data where relevant, page-specific title/meta/OG, added to sitemap.xml, linked from the homepage shell links AND footer, FAQ schema only for visible content.
- Keyword list + volumes above are Aug 2026 snapshots; re-check with the keyword-research skill before writing.
- Discarded seed: `victor idaho to jackson wyoming drive` (tool returned garbage; don't re-chase).
