import { describe, it, expect, vi, afterEach } from "vitest";
import { defaultHttpGet } from "./http.js";

/**
 * §6a: a configured (secret-bearing) request or a bearer-URL `/stream` response
 * must never be persisted by the browser HTTP cache. The transport enforces this
 * by asking `fetch` for `cache: "no-store"`. This pins that contract so a future
 * edit can't silently drop it (the request URL itself carries the debrid key).
 */
describe("defaultHttpGet cache policy", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("asks fetch for no-store on every addon request", async () => {
    const spy = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    await defaultHttpGet("https://bitbop.example/CONFIG/stream/track/x.json", {});

    expect(spy).toHaveBeenCalledOnce();
    const init = spy.mock.calls[0]![1]!;
    expect(init.cache).toBe("no-store");
  });
});
