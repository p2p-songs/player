import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cspMetaTag } from "./src/app/security/csp.js";

/**
 * The player app (ARCHITECTURE §7). Root is the repo root, so `index.html` boots
 * `src/app/main.tsx`. The throwaway P-2 audio harness still lives at
 * `harness/index.html` and stays reachable in dev at `/harness/` — it predates
 * the app and is kept only for the manual audible smoke.
 */

/**
 * Inject the §6a Content-Security-Policy as a `<meta>` tag: strict for the
 * production build (`script-src 'self'`, Trusted Types), HMR-friendly in dev.
 * Delivering it in the HTML means it applies on any static host without server
 * config. `index.html` carries no CSP of its own so there's a single source.
 */
function cspPlugin(): Plugin {
  return {
    name: "p2p-songs-csp",
    transformIndexHtml(html, ctx) {
      const tag = cspMetaTag(ctx.server ? "dev" : "prod");
      return html.replace(/<meta charset="UTF-8" \/>/i, `<meta charset="UTF-8" />\n    ${tag}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Vite's modulepreload polyfill is an inline <script>, which `script-src
    // 'self'` forbids. Modern targets don't need it — drop it so the strict CSP
    // has no inline script to accommodate (ARCHITECTURE §6a).
    modulePreload: { polyfill: false },
  },
});
