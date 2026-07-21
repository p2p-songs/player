import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The player app (ARCHITECTURE §7). Root is the repo root, so `index.html` boots
 * `src/app/main.tsx`. The throwaway P-2 audio harness still lives at
 * `harness/index.html` and stays reachable in dev at `/harness/` — it predates
 * the app and is kept only for the manual audible smoke.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
