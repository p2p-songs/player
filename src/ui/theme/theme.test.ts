import { describe, it, expect } from "vitest";
import tokensCss from "../tokens.css?raw";
import stylesCss from "../styles.css?raw";
import { TOKEN_NAMES, BUNDLED_THEMES, DEFAULT_THEME_ID, applyTheme, getTheme } from "./index.js";
import type { StyleTarget } from "./index.js";

/** Records what a theme wrote, so this runs in node with no DOM. */
function fakeTarget(): StyleTarget & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return { written, style: { setProperty: (name, value) => void written.set(name, value) } };
}

describe("applyTheme", () => {
  it("writes every token in the contract, plus the colour scheme", () => {
    const target = fakeTarget();
    applyTheme(getTheme("cyberpunk"), target);

    for (const name of TOKEN_NAMES) expect(target.written.get(name)).toBeTruthy();
    expect(target.written.get("color-scheme")).toBe("dark");
  });

  /**
   * Switching must overwrite *every* token, not merge. If a theme could leave
   * one of the previous theme's values in place, the two would blend into a
   * combination neither author ever saw.
   */
  it("leaves nothing of the previous theme behind", () => {
    const target = fakeTarget();
    applyTheme(getTheme("cyberpunk"), target);
    const dark = new Map(target.written);
    applyTheme(getTheme("bauhaus"), target);

    for (const [name, value] of dark) {
      if (target.written.get(name) === value) continue; // legitimately equal
      expect(target.written.get(name)).not.toBe(value);
    }
    expect(target.written.get("color-scheme")).toBe("light");
  });

  it("falls back to the default rather than leaving the app unstyled", () => {
    expect(getTheme("does-not-exist").id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });
});

describe("theme contract", () => {
  it.each(BUNDLED_THEMES.map((t) => [t.id, t] as const))("%s defines every token", (_id, theme) => {
    for (const name of TOKEN_NAMES) expect(theme.tokens[name].trim()).not.toBe("");
    expect(Object.keys(theme.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  /**
   * The CSS baseline paints the first frame before `applyTheme` runs, so a
   * token missing here is a flash of unstyled widget; a token here that the
   * contract dropped is dead weight nothing can set.
   */
  it("tokens.css declares exactly the contract", () => {
    const declared = [...tokensCss.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]!);
    expect(declared.sort()).toEqual([...TOKEN_NAMES].sort());
  });

  /**
   * The regression that matters. A literal colour in a component rule is a
   * widget that keeps its old look when the theme changes — which reads as a
   * rendering bug, not a missing feature, and is found by eye one screen at a
   * time. Themeable values live in tokens; this asserts none escaped back.
   */
  it("styles.css hardcodes no colours, radii or font sizes", () => {
    const css = stylesCss;
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);
    // `0` is allowed: removing decoration is a reset, not a look. Any other
    // literal is a choice the theme should have been making.
    const values = (prop: string): string[] =>
      [...css.matchAll(new RegExp(`${prop}:\\s*([^;]+);`, "g"))]
        .map((m) => m[1]!.trim())
        .filter((v) => !v.startsWith("var(") && v !== "0");
    expect(values("font-size")).toEqual([]);
    expect(values("border-radius")).toEqual([]);
  });

  it("every contract token is actually read by the stylesheet", () => {
    const css = stylesCss + tokensCss;
    const unused = TOKEN_NAMES.filter((name) => !css.includes(`var(${name})`));
    expect(unused).toEqual([]);
  });
});
