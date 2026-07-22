/**
 * The design system's state variants must actually select something.
 *
 * The components in `src/components/ui/` are written against shorthand variants
 * (`data-active:`, `data-horizontal:`, `data-open:`) while Radix emits
 * `data-state="active"`, `data-orientation="horizontal"`, `data-state="open"`.
 * Bridging them is `globals.css`'s job — and when the bridge is missing there is
 * **no error**: Tailwind compiles `data-active:` to the literal `[data-active]`
 * selector, which matches nothing, and every state style goes silently inert.
 * That shipped once. Tabs stopped laying out as a column and stopped marking the
 * selected tab, and nothing in the build, the typechecker or the tests noticed.
 *
 * So this reads what the components actually use and what the CSS actually
 * declares, and requires the two to agree in both directions.
 */
import { describe, expect, it } from "vitest";
import css from "./globals.css?raw";

const sources = import.meta.glob("../components/ui/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Emitted by Radix as bare attributes, so Tailwind's built-in shorthand matches. */
const BARE_ATTRIBUTES = new Set(["disabled", "placeholder"]);

/**
 * `data-foo:`, `group-data-foo/name:`, `peer-data-foo:`. The bracket form
 * (`data-[state=open]:`) is deliberately not matched — it names the real
 * attribute, so it cannot go stale this way.
 */
const SHORTHAND = /(?:^|[\s:[])(?:group-|peer-)?data-([a-z][a-z0-9-]*)(?:\/[a-z0-9-]+)?:/g;

const DECLARED = /@custom-variant\s+data-([a-z][a-z0-9-]*)\s/g;

function used(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, source] of Object.entries(sources)) {
    for (const match of source.matchAll(SHORTHAND)) found.set(match[1]!, path);
  }
  return found;
}

function declared(): Set<string> {
  return new Set([...css.matchAll(DECLARED)].map((m) => m[1]!));
}

describe("design system", () => {
  it("has components and variants to check", () => {
    // Guards the two file reads above: a broken glob or import would otherwise
    // make every assertion below vacuously pass.
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    expect(used().size).toBeGreaterThan(0);
    expect(declared().size).toBeGreaterThan(0);
  });

  it("declares every shorthand data-* variant the components use", () => {
    const known = declared();
    const undeclared = [...used()]
      .filter(([name]) => !known.has(name) && !BARE_ATTRIBUTES.has(name))
      .map(([name, path]) => `data-${name}: — used in ${path}, not declared in globals.css`);
    expect(undeclared).toEqual([]);
  });

  it("uses every variant it declares", () => {
    const names = used();
    const unused = [...declared()].filter((name) => !names.has(name));
    expect(unused).toEqual([]);
  });

  it("maps each declared variant onto a real attribute rather than itself", () => {
    // `@custom-variant data-active (&[data-active])` would be the same bug with
    // extra steps: it must resolve to what Radix emits.
    const bodies = [...css.matchAll(/@custom-variant\s+data-([a-z][a-z0-9-]*)\s+\(([^)]*)\)/g)];
    expect(bodies.length).toBe(declared().size);
    for (const [, name, body] of bodies) {
      expect(body, `data-${name}`).toMatch(/\[data-(state|orientation)=/);
    }
  });
});
