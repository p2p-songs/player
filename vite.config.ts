import { defineConfig, searchForWorkspaceRoot } from "vite";

/**
 * Config for the throwaway P-2 audio harness only (`harness/`). Not the app
 * build — that's P-5. Root is the harness; the dev server is allowed to read the
 * sibling `src/` so the harness can import the real engine/audio modules.
 */
export default defineConfig({
  root: "harness",
  server: {
    open: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
