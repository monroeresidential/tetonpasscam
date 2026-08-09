import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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

// PWA plugin (vite-plugin-pwa) is wired up in a later task (SEO shell + PWA + offline).
export default defineConfig({
  root: '.',
  plugins: [react(), tailwindcss(), flattenAdminHtml()],
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
