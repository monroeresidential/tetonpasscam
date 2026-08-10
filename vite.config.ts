import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Vite's default multi-page output mirrors each HTML entry's path relative
 *  to `root` -- so `src/app/admin.html` lands at `dist/src/app/admin.html`
 *  instead of the `dist/admin.html` the worker needs to serve at
 *  `/admin.html`. HTML entries are written straight to disk by Vite's own
 *  build-html plugin rather than tracked in the Rollup `bundle` object
 *  (confirmed empirically -- `generateBundle` only sees the JS/CSS assets),
 *  so the fix has to run after files hit disk: `writeBundle` moves the file
 *  once the real build finishes. Safe because `admin.html` has no relative
 *  asset references of its own (inline `<style>`/`<script>` only, no bundled
 *  JS/CSS) -- nothing else in the output points at its old path, so moving
 *  it doesn't break any reference. */
function flattenAdminHtml() {
  return {
    name: 'flatten-admin-html',
    apply: 'build' as const,
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? path.resolve(dirname, 'dist');
      const from = path.join(outDir, 'src', 'app', 'admin.html');
      const to = path.join(outDir, 'admin.html');
      if (!fs.existsSync(from)) return;
      fs.renameSync(from, to);
      // Clean up the now-empty src/app/ and src/ directories this leaves
      // behind in dist -- best-effort; rmdirSync throws if non-empty, which
      // just means something else is using that path and it's left alone.
      for (const dir of [path.join(outDir, 'src', 'app'), path.join(outDir, 'src')]) {
        try {
          fs.rmdirSync(dir);
        } catch {
          // non-empty or already gone -- nothing to do
        }
      }
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [
    react(),
    tailwindcss(),
    flattenAdminHtml(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'robots.txt'],
      manifest: {
        name: 'Teton Pass Cam',
        short_name: 'PassCam',
        description: 'Live Teton Pass cameras, WYDOT conditions, weather, and drive times.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Cream for both the OS chrome accent and the splash-screen
        // background (LH T5, Drew/controller-approved): the manifest has no
        // media-query mechanism, so a single static theme_color has to pick
        // a side, and cream matches both the splash background below and
        // the majority of installs (light-mode default). Dark-mode adaptive
        // chrome for the non-installed/browser-tab case is still handled by
        // index.html's media-scoped <meta name="theme-color"> pair -- this
        // manifest value only affects the installed-app chrome/splash.
        theme_color: '#faf7f0',
        background_color: '#faf7f0',
        // Icon set from design/logo-4c/ (route-22 mark): "any" variants are
        // the rounded plate on transparency, "maskable" variants keep the
        // art in an 80% safe zone for OS icon masks. Regenerate by
        // re-copying from design/logo-4c/ if the brand kit changes.
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell only -- built JS/CSS, the HTML entry, the
        // generated icons, the manifest itself, and (restyle Task 1) the
        // self-hosted woff2 font files the shell's CSS now depends on for
        // its type. `woff2` only, not `woff`: @fontsource ships a `.woff`
        // fallback per weight for non-woff2 browsers, but every browser
        // capable of running this PWA already supports woff2, so those
        // fallback bytes would never actually be fetched -- precaching them
        // too would just inflate the precache for files that stay dead
        // weight, working against the spec's "confirm total precache stays
        // reasonable" guidance. `admin.html`/`privacy.html` are deliberately
        // excluded: they're plain static pages outside the installable app
        // shell, and admin.html in particular has no reason to be
        // usable/cacheable offline (its whole purpose depends on live API
        // calls anyway).
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,woff2}'],
        globIgnores: ['**/admin.html', '**/privacy.html'],
        // vite-plugin-pwa defaults `navigateFallback` to 'index.html' (an
        // SPA fallback for any navigation not otherwise precached), and
        // workbox-routing's `NavigationRoute` in this version defaults its
        // own `denylist` to `[]` -- i.e. with no denylist it would swallow
        // literally every same-origin navigation, including a direct visit
        // to /admin.html or /privacy.html, and serve the app shell's
        // index.html instead. Denylisting those two paths (and anything
        // under /api/, which never receives navigation-mode requests
        // anyway but is denylisted defensively) preserves the existing
        // "real files win" precedent (wrangler's own asset serving already
        // does this outside the SW; this keeps the SW consistent with it
        // once installed). The pretty `/admin`/`/privacy` URLs (SEO fix wave
        // -- Footer.tsx/llms.txt now link to these instead of the
        // `.html` originals) need their own entries: without them, a
        // repeat/installed visitor whose SW has already precached
        // index.html gets the app shell silently served at `/privacy`
        // instead of the real static page, since Cloudflare's own
        // `.html`-stripping redirect (which is what makes the pretty URL
        // resolve at all outside the SW) never gets a chance to run once
        // the SW intercepts the navigation.
        navigateFallbackDenylist: [
          /^\/admin\.html$/,
          /^\/privacy\.html$/,
          /^\/admin$/,
          /^\/privacy$/,
          /^\/api\//,
          // share-cards T1: /s/{code} needs its own per-share rewritten
          // og:image/og:title meta tags (see src/worker/card/route.ts's
          // handleShareRequest) -- an installed PWA's SW must not swallow
          // that navigation and serve its precached, untransformed
          // index.html instead (same reasoning as /admin and /privacy
          // above; /og/*.png needs no entry here since it's never a
          // navigation-mode request).
          /^\/s\//,
        ],
        runtimeCaching: [
          {
            // Deliberately narrow: matches ONLY a same-origin GET to
            // exactly `/api/status`. Never matches `/api/admin`, any other
            // `/api/*` route, or any POST (Workbox's default `method` for a
            // registered route is GET, and this matcher checks it
            // explicitly too) -- those must always hit the network
            // uncached, in particular the mutating alert/report/feedback
            // endpoints.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.origin === self.location.origin && url.pathname === '/api/status',
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-status-cache',
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [0, 200] },
              // Without this, a cached 200 never expires -- an
              // installed-PWA device that's offline or on a hanging
              // connection would get the stale cached response resolved as
              // a normal 200 (NetworkFirst falls back to cache once the
              // network attempt fails or times out), which then re-primes
              // useStatus's own localStorage cache as "fresh" via
              // writeCached/writeCachedAt(now) -- silently defeating the
              // client's >2h stale-OPEN offline protection forever. Capping
              // the entry at 2h (matching DEAD_HOURS/OFFLINE_FORCE_UNKNOWN_MS)
              // makes Workbox treat an entry past that age as a cache miss,
              // so the fetch instead rejects and the tested offline/stale
              // path in useStatus engages as designed.
              expiration: { maxEntries: 1, maxAgeSeconds: 7200 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Multi-page build: the React app (index.html) plus the static,
      // framework-free admin page (Task 13) -- both need to land in `dist`
      // for wrangler's `[assets]` binding to serve them as real files.
      input: {
        main: path.resolve(dirname, 'index.html'),
        admin: path.resolve(dirname, 'src/app/admin.html'),
      },
    },
  },
});
