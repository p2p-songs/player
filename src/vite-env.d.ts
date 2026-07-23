/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Manifest URL of the default-installed metadata addon (ARCHITECTURE §11).
   * Unset → the player seeds no default. See `app/default-addons.ts`.
   */
  readonly VITE_DEFAULT_METADATA_ADDON_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
