import { describe, it, expect } from "vitest";
import {
  addonBaseFromManifestUrl,
  manifestUrl,
  resourceUrl,
  stringifyExtra,
  type AddonBase,
} from "./endpoints.js";

const REC = "mbid:recording:11111111-1111-1111-1111-111111111111";

describe("addonBaseFromManifestUrl", () => {
  it("strips the /manifest.json suffix", () => {
    expect(addonBaseFromManifestUrl("https://addon.example/manifest.json")).toBe("https://addon.example");
  });

  it("preserves a configured base64url config segment", () => {
    const base = addonBaseFromManifestUrl("https://addon.example/eyJrIjoidiJ9/manifest.json");
    expect(base).toBe("https://addon.example/eyJrIjoidiJ9");
  });

  it("rejects non-https URLs", () => {
    expect(() => addonBaseFromManifestUrl("http://addon.example/manifest.json")).toThrow(/https/);
  });

  it("rejects a URL that is not a manifest URL", () => {
    expect(() => addonBaseFromManifestUrl("https://addon.example/stream/track/x.json")).toThrow(/manifest\.json/);
  });

  it("allows http:// only for loopback hosts (local addon dev)", () => {
    expect(addonBaseFromManifestUrl("http://127.0.0.1:7000/manifest.json")).toBe("http://127.0.0.1:7000");
    expect(addonBaseFromManifestUrl("http://localhost:7000/manifest.json")).toBe("http://localhost:7000");
    expect(() => addonBaseFromManifestUrl("http://addon.example/manifest.json")).toThrow(/https/);
  });
});

describe("resourceUrl", () => {
  const base = "https://addon.example" as AddonBase;

  it("percent-encodes the id into a single segment", () => {
    expect(resourceUrl(base, { resource: "stream", type: "track", id: REC })).toBe(
      "https://addon.example/stream/track/mbid%3Arecording%3A11111111-1111-1111-1111-111111111111.json",
    );
  });

  it("appends an encoded <extra> segment when present", () => {
    const url = resourceUrl(base, {
      resource: "stream",
      type: "track",
      id: REC,
      extra: { trackId: "mbid:track:22222222-2222-2222-2222-222222222222" },
    });
    expect(url).toContain("/stream/track/mbid%3Arecording%3A");
    expect(url.endsWith(".json")).toBe(true);
    // The <extra> is one path segment; the router decodes it as
    // URLSearchParams(decodeURIComponent(seg)). Assert that round-trip.
    const seg = url.slice(url.indexOf("/stream/track/") + "/stream/track/".length);
    const extraSeg = seg.split("/")[1]!.replace(/\.json$/, "");
    const params = new URLSearchParams(decodeURIComponent(extraSeg));
    expect(params.get("trackId")).toBe("mbid:track:22222222-2222-2222-2222-222222222222");
  });

  it("builds catalog routes over a configured base", () => {
    const configured = "https://addon.example/eyJrIjoidiJ9" as AddonBase;
    const url = resourceUrl(configured, { resource: "catalog", type: "artist", id: "top" });
    expect(url).toBe("https://addon.example/eyJrIjoidiJ9/catalog/artist/top.json");
  });
});

describe("stringifyExtra", () => {
  it("round-trips through URLSearchParams decoding", () => {
    const encoded = stringifyExtra({ genre: "rock", skip: "100" });
    const decoded = new URLSearchParams(decodeURIComponent(encoded));
    expect(decoded.get("genre")).toBe("rock");
    expect(decoded.get("skip")).toBe("100");
  });
});

describe("manifestUrl", () => {
  it("re-forms the manifest URL from a base", () => {
    const base = addonBaseFromManifestUrl("https://addon.example/cfg/manifest.json");
    expect(manifestUrl(base)).toBe("https://addon.example/cfg/manifest.json");
  });
});
