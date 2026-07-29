/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Manifest URL of the default-installed metadata addon (ARCHITECTURE §11).
   * Unset → the player seeds no default. See `app/default-addons.ts`.
   */
  readonly VITE_DEFAULT_METADATA_ADDON_URL?: string;
  /**
   * Manifest URL of a default-installed **stream** addon — a self-host operator
   * override, off unless a private deployment sets it (ARCHITECTURE §11). The
   * value is credential-bearing and lands in the bundle; never commit a real
   * one. See `app/default-addons.ts`.
   */
  readonly VITE_DEFAULT_STREAM_ADDON_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
