// The registry's own test: the seam a kind is added at, checked where a kind is added and not where it is drawn.
//
//   (a) every kind has both halves — a layout and a check — and the registry's list and the types' list (spec.ts's
//       `KINDS`) are the same forty-two, so neither can grow without the other;
//   (b) the `unknown kind` sentence is the registry's own list, in its order, and native/docs/map.md's list of kinds is
//       the same one (a doc that names a kind the registry does not have is a line here);
//   (c) a throwaway kind, registered **in this file only**, draws through text.ts and declares on the desktop: the seam
//       a new kind goes through, proved without touching Figure.tsx, text.ts, spec.ts or any other kind's file. The kind
//       is not shipped: it is registered at the end of this run, after (a) and (b) have read the real list.
//
//   bun solid/figure-registry.test.ts
import "./plugin.ts";

import { readFileSync } from "node:fs";

import { checkOf, entryOf, kinds, layoutOf, register, sizeOf } from "./src/figure/kinds.ts";
import { finish, textItem } from "./src/figure/kinds/shared.ts";
import { render } from "./src/figure/text.ts";
import { check, KINDS, type Kind, type Spec } from "./src/figure/spec.ts";
import type { Layout, LayoutLine } from "./src/figure/registry.ts";

const { capture } = await import("./dump.ts");

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

// (a) one table, both halves: a kind with a layout and no check would draw a spec nothing refuses
for (const kind of KINDS) {
  const entry = entryOf(kind);
  if (!entry) bad(`${kind}: registered`, "no entry: kinds.ts does not load the area file that registers it");
  else if (typeof entry.layout !== "function") bad(`${kind}: the layout`, `it is ${typeof entry.layout}`);
  else if (typeof entry.check !== "function") bad(`${kind}: the check`, `it is ${typeof entry.check}`);
  else ok(`${kind}: a layout and a check`, "both, from one entry");
}
const registered = kinds();
const missing = KINDS.filter((kind) => !registered.includes(kind));
const extra = registered.filter((kind) => !(KINDS as readonly string[]).includes(kind));
if (!missing.length && !extra.length)
  ok("the registry's list", `${registered.length} kinds, the ones KINDS names (${registered.join(", ")})`);
else bad("the registry's list", `missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`);

// (b) the refusal and the map read the same list: an unknown kind is refused with the registry's own names, in order,
// and native/docs/map.md's "kinds are here:" sentence names exactly those
const sentence = check({ kind: "pieChart", data: [] })[0] ?? "";
const wanted = `unknown kind "pieChart": the ones here are ${registered.join(", ")}.`;
if (sentence === wanted) ok("the unknown kind's sentence", `"${wanted}"`);
else bad("the unknown kind's sentence", `${JSON.stringify(sentence)} is not ${JSON.stringify(wanted)}`);
const map = readFileSync(new URL("../docs/map.md", import.meta.url), "utf8");
const listed = /kinds are here:([^.]+)\./s.exec(map)?.[1]?.match(/`([A-Za-z]+)`/g)?.map((name) => name.slice(1, -1)) ?? [];
if (listed.join(", ") === registered.join(", "))
  ok("native/docs/map.md's kinds", `${listed.length} kinds, the registry's own list`);
else bad("native/docs/map.md's kinds", `${JSON.stringify(listed)} is not ${JSON.stringify(registered)}`);

// (c) the throwaway kind: a two-row layout, built with the shared builders and registered here and nowhere else — the
// recipe an area file follows, in one place
const THROWAWAY = "twoRow" as Kind;
const row = (id: string, text: string): LayoutLine => ({ items: [textItem(id, text, 6, "ink")] });
const twoRow = (spec: Spec): Layout =>
  finish(spec, THROWAWAY, 6, [row("fig-a", "first"), row("fig-b", "second")], [], []);
register(THROWAWAY, {
  layout: twoRow,
  check: (data) => (Array.isArray(data) && data.length ? [] : ["A two-row figure needs its two rows."]),
});
const spec = { kind: THROWAWAY, title: "A throwaway kind", data: [] } as unknown as Spec;

const refused = checkOf(THROWAWAY, [], undefined);
if (refused.length === 1 && refused[0] === "A two-row figure needs its two rows.")
  ok("checkOf: the throwaway's check", `"${refused[0]}" — the registry's check, not spec.ts's`);
else bad("checkOf: the throwaway's check", JSON.stringify(refused));

const text = render(spec);
if (text === "A throwaway kind\nfirst\nsecond")
  ok("text.ts draws the throwaway", `its title and "first" over "second", from its two-row layout`);
else bad("text.ts draws the throwaway", JSON.stringify(text));

const size = sizeOf(spec);
// the title's 16 cells (the layout's own 6 widened by it), the padding's two a side, and the title's row, the two rows and
// the padding's one above and below
const wantSize = { width: (16 + 2 * 2) * 8, height: (3 + 2 * 1) * 16 };
if (size.width === wantSize.width && size.height === wantSize.height)
  ok("sizeOf the throwaway", `${size.width}x${size.height} px: 16 cells and three rows (the title's, "first", "second")`);
else bad("sizeOf the throwaway", `${JSON.stringify(size)} is not ${JSON.stringify(wantSize)}`);

const dump = await capture("figure", undefined, { spec, warm: 2 });
const drawn = dump.commands.filter((command) => command.type === "text").map((command) => command.text);
if (drawn.includes("first") && drawn.includes("second"))
  ok("the desktop declares the throwaway", `${dump.commands.length} commands: "first" and "second" are in the frame`);
else bad("the desktop declares the throwaway", `the frame's texts are ${JSON.stringify(drawn)}`);
const rows = dump.commands
  .filter((command) => command.type === "text" && command.text === "second")
  .map((command) => command.box[1]);
const firstRow = dump.commands.filter((command) => command.type === "text" && command.text === "first").map((c) => c.box[1]);
if (rows.length === 1 && firstRow.length === 1 && rows[0]! - firstRow[0]! === 16)
  ok("the throwaway's two rows", `"second" is one cell (16px) under "first"`);
else bad("the throwaway's two rows", `${JSON.stringify([firstRow, rows])} for one row a cell apart`);
// the layout function itself is the one the registry looked up, not a special case: the same call the frame made
if (layoutOf(spec).lines.length === 3) ok("layoutOf the throwaway", "the registered layout, by its kind's name");
else bad("layoutOf the throwaway", `${layoutOf(spec).lines.length} lines`);

if (failed) {
  console.error(`solid/figure-registry.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure-registry.test.ts: ${registered.length} kinds, ${checks} checks, and a throwaway that draws`);
