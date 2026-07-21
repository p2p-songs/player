/**
 * The addon protocol client (ARCHITECTURE §3, §5/§5a) — the player's HTTP+JSON
 * consumer of installed addons. The *build* side of the wire contract the
 * `addon-sdk` router serves; it speaks only `@p2p-songs/protocol` (neutrality,
 * §11) and validates every response before it reaches the engine.
 *
 * - {@link AddonClient} — one installed addon (manifest-aware fetch + validate).
 * - {@link AddonCollection} — the installed set (install by URL, plane views).
 * - {@link AddonStreamResolver} — the real `Resolver` for the scheduler (§5),
 *   with provider-wide backoff (§4b).
 */
export { AddonClient, type AddonClientOptions, type BadRequestInfo } from "./client.js";
export { AddonCollection, type AddonCollectionOptions } from "./collection.js";
export { AddonStreamResolver, type AddonStreamResolverOptions } from "./stream-resolver.js";
export { ProviderHealth, type ProviderHealthOptions } from "./provider-health.js";
export {
  AddonUnreachableError,
  AddonProtocolError,
  defaultHttpGet,
  type HttpGet,
  type HttpResponse,
} from "./http.js";
export {
  addonBaseFromManifestUrl,
  resourceUrl,
  manifestUrl,
  type AddonBase,
  type ResourceRoute,
} from "./endpoints.js";
