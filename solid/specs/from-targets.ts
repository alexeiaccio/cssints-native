// `solid/specs/table.json`, written from `docs/map.md`'s Targets table: the map's own targets as the generic
// `table` kind's figure, so a target added, renamed or re-worded there is a rewrite here and a `cmp` in
// solid/figure-handoff.sh. `solid/figure-table.test.ts` re-parses the same table and holds every cell to it, so the
// figure cannot drift from the document it documents.
//
//   bun native/solid/specs/from-targets.ts            rewrites table.json here in place
//   bun native/solid/specs/from-targets.ts <dir>      writes it into <dir> (the check's own way: it writes nothing else)
//
// What is drawn, and what is not:
//   — four of the map's six columns: target, raster, JS at run time, status. Styles is `cssints/clay` on every row (a
//     column of one value says nothing), and Layout is Clay on every row but two, where it names a different Clay; the
//     four drawn are the ones whose cells differ from target to target.
//   — a cell's markdown backticks are dropped: a figure's cell is text, and a cell has no inline markup.
//   — `options.max` is 18 cells. The raster's and the status's own sentences are longer than a column may be, so the
//     figure is where the kind's cut (`…`, counted in cells and not bytes) is the real thing and not a test.
//   — the headings are lowercased, as the other tables here print them (`tokenTable`'s group, token and value).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { check } from "../src/figure/spec.ts";

/** The map, from this file (native/solid/specs). */
const MAP = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/map.md");
/** The map's headings the figure draws, in its order; the cell drawn under both is the heading lowercased. */
const COLUMNS = ["Target", "Raster", "JS at run time", "Status"] as const;
/** A column's width in cells: wider than this, and a value is cut at the cell with `…` (the kind's `options.max`). */
const MAX = 18;

/** The `## Targets` table: its heading row and its body rows, cells trimmed and backticks dropped. */
function targetsOf(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.trim() === "## Targets");
  if (from < 0) throw new Error("docs/map.md has no '## Targets' section");
  const table: string[][] = [];
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("|")) {
      if (table.length) break;
      continue;
    }
    // the separator under the heading: `| --- | :--: |`, no cells
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    table.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/`/g, "")),
    );
  }
  const [headers, ...rows] = table;
  if (!headers || !rows.length) throw new Error("docs/map.md's Targets table has no rows");
  return { headers, rows };
}

const { headers, rows } = targetsOf(readFileSync(MAP, "utf8"));
const at = COLUMNS.map((name) => headers.indexOf(name));
const missing = COLUMNS.filter((_, c) => at[c]! < 0);
if (missing.length) throw new Error(`docs/map.md's Targets table has no ${missing.join(", ")} column`);

const spec = {
  kind: "table" as const,
  title: "The map's targets, one a row",
  intent:
    "docs/map.md's Targets table: each target, what rasters it, what it needs at run time, and how far it is proven.",
  source: "docs/map.md, the Targets table",
  data: {
    columns: COLUMNS.map((name) => ({ title: name.toLowerCase() })),
    rows: rows.map((row) => at.map((i) => row[i] ?? "")),
  },
  options: { max: MAX },
};

const problems = check(spec);
if (problems.length) throw new Error(`table.json would not draw: ${problems.join(" ")}`);

const out = process.argv[2] ? resolve(process.argv[2]) : dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });
const file = resolve(out, "table.json");
writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
console.log(
  `from-targets: ${file} (${spec.data.rows.length} targets of docs/map.md, ` +
    `${spec.data.columns.length} columns: ${spec.data.columns.map((column) => column.title).join(", ")})`,
);
