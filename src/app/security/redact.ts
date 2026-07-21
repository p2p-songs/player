/**
 * Redact configured-addon secrets out of free text before it is ever logged,
 * reported, or displayed (ARCHITECTURE §6a). `redactManifestUrl` handles a URL
 * you already have in hand; this handles the harder case — an *arbitrary string*
 * (an error message, a stack frame) that may have a configured URL embedded
 * somewhere inside it.
 *
 * A configured install URL is `https://host/<base64url-config>/manifest.json`.
 * We rewrite any such occurrence to `https://host/…/manifest.json`, masking the
 * config segment (the debrid key) while keeping the host, so a redacted log
 * still says *which* addon without leaking the credential.
 */

// host + a non-slash config segment + /manifest.json, on http(s).
const CONFIGURED_URL_RE = /(https?:\/\/[^/\s]+)\/[^/\s]+\/manifest\.json/gi;

export function redactSecrets(text: string): string {
  return text.replace(CONFIGURED_URL_RE, "$1/…/manifest.json");
}
