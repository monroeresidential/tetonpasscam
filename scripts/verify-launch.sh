#!/usr/bin/env bash
#
# Launch verification for tetonpasscam.com (Task 17 definition-of-done).
#
# Usage:
#   scripts/verify-launch.sh [base-url] [--skip-writes]
#
#   base-url       Defaults to https://tetonpasscam.com. Point it at a local
#                  `wrangler dev` origin (e.g. http://localhost:8787) to
#                  exercise this against a dev build.
#   --skip-writes  Omit the POST /api/alerts x3 -> 429 check. Use this for
#                  production-cautious runs: that check creates 2 real,
#                  publicly-visible alert rows (clearly note-tagged, but
#                  real) before the 3rd request is rejected. Safe to skip
#                  since it only exercises the device rate limiter, which is
#                  covered by the worker test suite.
#
# Exits non-zero if any check FAILs. Requires: curl. Uses jq if present for
# a stricter JSON check, otherwise falls back to a grep-based check.
set -u

BASE_URL="https://tetonpasscam.com"
SKIP_WRITES=0

for arg in "$@"; do
  case "$arg" in
    --skip-writes)
      SKIP_WRITES=1
      ;;
    -*)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
    *)
      BASE_URL="$arg"
      ;;
  esac
done

# Strip a trailing slash so `${BASE_URL}/path` never doubles up.
BASE_URL="${BASE_URL%/}"

# Applied to every curl call below so a dead/unreachable URL fails fast
# (curl's own defaults are to wait indefinitely) rather than hanging the
# script -- 10s to establish the connection, 30s total per request.
CURL_TIMEOUT_OPTS=(--connect-timeout 10 --max-time 30)

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

# Fetches a URL (following redirects) and prints "<status_code>\n<body>".
# Splits on the first newline; -L follows redirects since the real deploy
# may terminate at Cloudflare in front of a scheme/host redirect.
fetch() {
  local url="$1"
  curl -sS -L "${CURL_TIMEOUT_OPTS[@]}" -w '\n%{http_code}' "$url" 2>/dev/null
}

status_of() {
  # last line of the fetch() output is the status code
  tail -n 1
}

body_of() {
  # everything except the last line
  sed '$d'
}

echo "== verify-launch.sh against ${BASE_URL} =="
echo

# --- Check 1: GET / contains exact title, H1, and meta description ---------
INDEX_RAW="$(fetch "${BASE_URL}/")"
INDEX_STATUS="$(echo "$INDEX_RAW" | status_of)"
INDEX_BODY="$(echo "$INDEX_RAW" | body_of)"

if [ "$INDEX_STATUS" = "200" ]; then
  pass "GET / returned 200"
else
  fail "GET / returned ${INDEX_STATUS} (expected 200)"
fi

TITLE='Teton Pass Cam — Live Cameras, Conditions & Drive Times'
if echo "$INDEX_BODY" | grep -qF "$TITLE"; then
  pass "GET / contains exact <title> text"
else
  fail "GET / missing exact <title> text: ${TITLE}"
fi

H1='Teton Pass — live cams & conditions'
if echo "$INDEX_BODY" | grep -qF "$H1"; then
  pass "GET / contains exact H1 text"
else
  fail "GET / missing exact H1 text: ${H1}"
fi

META_DESC='Live Teton Pass cameras, WYDOT road conditions, summit weather, and real-time Victor–Jackson drive times. Is the pass open? Check before you cross.'
if echo "$INDEX_BODY" | grep -qF "$META_DESC"; then
  pass "GET / contains exact meta description text"
else
  fail "GET / missing exact meta description text"
fi

# --- Check 2: GET /api/status returns JSON with a `status` field -----------
STATUS_RAW="$(fetch "${BASE_URL}/api/status")"
STATUS_STATUS="$(echo "$STATUS_RAW" | status_of)"
STATUS_BODY="$(echo "$STATUS_RAW" | body_of)"

if [ "$STATUS_STATUS" = "200" ]; then
  pass "GET /api/status returned 200"
else
  fail "GET /api/status returned ${STATUS_STATUS} (expected 200)"
fi

if command -v jq >/dev/null 2>&1; then
  if echo "$STATUS_BODY" | jq -e 'has("status")' >/dev/null 2>&1; then
    pass "GET /api/status JSON has a \"status\" field"
  else
    fail "GET /api/status JSON missing a \"status\" field"
  fi
else
  if echo "$STATUS_BODY" | grep -qE '"status"[[:space:]]*:'; then
    pass "GET /api/status JSON has a \"status\" field (grep fallback, jq not installed)"
  else
    fail "GET /api/status JSON missing a \"status\" field"
  fi
fi

# --- Check 3: POST /api/alerts x3 same deviceId -> 3rd is 429 --------------
if [ "$SKIP_WRITES" = "1" ]; then
  echo "SKIP: POST /api/alerts rate-limit check (--skip-writes)"
else
  # Unique per invocation so re-running this script doesn't fall inside a
  # previous run's 30-minute rate-limit window and skew the result.
  DEVICE_ID="verify-launch-test-$(date +%s)-$$"
  ALERT_PAYLOAD='{"type":"other","deviceId":"'"${DEVICE_ID}"'","note":"[verify-launch.sh test - ignore/delete via admin]"}'

  post_alert() {
    curl -sS "${CURL_TIMEOUT_OPTS[@]}" -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/api/alerts" \
      -H 'Content-Type: application/json' \
      -d "$ALERT_PAYLOAD" 2>/dev/null
  }

  CODE1="$(post_alert)"
  CODE2="$(post_alert)"
  CODE3="$(post_alert)"

  echo "  (POST /api/alerts x3, deviceId=${DEVICE_ID}: ${CODE1}, ${CODE2}, ${CODE3})"

  if [ "$CODE1" = "201" ] && [ "$CODE2" = "201" ]; then
    pass "POST /api/alerts accepted requests 1 and 2 (201)"
  else
    fail "POST /api/alerts request 1/2 did not both return 201 (got ${CODE1}, ${CODE2})"
  fi

  if [ "$CODE3" = "429" ]; then
    pass "POST /api/alerts request 3 (same deviceId) returned 429"
  else
    fail "POST /api/alerts request 3 (same deviceId) returned ${CODE3} (expected 429)"
  fi
fi

# --- Check 4: GET /robots.txt returns 200 -----------------------------------
ROBOTS_STATUS="$(curl -sS -L "${CURL_TIMEOUT_OPTS[@]}" -o /dev/null -w '%{http_code}' "${BASE_URL}/robots.txt" 2>/dev/null)"
if [ "$ROBOTS_STATUS" = "200" ]; then
  pass "GET /robots.txt returned 200"
else
  fail "GET /robots.txt returned ${ROBOTS_STATUS} (expected 200)"
fi

# --- Check 5: GET /sitemap.xml returns 200 ----------------------------------
SITEMAP_STATUS="$(curl -sS -L "${CURL_TIMEOUT_OPTS[@]}" -o /dev/null -w '%{http_code}' "${BASE_URL}/sitemap.xml" 2>/dev/null)"
if [ "$SITEMAP_STATUS" = "200" ]; then
  pass "GET /sitemap.xml returned 200"
else
  fail "GET /sitemap.xml returned ${SITEMAP_STATUS} (expected 200)"
fi

# --- Check 6: GET /manifest.webmanifest returns 200 -------------------------
MANIFEST_STATUS="$(curl -sS -L "${CURL_TIMEOUT_OPTS[@]}" -o /dev/null -w '%{http_code}' "${BASE_URL}/manifest.webmanifest" 2>/dev/null)"
if [ "$MANIFEST_STATUS" = "200" ]; then
  pass "GET /manifest.webmanifest returned 200"
else
  fail "GET /manifest.webmanifest returned ${MANIFEST_STATUS} (expected 200)"
fi

# --- Check 7: GET /privacy.html returns 200 and contains "hashed" -----------
PRIVACY_RAW="$(fetch "${BASE_URL}/privacy.html")"
PRIVACY_STATUS="$(echo "$PRIVACY_RAW" | status_of)"
PRIVACY_BODY="$(echo "$PRIVACY_RAW" | body_of)"

if [ "$PRIVACY_STATUS" = "200" ]; then
  pass "GET /privacy.html returned 200"
else
  fail "GET /privacy.html returned ${PRIVACY_STATUS} (expected 200)"
fi

if echo "$PRIVACY_BODY" | grep -qi "hashed"; then
  pass "GET /privacy.html contains \"hashed\""
else
  fail "GET /privacy.html missing \"hashed\""
fi

# --- Check 8: GET /llms.txt returns 200 and starts with an H1 --------------
LLMS_RAW="$(fetch "${BASE_URL}/llms.txt")"
LLMS_STATUS="$(echo "$LLMS_RAW" | status_of)"
LLMS_BODY="$(echo "$LLMS_RAW" | body_of)"

if [ "$LLMS_STATUS" = "200" ]; then
  pass "GET /llms.txt returned 200"
else
  fail "GET /llms.txt returned ${LLMS_STATUS} (expected 200)"
fi

if echo "$LLMS_BODY" | head -n 1 | grep -q '^# '; then
  pass "GET /llms.txt body starts with \"# \""
else
  fail "GET /llms.txt body does not start with \"# \""
fi

# --- Summary -----------------------------------------------------------------
echo
echo "== ${PASS_COUNT} passed, ${FAIL_COUNT} failed =="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
