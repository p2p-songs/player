import { describe, it, expect } from "vitest";
import { buildCsp, cspMetaTag } from "./csp.js";
import { redactSecrets } from "./redact.js";

describe("CSP — production profile (ARCHITECTURE §6a)", () => {
  const csp = buildCsp("prod");

  it("forbids inline and eval'd script — the injected-script exfil threat", () => {
    expect(csp).toContain("script-src 'self'");
    // (style-src does allow 'unsafe-inline'; the script directive must not — asserted below.)
  });

  it("closes the usual script-src bypasses", () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it("enforces Trusted Types in production", () => {
    expect(csp).toContain("require-trusted-types-for 'script'");
  });

  it("still permits addon fetches, artwork, and audio from arbitrary https origins", () => {
    // Addons are user-installed URLs on hosts we can't enumerate — connect/img/
    // media must allow https:. CSP here guards against *injected* code, not a
    // trusted addon's own host (documented tradeoff in csp.ts).
    expect(csp).toMatch(/connect-src[^;]*https:/);
    expect(csp).toMatch(/img-src[^;]*https:/);
    expect(csp).toMatch(/media-src[^;]*https:/);
  });

  it("allows loopback origins so a locally-run addon still works", () => {
    expect(csp).toMatch(/connect-src[^;]*127\.0\.0\.1/);
  });
});

describe("CSP — the script directive is genuinely strict", () => {
  it("has no 'unsafe-inline' or 'unsafe-eval' anywhere in the script-src", () => {
    const scriptSrc = /script-src ([^;]*)/.exec(buildCsp("prod"))![1]!;
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });
});

describe("CSP — dev profile", () => {
  const csp = buildCsp("dev");
  it("relaxes script-src for Vite HMR only in dev", () => {
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("'unsafe-eval'");
  });
  it("does not enforce Trusted Types in dev (HMR uses sinks)", () => {
    expect(csp).not.toContain("require-trusted-types-for");
  });
});

describe("cspMetaTag", () => {
  it("wraps the policy in a valid http-equiv meta tag", () => {
    const tag = cspMetaTag("prod");
    expect(tag).toMatch(/^<meta http-equiv="Content-Security-Policy" content=".*" \/>$/);
    expect(tag).toContain("script-src 'self'");
  });
});

describe("redactSecrets — configured URLs never leak into text (§6a)", () => {
  it("masks the config segment of a configured manifest URL embedded in a message", () => {
    const raw = "fetch failed for https://bitbop.example/eyJkZWJyaWQiOnsiYXBpS2V5IjoiUkQtU0VDUkVUIn19/manifest.json";
    const out = redactSecrets(raw);
    expect(out).toContain("https://bitbop.example/…/manifest.json");
    expect(out).not.toContain("RD-SECRET");
    expect(out).not.toContain("eyJkZWJyaWQ");
  });

  it("keeps the host so a redacted log still says which addon", () => {
    expect(redactSecrets("https://bitbop.example/SECRETCONFIG/manifest.json")).toContain("bitbop.example");
  });

  it("redacts every occurrence in a multi-line stack", () => {
    const stack = [
      "Error: boom",
      "  at https://a.example/CFG1/manifest.json",
      "  at https://b.example/CFG2/manifest.json",
    ].join("\n");
    const out = redactSecrets(stack);
    expect(out).not.toContain("CFG1");
    expect(out).not.toContain("CFG2");
  });

  it("leaves a plain (unconfigured) URL and ordinary text untouched", () => {
    expect(redactSecrets("just a message")).toBe("just a message");
    expect(redactSecrets("see https://example.com/manifest.json")).toBe("see https://example.com/manifest.json");
  });
});
