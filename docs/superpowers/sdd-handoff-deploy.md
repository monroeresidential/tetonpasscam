# SDD Handoff: Deploy provisioning (Task 17)

Everything below requires a real Cloudflare account, a real Google Cloud
billing account, a real Resend account, and DNS control of
`tetonpasscam.com` — none of which the implementing agent has. This is the
exact, ordered command list for Drew (or an authorized agent given these
credentials) to run. See `docs/RUNBOOK.md` for the narrative version with
context on *why* each step exists; this document is the copy-pasteable
checklist.

Placeholders are written as `<ALL_CAPS_IN_ANGLE_BRACKETS>` — replace before
running.

---

## 0. Accounts to set up first (outside any terminal)

- [ ] **Google Cloud project** for the Routes API:
  1. Create/select a Google Cloud project.
  2. Enable the **Routes API**.
  3. **Set a $200/month billing budget alert** — Google Cloud Console →
     Billing → Budgets & alerts → Create budget → scope to this project,
     amount `$200`, alert thresholds at 50/90/100%. (Spec's own cost math:
     ~13-20k Routes API calls/month at the planned cadence; this alert is
     the safety net if the poller cadence or route count ever grows
     unexpectedly.)
  4. Create an API key, **restrict it to the Routes API only**, and do
     **not** apply an HTTP referrer restriction (this key is used
     server-side, from a Cloudflare Worker — a browser-referrer restriction
     would break it, since no browser ever calls Google directly per the
     "clients only read our own API" hard rule).
  5. Copy the key value — this becomes `GOOGLE_ROUTES_KEY` in step 5 below.

- [ ] **Idaho 511 API key** (free): register at
  `https://511.idaho.gov/my511/register`. Confirm the throttle you're given
  is 10 calls/60s (the poller is designed for one call per poll cycle, well
  under this). Copy the key — this becomes `IDAHO_511_KEY` below.

- [ ] **Resend account**: create an account at resend.com, verify
  `app.tetonpasscam.com` as a sending domain (NOT the bare apex
  `tetonpasscam.com` — `src/worker/notify.ts` sends `from:
  alerts@app.tetonpasscam.com`). This requires adding the DNS records Resend
  gives you (SPF/DKIM) to whichever DNS provider hosts `tetonpasscam.com`.
  Create an API key — this becomes `RESEND_KEY` below.

- [ ] **Cloudflare account**: sign up / log in, and either transfer
  `tetonpasscam.com`'s nameservers to Cloudflare or add it as a zone.

- [ ] **Pick an `ADMIN_TOKEN` value**: any long random string (e.g.
  `openssl rand -hex 32`). This gates `/api/admin/*` and `/admin.html` — keep
  it secret, it's not stored anywhere in this repo.

---

## 1. Authenticate wrangler

```
npx wrangler login
```

(Or set `CLOUDFLARE_API_TOKEN` in the environment for non-interactive use.)
Verify with:

```
npx wrangler whoami
```

---

## 2. Create the D1 database

```
npx wrangler d1 create tetonpasscam
```

Copy the printed `database_id` and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "tetonpasscam"
database_id = "<PASTE_REAL_DATABASE_ID_HERE>"   # replaces 00000000-0000-0000-0000-000000000000
```

Commit this change (`wrangler.toml`'s `database_id` is not a secret — it's
just an identifier, safe to commit).

---

## 3. Apply migrations to the remote database

```
npx wrangler d1 migrations apply tetonpasscam --remote
```

Expected: both `0000_polite_blur.sql` and `0001_mysterious_masked_marvel.sql`
report ✅.

---

## 4. Seed the 12 route rows

```
npx wrangler d1 execute tetonpasscam --remote --file=scripts/seed-routes.sql
```

Verify:

```
npx wrangler d1 execute tetonpasscam --remote --command="SELECT count(*) FROM routes"
```

Expect `12`.

---

## 5. Set the four secrets

Run each and paste the corresponding value when prompted (values from step
0 above):

```
npx wrangler secret put GOOGLE_ROUTES_KEY
npx wrangler secret put IDAHO_511_KEY
npx wrangler secret put RESEND_KEY
npx wrangler secret put ADMIN_TOKEN
```

---

## 6. Deploy

```
npm run deploy
```

---

## 7. Attach the custom domain (Cloudflare dashboard — no CLI equivalent)

Cloudflare dashboard → Workers & Pages → `tetonpasscam` → Settings →
Domains & Routes → Add → `tetonpasscam.com` (and `www.tetonpasscam.com` if
you want a `www` redirect to the apex — configure that redirect separately
in Cloudflare Rules if so).

---

## 8. Verify

```
scripts/verify-launch.sh https://tetonpasscam.com
```

All checks should PASS. This creates 2 real (clearly-tagged) alert rows as
part of the rate-limit check — delete them from `/admin.html` afterward, or
re-run with `--skip-writes` to avoid creating them at all.

---

## 9. Post-launch

- [ ] Run the Lighthouse check (`docs/RUNBOOK.md` §9) and confirm mobile
  performance ≥ 90.
- [ ] Confirm the poller is actually writing: wait ~10-15 minutes, then
  `curl https://tetonpasscam.com/api/status | jq '.pollerDead, .wydotReportTime, .weather, .travelTimes'`
  — `pollerDead` should be `false` and the other fields populated.
- [ ] Bookmark `npx wrangler tail` for the first few days of live traffic to
  watch for parser-shape drift or rate-limit surprises.
- [ ] Set a calendar reminder for the monthly D1 backup (`docs/RUNBOOK.md` §8) —
  it isn't automated.

---

## Known placeholders still in the repo at handoff time

| File | Placeholder | Unblocked by |
|---|---|---|
| `wrangler.toml` | `database_id = "00000000-0000-0000-0000-000000000000"` | Step 2 above |
| `src/app/cameras.ts` | Camera image URLs (Drew's DO Spaces mirror, already live — not a placeholder needing action, but flagged since it's an external dependency outside this repo's control; see `docs/RUNBOOK.md` §6) | N/A — already functional, just fragile |
