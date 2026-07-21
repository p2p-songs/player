/**
 * A scriptable fake {@link HttpGet} for headless addon-client tests. Routes are
 * matched by exact URL or by predicate; a handler returns a status + JSON body,
 * throws to simulate a network failure, or a route can be scripted to hang until
 * released (for cancellation tests). Records every requested URL in order.
 */
import type { HttpGet, HttpResponse } from "./http.js";

export type FakeHandler = (url: string, signal?: AbortSignal) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

export class FakeHttp {
  /** Every URL requested, in order. */
  readonly requests: string[] = [];
  private readonly routes: Array<{ match: (url: string) => boolean; handler: FakeHandler }> = [];

  /** Route an exact URL. */
  on(url: string, handler: FakeHandler): this {
    this.routes.push({ match: (u) => u === url, handler });
    return this;
  }

  /** Route by predicate (e.g. path contains `/stream/`). First match wins. */
  when(match: (url: string) => boolean, handler: FakeHandler): this {
    this.routes.push({ match, handler });
    return this;
  }

  /** A network-level failure (no HTTP response) for URLs matching `match`. */
  fail(match: (url: string) => boolean, message = "network down"): this {
    return this.when(match, () => {
      throw new Error(message);
    });
  }

  get get(): HttpGet {
    return async (url, { signal }): Promise<HttpResponse> => {
      this.requests.push(url);
      if (signal?.aborted) throw abortError();
      const route = this.routes.find((r) => r.match(url));
      if (!route) return jsonResponse(404, { err: "not found" });
      const out = await route.handler(url, signal);
      return jsonResponse(out.status, out.body);
    };
  }
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, json: async () => body };
}

export function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}
