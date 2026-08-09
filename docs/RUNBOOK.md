# Operations Runbook — tetonpasscam.com

This is the day-2 operations reference: deploying from scratch, verifying a
launch, and the routine maintenance tasks an operator (Drew, or whoever
inherits this) will need. For "what is this app and how is it built," see
`CLAUDE.md` and `TETONPASSCAM-SPEC.md` instead.

Everything in this document that touches a real Cloudflare account, a real
domain, or a real secret value requires credentials this repo's automation
does not have. Those steps are written out in full below so a human (or an
authorized agent given the credentials) can run them directly; see also
`docs/superpowers/sdd-handoff-deploy.md` for the condensed, copy-pasteable
provisioning command list.

---

## 1. Deploy from scratch

These steps provision the Cloudflare Worker + D1 database and go from "empty
Cloudflare account" to "tetonpasscam.com live." Run from the repo root.
Requires `wrangler login` (or `CLOUDFLARE_API_TOKEN`) with an authenticated
Cloudflare account first.

1. **Create the D1 database:**
   ```
   npx wrangler d1 create tetonpasscam
   ```
   This prints a `database_id`. Paste it into `wrangler.toml`'s
   `[[d1_databases]]` block, replacing the placeholder
   `00000000-0000-0000-0000-000000000000`.

2. **Apply migrations to the remote database:**
   ```
   npx wrangler d1 migrations apply tetonpasscam --remote
   ```
   This creates all tables (`routes`, `travel_times`, `status_snapshots`,
   `weather_snapshots`, `alerts`, `bans`, `feedback`, `id33_events`,
   `route_typicals`, `detour_snapshots`, `camera_errors`) per
   `migrations/0000_polite_blur.sql` and `migrations/0001_mysterious_masked_marvel.sql`.

   > **⚠️ Migrations are FROZEN once applied to remote D1.** The instant this
   > step has run against production, `0000_polite_blur.sql` and
   > `0001_mysterious_masked_marvel.sql` are permanent history — **never**
   > edit either file in place or regenerate them, even to fix a typo.
   > `wrangler d1 migrations apply` tracks which migration files it has
   > already run by name/hash in a `d1_migrations` table on the database
   > itself; editing an already-applied file desyncs that bookkeeping from
   > what's actually in the live schema, and re-running `db:generate` on top
   > of edited history can produce a migration wrangler thinks is already
   > applied when it isn't (or vice versa). **Every future schema change is a
   > new migration file**: edit `src/worker/db/schema.ts`, then run
   > `npm run db:generate` to emit `0002_*.sql` (etc.), then apply it the same
   > way as step 2 (`--local` while developing, `--remote` to ship it).

3. **Seed the 12 route rows remotely** (origin/destination lat-lng pairs for
   Victor/Driggs ↔ Jackson/Teton Village/Airport). There is no code path that
   calls `seedRoutes()` (`src/worker/db/seed-routes.ts`) in production — it's
   a one-off. `scripts/seed-routes.sql` is generated from that same `ROUTES`
   array (regenerate it if `seed-routes.ts`'s route list ever changes) and is
   idempotent (`INSERT OR IGNORE`, unique on `slug`):
   ```
   npx wrangler d1 execute tetonpasscam --remote --file=scripts/seed-routes.sql
   ```
   Verify: `npx wrangler d1 execute tetonpasscam --remote --command="SELECT count(*) FROM routes"`
   should return `12`.

4. **Set the four secrets** (Drew supplies the values; never commit them):
   ```
   npx wrangler secret put GOOGLE_ROUTES_KEY
   npx wrangler secret put IDAHO_511_KEY
   npx wrangler secret put RESEND_KEY
   npx wrangler secret put ADMIN_TOKEN
   ```
   Each prompts interactively for the value. `ADMIN_EMAIL` is not a secret —
   it's already set as a plaintext `[vars]` entry in `wrangler.toml`.

5. **Deploy:**
   ```
   npm run deploy
   ```
   (Runs `vite build` then `wrangler deploy`.) This uploads the Worker,
   including the cron triggers from `wrangler.toml`'s `[triggers]` block and
   the `[assets]` binding pointing at `dist/`.

6. **Attach the custom domain** (Cloudflare dashboard, Drew): Workers &
   Pages → tetonpasscam → Settings → Domains & Routes → add
   `tetonpasscam.com` (and `www.tetonpasscam.com` if desired, redirecting to
   the apex). This step has no CLI equivalent that doesn't also touch DNS,
   so it's done in the dashboard.

7. **Run the launch verification script** against the live domain:
   ```
   scripts/verify-launch.sh https://tetonpasscam.com
   ```
   See §2 below. Expect all checks to PASS before calling the launch done.

### Prerequisites this depends on (Drew owns; see the handoff doc for exact steps)

- Google Cloud project with Routes API enabled, a $200/mo billing alert, and
  an API-key restricted to server-side use (no HTTP referrer restriction —
  this key is never sent to a browser).
- A free Idaho 511 API key: register at `https://511.idaho.gov/my511/register`.
- A Resend account with `app.tetonpasscam.com` verified as a sending domain
  (see `src/worker/notify.ts` — mail is sent `from: alerts@app.tetonpasscam.com`,
  not the bare apex domain).
- `tetonpasscam.com` registered and its nameservers pointed at Cloudflare.

---

## 2. `scripts/verify-launch.sh`

Curl-based definition-of-done check. Run it against any base URL:

```
scripts/verify-launch.sh                              # defaults to https://tetonpasscam.com
scripts/verify-launch.sh http://localhost:8787         # against a local `wrangler dev`
scripts/verify-launch.sh https://tetonpasscam.com --skip-writes
```

Checks (each prints `PASS:`/`FAIL:`, script exits non-zero if any FAIL):

1. `GET /` returns 200 and contains the exact `<title>`, H1, and meta
   description text.
2. `GET /api/status` returns 200 with a JSON body that has a `status` field.
3. `POST /api/alerts` three times with the same `deviceId` — the first two
   return 201, the third returns 429 (device rate limit, 2 per 30 minutes;
   see `src/worker/api/alerts.ts`'s `DEVICE_RATE_LIMIT_MAX`). **This writes 2
   real alert rows** (clearly tagged `[verify-launch.sh test - ignore/delete
   via admin]` in the `note` field, with a `deviceId` prefixed
   `verify-launch-test-`) — delete them via the admin page
   (`/admin.html`) or `DELETE /api/admin/alerts/:id` after a production run.
   Pass `--skip-writes` to omit this check entirely for a
   production-cautious run (the device-rate-limit logic itself is already
   covered by the worker test suite, so skipping it here only means DoD
   doesn't re-verify it against the live deploy).
4. `GET /robots.txt` returns 200.
5. `GET /sitemap.xml` returns 200.
6. `GET /manifest.webmanifest` returns 200 (generated by `vite-plugin-pwa` at
   build time — only present after `npm run build`/`npm run deploy`, not in
   source).
7. `GET /privacy.html` returns 200 and contains the word "hashed".

**Local run recorded 2026-08-09** (against `wrangler dev` on
`http://localhost:8787`, after `npm run db:migrate:local` and `npm run
build`): all 13 checks PASS, exit code 0. See `.superpowers/sdd/2026-08-09-tetonpasscam-p1/task-17-report.md`
for the full transcript.

---

## 3. Kill-poller drill

Verifies the DoD requirement "killing the poller degrades the banner to
UNKNOWN" without waiting for an actual outage. This can't be fully automated
(it requires a real deploy without cron triggers, then waiting past the
dead-poller threshold), so it's a manual drill:

1. In `wrangler.toml`, comment out or remove the `[triggers]` block's
   `crons` line entirely (or set `crons = []`).
2. `npm run deploy` (deploys the Worker with no scheduled triggers — HTTP
   routes keep working, but nothing writes new `status_snapshots` rows).
3. Wait past `DEAD_HOURS` (2 hours — `src/worker/api/status.ts`'s
   `DEAD_HOURS` constant: the newest snapshot's age is compared against
   this to decide `pollerDead`).
4. `curl https://tetonpasscam.com/api/status | jq '.status, .pollerDead'`
   should show `"unknown"` and `true` — confirming the banner degrades
   safely rather than serving stale-but-confident data forever.
5. **Restore**: put the original `crons` entries back in `wrangler.toml`
   (from this repo's committed version) and `npm run deploy` again. Confirm
   `/api/status` resumes reporting a real status within one poll cycle
   (~10 minutes).

---

## 4. Rotating secrets

```
npx wrangler secret put GOOGLE_ROUTES_KEY
npx wrangler secret put IDAHO_511_KEY
npx wrangler secret put RESEND_KEY
npx wrangler secret put ADMIN_TOKEN
```

Each takes effect on the next Worker invocation — no redeploy needed.

> **⚠️ Rotating `ADMIN_TOKEN` has a side effect beyond the admin login.**
> `src/worker/api/alerts.ts`'s `hashIdentifier()` salts every device/IP hash
> with `env.ADMIN_TOKEN` (chosen in Task 10 so a leaked D1 dump alone can't
> be dictionary-reversed back to a real device ID or IP, without a second
> dedicated secret). This means rotating `ADMIN_TOKEN`:
> - Invalidates every **existing `bans` row** — a previously-banned
>   device/IP will no longer match, because its hash was computed under the
>   old salt. Bans effectively reset to empty on rotation.
> - Resets every device's/IP's **30-minute rate-limit window** — old
>   `alerts` rows' `device_hash`/`ip_hash` no longer match a freshly-hashed
>   current request, so the rate limiter starts counting from zero for
>   everyone.
>
> Neither is a security hole (a fresh salt is strictly more conservative —
> nothing new becomes over-permitted), but it does mean rotating this secret
> silently clears your abuse-mitigation state. If `ADMIN_TOKEN` rotation is
> ever automated or done routinely, split the hash salt into its own
> `HASH_SALT` secret instead so admin-token rotation and hash-salt rotation
> are independent (flagged as a known limitation in `alerts.ts`).

---

## 5. Reading poller logs

```
npx wrangler tail
```

Streams live logs from the deployed Worker, including `scheduled()`
invocations (the poller) and HTTP requests. Add `--format pretty` for
human-readable output, or filter with `--status error` to only see failures.
Poller-cycle errors surface here even though `runPollCycle`/`runNightly`
never throw into an uncaught rejection that would crash the Worker (see
`src/worker/poller/run.ts`) — each data source's fetch/parse is isolated so
one source failing (e.g. WYDOT HTML shape change) doesn't block the others.

---

## 6. Updating camera URLs

Camera image URLs live in `src/app/cameras.ts` (`CAMERAS` array — three
entries: `valley`, `east`, `west`). They currently point at Drew's own
DigitalOcean Spaces mirror of WYDOT's camera imagery
(`teton-flats-webcam.nyc3.cdn.digitaloceanspaces.com`), the same source
tetonflats.com's own webcam pages embed — **not** WYDOT's URLs directly.

**This is a dependency, not just a config value**: if the DO Spaces mirror
changes its bucket structure, path scheme, or goes away, these URLs break.
The `<img onerror>` fallback (link card + one `/api/camera-error` beacon per
session per camera — see `postCameraError` in
`src/worker/api/alerts.ts`) surfaces a broken camera to Drew via email, but
doesn't fix it. To update: edit the `url` field(s) in `CAMERAS`, rebuild,
redeploy. `id` and `caption` should stay stable unless the physical camera
changes what it points at.

---

## 7. Seasonal cadence change

The poll cadence is set by `wrangler.toml`'s `[triggers]` crons:

```toml
crons = ["*/10 11-23 * * *", "*/10 0-6 * * *", "0 7-10 * * *", "10 9 * * *"]
```

(Two entries split the 10-minute cadence across the UTC-midnight wraparound
Cloudflare cron syntax can't express as one range; the third and fourth
entries are the once-hourly overnight cadence and the nightly aggregation
job, respectively — see the comment above this block in `wrangler.toml`.)

To change cadence for a season (e.g. slower in summer when conditions are
more stable, faster during winter storm season): edit the `*/N` interval.
**Never go below 5 minutes** (`*/5 ...`) — this is a hard rule from the spec
(Idaho 511's throttle is 10 calls/60s and Google Routes billing scales with
call volume; see the design doc's poller-cadence math). After editing,
`npm run deploy` to push the new schedule — cron changes require a full
redeploy, there's no separate "just update the schedule" command.

---

## 8. D1 backup

Run monthly (or before any risky migration/rotation):

```
npx wrangler d1 export tetonpasscam --remote --output=~/tetonpasscam-backups/tetonpasscam-$(date +%Y%m%d).sql
```

The `--output` path above is deliberately **outside** this repo (adjust the
directory to wherever backups should actually live — a private bucket, a
password manager's file storage, etc.) — the dump contains real
user-submitted `feedback` text and hashed device/IP identifiers, so it must
never land inside a path that gets `git add`ed or committed. There's no
automated backup cron configured; this is a manual/scheduled-externally
task.

---

## 9. Lighthouse launch check

Run from any machine with Chrome installed (does not need repo access
beyond the URL):

```
npx lighthouse https://tetonpasscam.com --preset=perf --form-factor=mobile
```

Target: **Performance ≥ 90** (mobile). Also confirm PWA installability
manually (Lighthouse's dedicated PWA category was removed in newer Lighthouse
versions in favor of manual installability checks) — in Chrome DevTools,
Application → Manifest should show no errors, and Application →
Service Workers should show the registered worker with no errors, for
`https://tetonpasscam.com`.

---

## P2: Capacitor onboarding readiness

Task 17 verified (2026-08-09) that `src/app` contains **zero** references to
Node/SSR-only APIs that would block wrapping the app with Capacitor for
iOS/Android:

```
$ grep -rn "process\." src/app --include="*.ts" --include="*.tsx"
(no output)
$ grep -rn "\bfs\b" src/app --include="*.ts" --include="*.tsx"
(no output)
$ grep -rn "__dirname" src/app --include="*.ts" --include="*.tsx"
(no output)
$ grep -rn "require(" src/app --include="*.ts" --include="*.tsx"
(no output)
```

`npx cap init` was deliberately **not** run in P1 (per the spec, P2's first
task). When P2 starts:

1. `npx cap init tetonpasscam.com com.tetonpasscam.app` (or similar; final
   bundle id TBD).
2. `npx cap add ios` / `npx cap add android`.
3. `npx cap sync` after every `npm run build` to copy `dist/` into the
   native shells.
4. Push notifications (mentioned as P2-scope in the spec) are not
   implemented anywhere in this codebase yet — that's new work, not a sync
   step.

Nothing above should require touching `src/app`'s existing code — the app
was built framework-agnostic (no SSR, no direct DOM/window assumptions
beyond what a WebView also provides) specifically so this sync is close to
a no-op.
