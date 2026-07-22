import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Dedicated vitest config so the harness `vite.config.ts` (root: "harness")
 * doesn't redirect the test runner. Tests live beside the engine in `src` and in
 * `tests`, and run in node (the audio/DOM seams are injected fakes, not a real
 * DOM — see `core/audio/media-element.ts`).
 */
export default defineConfig({
  root: ".",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
