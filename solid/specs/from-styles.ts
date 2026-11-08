// `solid/specs/state-matrix.json`: the states the pages' styles declare. The pages are the ones this repository draws —
// the Widgets and List pages' `s` maps and the Sensors page's exported styles — and the states are the three Clay
// overlays a style can carry: `:hover`, `:focus` and `:active` (`packages/cssints/src/clay.ts`). A row is a style that
// declares at least one; a cell is whether it declares that one. Nothing here is typed by hand but the display names,
// and `solid/test.sh` regenerates the spec and `cmp`s it, so a state added to a style is a `+` in the same commit.
//
//   bun solid/specs/from-styles.ts            # rewrite solid/specs/state-matrix.json here
//   bun solid/specs/from-styles.ts "$TMPDIR"  # ... or into another directory, for solid/test.sh's cmp
import "../plugin.ts";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { check, type StateMatrixData } from "../src/figure/spec.ts";

/** The states a Clay style can overlay on its base, as the figure prints them and as the shape carries them. */
export const STATES = [
  ["hover", ":hover"],
  ["focus", ":focus"],
  ["active", ":active"],
] as const;

/** A style's own states: the columns whose key it carries (a `css.hover` adds a `":hover"` variant to the shape). */
export const statesOf = (shape: unknown): string[] =>
  typeof shape !== "object" || shape === null ? [] : STATES.filter(([, key]) => key in shape).map(([name]) => name);

/** Every style of the pages, by the name the figure gives it: `widgets.button`, `list.row`, `sensors.units`. */
export async function matrixOf(): Promise<StateMatrixData> {
  const pages: [string, Record<string, unknown>][] = [
    ["widgets", (await import("../app/Widgets.tsx")).s as unknown as Record<string, unknown>],
    ["list", (await import("../app/List.tsx")).s as unknown as Record<string, unknown>],
    ["sensors", (await import("../../examples/sensors/styles.ts")) as unknown as Record<string, unknown>],
  ];
  const rows = pages.flatMap(([page, styles]) =>
    Object.entries(styles).flatMap(([key, shape]) => {
      const states = statesOf(shape);
      return states.length ? [{ name: `${page}.${key}`, states }] : [];
    }),
  );
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { columns: STATES.map(([name]) => name), rows };
}

/** The spec: the pages' own styles, their states, and the count the intent states. */
export function specOf(data: StateMatrixData) {
  return {
    kind: "stateMatrix" as const,
    title: "The pages' states, a style a row",
    intent:
      `The ${data.rows.length} styles of the Widgets, List and Sensors pages that declare a state, and which of the ` +
      `three they declare: the pages' own style modules, not a list typed here.`,
    source: "solid/app's and examples/sensors' styles, their :hover/:focus/:active",
    data,
  };
}

if (import.meta.main) {
  const data = await matrixOf();
  const spec = specOf(data);
  const problems = check(spec);
  if (problems.length) throw new Error(`state-matrix.json would not draw: ${problems.join(" ")}`);
  const dir = process.argv[2] ?? new URL(".", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state-matrix.json"), `${JSON.stringify(spec, null, 2)}\n`);
  const counts = spec.data.columns.map((column) => `${column} ${spec.data.rows.filter((row) => row.states.includes(column)).length}`);
  console.log(`from-styles: ${join(dir, "state-matrix.json")} (${spec.data.rows.length} styles: ${counts.join(", ")})`);
}
