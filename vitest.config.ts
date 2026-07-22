import { defineConfig } from "vitest/config";

/**
 * Dedicated vitest config so the harness `vite.config.ts` (root: "harness")
 * doesn't redirect the test runner. Tests live beside the engine in `src` and in
 * `tests`, and run in node (the audio/DOM seams are injected fakes, not a real
 * DOM — see `core/audio/media-element.ts`).
 */
export default defineConfig({
  root: ".",
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Vitest replaces CSS imports with empty strings unless asked not to. The
    // theme test asserts *about* the stylesheets (that no themeable value is
    // hardcoded), reading them with `?raw` — which needs this on.
    css: true,
  },
});
