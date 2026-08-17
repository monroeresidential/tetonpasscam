export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_ROUTES_KEY: string;
  IDAHO_511_KEY: string;
  RESEND_KEY: string;
  ADMIN_TOKEN: string;
  ADMIN_EMAIL: string;
  /**
   * Cloudflare's `version_metadata` binding (see wrangler.toml). Supplies the
   * current deployment's id, which scopes the homepage cache key so a deploy
   * can never serve pre-deploy HTML — see `serveHomepage`.
   *
   * Optional because the binding does not exist in the vitest-pool-workers
   * runtime or under some local dev configurations; callers fall back to a
   * literal, which is correct there (no deploys happen mid-test).
   */
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
}
