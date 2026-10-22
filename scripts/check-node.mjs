#!/usr/bin/env node
/**
 * Build-time Node version guard.
 *
 * Runs as `prebuild` (so every `npm run build`, `npm run dev` and
 * `npm run deploy` goes through it) and prints the real Node version into
 * the build log, then exits non-zero if that Node is missing the
 * October 21, 2026 Node.js security release (CVE-2026-111497 Brotli RCE,
 * CVE-2026-106069 / CVE-2026-105483 TLS hostname bypasses, and the rest of
 * that batch) or the eMudhra/emSign CA distrust that shipped with it.
 *
 * Production runs on Cloudflare's workerd, not Node, so this guards the
 * toolchain (vite, wrangler, vitest, npm) -- which is what fetches from the
 * registry and talks to the Cloudflare API with Drew's credentials.
 *
 * Policy: 22.x >= 22.23.4, 24.x >= 24.22.1, 26.x >= 26.12.1. Odd majors
 * (23, 25, 27) and anything <= 20 are never acceptable. Keep in sync with
 * .nvmrc / .node-version / package.json "engines".
 */
import { pathToFileURL } from 'node:url';

export const MIN_PATCHED = Object.freeze({
  22: '22.23.4',
  24: '24.22.1',
  26: '26.12.1',
});

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * @param {string} version e.g. process.version ("v26.12.1")
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkNodeVersion(version) {
  const got = parse(version);
  if (!got) return { ok: false, reason: `unparseable Node version "${version}"` };
  const min = MIN_PATCHED[got[0]];
  if (!min) {
    const supported = Object.values(MIN_PATCHED).join(', ');
    return {
      ok: false,
      reason: `Node ${got[0]}.x is not an accepted line here (odd-numbered and <=20 lines are unpatched); use one of ${supported}+`,
    };
  }
  if (cmp(got, parse(min)) < 0) {
    return {
      ok: false,
      reason: `Node ${version} predates the October 2026 security release; ${got[0]}.x needs >= ${min}`,
    };
  }
  return { ok: true, reason: `Node ${version} >= ${min} (patched)` };
}

function main() {
  const { ok, reason } = checkNodeVersion(process.version);
  const tag = ok ? 'OK ' : 'FAIL';
  console.log(`[check-node] ${tag} process.version=${process.version} ${process.platform}/${process.arch} -- ${reason}`);
  if (!ok) {
    console.error('[check-node] Refusing to build on an unpatched Node. Install 26.12.1 (see .nvmrc) or set NODE_VERSION in the Cloudflare build settings.');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
