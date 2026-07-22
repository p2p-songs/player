/**
 * The theme registry and the one way a theme reaches the page.
 *
 * Themes are applied by setting each custom property individually — never by
 * building a stylesheet string. That is the load-bearing choice: `setProperty`
 * parses against the property's own grammar and silently drops anything
 * malformed, so a value carrying `}` cannot close its declaration and open a
 * rule of its own. When themes become installable (untrusted input), schema
 * validation is the first gate and this is the second.
 */
import type { Theme, TokenName } from "./contract.js";
import { TOKEN_NAMES } from "./contract.js";
import { espresso } from "./themes/espresso.js";
import { bauhaus } from "./themes/bauhaus.js";
import { cyberpunk } from "./themes/cyberpunk.js";

export type { Theme, ThemeTokens, TokenName } from "./contract.js";
export { TOKEN_NAMES } from "./contract.js";

/** Themes shipped in the bundle. Installed themes will extend this list, never
 *  replace it — the default must always be reachable to recover from a bad one. */
export const BUNDLED_THEMES: readonly Theme[] = [espresso, bauhaus, cyberpunk];

export const DEFAULT_THEME_ID = espresso.id;

/** The persisted setting key for the user's choice. */
export const THEME_SETTING_KEY = "ui.theme";

export function getTheme(id: string | undefined, themes: readonly Theme[] = BUNDLED_THEMES): Theme {
  return themes.find((t) => t.id === id) ?? themes.find((t) => t.id === DEFAULT_THEME_ID) ?? themes[0]!;
}

/**
 * The narrow slice of an element this needs, so theming is unit-testable in
 * node without a DOM (the same seam `MediaElementLike` uses for audio).
 */
export interface StyleTarget {
  style: { setProperty: (name: string, value: string) => void };
}

/**
 * Write a theme's tokens onto a target (in the app, `document.documentElement`).
 *
 * Iterates {@link TOKEN_NAMES} rather than the theme's own keys, so a theme
 * cannot set a property outside the contract however it was constructed —
 * which matters once a theme is a parsed JSON document rather than a literal.
 */
export function applyTheme(theme: Theme, target: StyleTarget): void {
  for (const name of TOKEN_NAMES) {
    target.style.setProperty(name, theme.tokens[name as TokenName]);
  }
  // Tells the browser which way to render form controls, scrollbars and the
  // canvas underneath our own colours. Without it a dark theme gets light
  // checkboxes and a white flash between paints.
  target.style.setProperty("color-scheme", theme.scheme);
}
