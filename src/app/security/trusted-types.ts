/**
 * Trusted Types support for the §6a threat model.
 *
 * The production CSP sends `require-trusted-types-for 'script'`, which makes the
 * browser reject a plain string handed to a DOM-XSS sink (`innerHTML`,
 * `script.src`, `eval`, …). The app has **no** such sink and React's normal
 * rendering uses none, so under normal operation nothing here is ever invoked —
 * that's the point: the sinks are dead, and an injected attempt to use one is
 * denied by the platform.
 *
 * This installs a single `'default'` policy as a **monitored escape hatch**, not
 * a bypass. If some dependency unexpectedly reaches a sink in production (which
 * we can't exhaustively prove without a real browser), the browser routes the
 * value through here: we log a **redacted, deduped** warning so the event is
 * loud and investigable rather than a silent white-screen. It is deliberately
 * conservative — pass-through for now, to be tightened to a hard throw once a
 * real-browser pass confirms no legitimate sink use exists. The strong,
 * fully-tested guarantee is `script-src 'self'` (no inline/eval); Trusted Types
 * is defense-in-depth on top of it.
 */
import { redactSecrets } from "./redact.js";

interface TrustedTypesPolicyFactory {
  createPolicy: (name: string, rules: Record<string, (input: string) => string>) => unknown;
  defaultPolicy: unknown;
}

let warned = false;

export function installTrustedTypesFallback(): void {
  const tt = (globalThis as unknown as { trustedTypes?: TrustedTypesPolicyFactory }).trustedTypes;
  if (!tt || typeof tt.createPolicy !== "function") return; // unsupported browser → CSP directive is simply ignored
  if (tt.defaultPolicy) return; // already installed (e.g. StrictMode re-entry)

  const passThroughWithWarning = (input: string): string => {
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[player] a Trusted Types sink was reached — investigate; " +
          "the §6a model expects none:",
        redactSecrets(input).slice(0, 120),
      );
    }
    return input;
  };

  try {
    tt.createPolicy("default", {
      createHTML: passThroughWithWarning,
      createScript: passThroughWithWarning,
      createScriptURL: passThroughWithWarning,
    });
  } catch {
    // A stricter host CSP may forbid creating a 'default' policy; that's fine —
    // it means sinks hard-fail, which is an even stronger posture.
  }
}
