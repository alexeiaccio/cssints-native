// The table kind, read back from its source and from its own frame: `native/docs/map.md`'s Targets table, drawn as
// columns and rows on the cell grid. The test is the kind's honesty:
//
//   (a) the spec's columns and rows are a fresh parse of that document — an independent one, so a generator that
//       mis-reads the table fails here and not only in its own `cmp`;
//   (b) the heading is drawn once, the rule once, and a row's cells are the document's cells, in its order, as the frame
//       draws them;
//   (c) the cut is counted in **cells**, not characters (a CJK value is two cells a glyph), and a right-aligned column
//       reads flush right — each with the mutation that would pass a byte- or character-counted test;
//   (d) the refusals, in their sentences;
//   (e) the command golden, the frame's size, the terminal's rows and the text half.
//
//   bun solid/figure-table.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture } = await import("./dump.ts");
const { CELL_HEIGHT, CELL_WIDTH, PADDING_X, PADDING_Y, layoutOf, sizeOf } = await import("./src/figure/kinds.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { cellWidth, render } = await import("./src/figure/text.ts");
const { format } = await import("./src/format.ts");

import type { Layout, LayoutLine } from "./src/figure/kinds.ts";
import type { TableSpec } from "./src/figure/spec.ts";

interface Cmd {
  type: string;
  element: string | null;
  box: number[];
  text?: string;
}
interface Dump {
  commands: Cmd[];
  effects: unknown;
  size: [number, number];
}

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const spec = (() => {
  const parsed = parse(readFileSync(new URL("./specs/table.json", import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/table.json: ${parsed.problems.join(" ")}`);
  return parsed.spec as TableSpec;
})();

// ---- (a) the document's own table, parsed here and not by specs/from-targets.ts ---------------------------------------

/** A table line's cells, trimmed, with the markdown backticks a cell's text does not keep. */
const cellsOf = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim().replace(/`/g, ""));

/** The `## Targets` table: its heading row and its body, from the document read at test time. */
function targetsOf(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.trim() === "## Targets");
  if (from < 0) throw new Error("native/docs/map.md has no '## Targets' section");
  const table: string[][] = [];
  for (const line of lines.slice(from + 1)) {
    if (!line.startsWith("|")) {
      if (table.length) break;
      continue;
    }
    if (/^\|[\s:|-]+\|$/.test(line)) continue; // the separators under the heading
    table.push(cellsOf(line));
  }
  const [headers, ...rows] = table;
  if (!headers || !rows.length) throw new Error("native/docs/map.md's Targets table has no rows");
  return { headers, rows };
}

const doc = targetsOf(readFileSync(new URL("../docs/map.md", import.meta.url), "utf8"));
const COLUMNS = ["Target", "Raster", "JS at run time", "Status"] as const;
const at = COLUMNS.map((name) => doc.headers.indexOf(name));
const wanted = doc.rows.map((row) => at.map((i) => row[i] ?? ""));

const sameRows = JSON.stringify(spec.data.rows) === JSON.stringify(wanted);
if (sameRows)
  ok("the document's rows", `${wanted.length} targets, cell for cell: ${wanted.map((row) => row[0]).join(", ")}`);
else {
  const r = wanted.findIndex((row, i) => JSON.stringify(row) !== JSON.stringify(spec.data.rows[i]));
  bad("the document's rows", `row ${r + 1}: ${JSON.stringify(spec.data.rows[r])} is not ${JSON.stringify(wanted[r])}`);
}
const titles = spec.data.columns.map((column) => column.title);
const wantedTitles = COLUMNS.map((name) => name.toLowerCase());
if (JSON.stringify(titles) === JSON.stringify(wantedTitles) && spec.source?.includes("docs/map.md"))
  ok("the columns and their source", `${titles.join(", ")} — the document's four headings, ${spec.source}`);
else bad("the columns and their source", `${JSON.stringify(titles)} / ${spec.source}`);

// ---- (b) the drawing: the heading once, the rule once, the rows in the document's order ------------------------------

const max = spec.options?.max;
const widths = (data: TableSpec["data"], cap = max): number[] =>
  data.columns.map((column, c) => {
    const wantedWidth = Math.max(cellWidth(column.title), ...data.rows.map((row) => cellWidth(row[c] ?? "")));
    return Math.max(1, cap === undefined ? wantedWidth : Math.min(cap, wantedWidth));
  });
/** The cut, counted in cells: `…` one cell at the end. A cut counted in characters would keep a CJK value whole. */
function cutToCells(text: string, width: number): string {
  if (cellWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const ch of text) {
    const w = cellWidth(ch);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}
/** A cell as the kind draws it: cut to the column in cells, then padded the way it reads. */
const drawnCell = (text: string, c: number, data: TableSpec["data"], cap = max): string => {
  const width = widths(data, cap)[c]!;
  const cut = cutToCells(text, width);
  const blanks = " ".repeat(Math.max(0, width - cellWidth(cut)));
  return data.columns[c]!.align === "right" ? blanks + cut : cut + blanks;
};
/** The lines a table draws: the heading, the rule and the body — not the title or the source `finish` adds. */
const tableLines = (l: Layout): LayoutLine[] =>
  l.lines.filter((line) => /^fig-(head|rule|cell)-/.test(line.items[0]?.textId ?? ""));

const layout: Layout = layoutOf(spec);
const lineOf = (l: Layout, textId: string): LayoutLine | undefined =>
  l.lines.find((line) => line.items[0]?.textId === textId);
const cellText = (line: LayoutLine): string[] => line.items.flatMap((item) => (item.kind === "text" ? [item.text] : []));

const head = lineOf(layout, "fig-head-0");
const headings = head ? cellText(head) : [];
const dump = (await capture("figure", undefined, { spec, warm: 2 })) as Dump;
const frameTexts = dump.commands.filter((c) => c.type === "text" && c.text !== undefined).map((c) => c.text!);
const once = headings.filter((text) => frameTexts.filter((drawn) => drawn === text).length === 1);
if (head && headings.length === spec.data.columns.length && once.length === headings.length)
  ok("the heading, once", `${headings.length} headings, one text command each: ${headings.map((text) => text.trim()).join(", ")}`);
else bad("the heading, once", `${JSON.stringify(headings)} of ${spec.data.columns.length}, ${once.length} drawn once`);

// a row's cells are the document's, cut and padded, and the frame draws them in the document's order
let cursor = 0;
const missing: string[] = [];
for (const [r, row] of spec.data.rows.entries()) {
  const line = lineOf(layout, `fig-cell-${r}-0`);
  const cells = line ? cellText(line) : [];
  const want = row.map((text, c) => drawnCell(text, c, spec.data));
  if (JSON.stringify(cells) !== JSON.stringify(want)) {
    missing.push(`row ${r + 1}: ${JSON.stringify(cells)} is not ${JSON.stringify(want)}`);
    continue;
  }
  for (const cell of want) {
    while (cursor < frameTexts.length && frameTexts[cursor] !== cell) cursor++;
    if (cursor === frameTexts.length) missing.push(`row ${r + 1}: no text command reads ${JSON.stringify(cell)}`);
    else cursor++;
  }
}
if (!missing.length)
  ok("the rows", `${spec.data.rows.length} rows, every cell the document's, in its order (${frameTexts.length} text commands)`);
else bad("the rows", missing.slice(0, 3).join("; "));

const rule = lineOf(layout, "fig-rule-0");
const ruleAt = layout.lines.indexOf(rule!);
const headAt = layout.lines.indexOf(head!);
const firstRowAt = layout.lines.indexOf(lineOf(layout, "fig-cell-0-0")!);
const noRule = layoutOf({ ...spec, data: { ...spec.data, headerRule: false } }).lines.some((line) =>
  line.items.some((item) => item.kind === "text" && item.text.startsWith("-")),
);
if (rule && ruleAt === headAt + 1 && ruleAt < firstRowAt && !noRule)
  ok("the rule", `one line of - between the heading and the first row; headerRule false draws none`);
else bad("the rule", `rule at ${ruleAt}, heading ${headAt}, first row ${firstRowAt}, a rule when off: ${noRule}`);

// ---- (c) the cut is cells, and a number's column reads right ---------------------------------------------------------

const cutCells = tableLines(layout).flatMap(cellText).filter((text) => text.includes("…"));
const overWide = widths(spec.data).flatMap((width, c) =>
  tableLines(layout).flatMap((line) => cellText(line).filter((text, i) => i === c && cellWidth(text) > width)),
);
if (cutCells.length && !overWide.length)
  ok("the cut, counted in cells", `${cutCells.length} cells end in … and none is wider than its column ` +
    `(${widths(spec.data).join(", ")} cells)`);
else bad("the cut, counted in cells", `${cutCells.length} cut cells, ${overWide.length} over their column`);

const cjk: TableSpec = {
  kind: "table",
  source: "a test's own cell",
  data: { columns: [{ title: "camera" }], rows: [["监控摄像头"], ["front door"]] },
  options: { max: 6 },
};
const cjkRow = cellText(lineOf(layoutOf(cjk), "fig-cell-0-0")!)[0]!;
// the mutations: a cut counted in characters (this value is five of them) keeps the value whole and overflows the
// column, and one counted in bytes (fifteen) cuts inside the second glyph and marks nothing
const byChars = "监控摄像头".padEnd(6, " ");
const byBytes = Buffer.from("监控摄像头", "utf8").subarray(0, 6).toString("utf8");
if (cjkRow.trimEnd() === "监控…" && cellWidth(byChars) > 6 && !byBytes.endsWith("…") && byChars !== cjkRow)
  ok("the cut is cells, not characters or bytes", `"监控摄像头" is ${cellWidth("监控摄像头")} cells, 5 characters and ` +
    `${Buffer.byteLength("监控摄像头")} bytes: drawn "${cjkRow.trimEnd()}" (${cellWidth(cjkRow.trimEnd())} of 6 cells); ` +
    `a character count keeps it ${cellWidth(byChars)} cells wide, a byte count ${JSON.stringify(byBytes)} with no …`);
else bad("the cut is cells, not characters or bytes", `${JSON.stringify(cjkRow)} against ${JSON.stringify([byChars, byBytes])}`);

const numeric: TableSpec = {
  kind: "table",
  source: "a test's own numbers",
  data: { columns: [{ title: "run" }, { title: "ms", align: "right" }], rows: [["first", "12"], ["second", "7"]] },
};
const numericLayout = layoutOf(numeric);
const first = cellText(lineOf(numericLayout, "fig-cell-0-0")!)[1];
const seventh = cellText(lineOf(numericLayout, "fig-cell-1-0")!)[1];
// the mutation: the same values left-aligned are not flush right
const leftAligned = "7".padEnd(2, " ");
if (first === "12" && seventh === " 7" && seventh.endsWith("7") && !leftAligned.endsWith("7"))
  ok("a number's column, right", `"12" and " 7" in a 2-cell column; left-aligned it would read "${leftAligned}"`);
else bad("a number's column, right", `${JSON.stringify([first, seventh])}`);

// ---- (d) the refusals, in their sentences -----------------------------------------------------------------------------

const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((problem) => problem === sentence || problem.includes(sentence)))
    ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const source = "Sample: a table";
refuses(
  "no columns and no rows",
  { kind: "table", source, data: { columns: [], rows: [] } },
  "A table needs its columns",
);
refuses(
  "a row that is not a row",
  { kind: "table", source, data: { columns: [{ title: "a" }, { title: "b" }], rows: [["one", 2], ["one"]] } },
  "Row 1's cell 2 is not text: 2 is not one.",
);
refuses(
  "a row of the wrong width",
  { kind: "table", source, data: { columns: [{ title: "a" }, { title: "b" }], rows: [["one"]] } },
  "Row 1 has 1 cell: the table has 2 columns.",
);
refuses(
  "an alignment there is not",
  { kind: "table", source, data: { columns: [{ title: "a", align: "centre" }], rows: [["one"]] } },
  'Column 1\'s align is left or right, not "centre".',
);
refuses(
  "a cap that is not cells",
  { kind: "table", source, data: { columns: [{ title: "a" }], rows: [["one"]] }, options: { max: 0 } },
  "options.max must be a whole number of cells above zero: it is 0.",
);
const focused = check({ kind: "table", source, data: spec.data, focus: { on: ["Terminal", "raster"] } });
const unfocused = check({ kind: "table", source, data: spec.data, focus: { on: ["ESP32-C6"] } });
if (!focused.length && unfocused.some((problem) => problem.includes('Focus names "ESP32-C6"')))
  ok("check: a focus's names", "a row's first cell and a heading are names; a target the table does not draw is refused");
else bad("check: a focus's names", `${JSON.stringify(focused)} / ${JSON.stringify(unfocused)}`);
refuses(
  "a headerRule that is not a flag",
  { kind: "table", source, data: { columns: [{ title: "a" }], rows: [["one"]], headerRule: "yes" } },
  'A table\'s headerRule is true or false, not "yes".',
);

// ---- (e) the frame's size, the golden, the terminal's rows and the text half ------------------------------------------

const size = sizeOf(spec);
const rows = layout.lines.reduce((n, line) => n + (line.height ?? 1), 0);
const wantSize = { width: (layout.width + 2 * PADDING_X) * CELL_WIDTH, height: (rows + 2 * PADDING_Y) * CELL_HEIGHT };
const root = dump.commands.find((c) => c.element === "Root");
if (size.width === wantSize.width && size.height === wantSize.height && root?.box[2] === wantSize.width)
  ok("the frame's size", `${size.width}x${size.height} px: ${layout.width} cells wide and ${rows} rows at 8x16`);
else bad("the frame's size", `${JSON.stringify(size)} is not ${JSON.stringify(wantSize)}`);

const golden = readFileSync(new URL("./goldens/figure-table.json", import.meta.url), "utf8").trim();
const got = format({ commands: dump.commands, effects: dump.effects });
if (got === golden) ok("the golden", "solid/goldens/figure-table.json, every command field identical");
else {
  const at = got.split("\n").findIndex((text, i) => text !== golden.split("\n")[i]);
  bad("the golden", `solid/goldens/figure-table.json differs at line ${at + 1}: ${JSON.stringify(got.split("\n")[at])}`);
}

/** The terminal's dump as rows: above the colour table, dots and runs of blanks dropped (figure.test.ts's reading). */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map((line) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
/** The frame's rows as characters, each text command at its own cell column. */
function rowsOfFrame(dump: Dump): string[] {
  const byRow = new Map<number, Cmd[]>();
  for (const command of dump.commands)
    if (command.type === "text" && command.text !== undefined) {
      const row = Math.round(command.box[1]! / CELL_HEIGHT);
      const parts = byRow.get(row) ?? [];
      parts.push(command);
      byRow.set(row, parts);
    }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, parts]) => {
      let line = "";
      for (const part of parts.sort((a, b) => a.box[0]! - b.box[0]!)) {
        const col = Math.round((part.box[0]! - PADDING_X * CELL_WIDTH) / CELL_WIDTH);
        line += " ".repeat(Math.max(0, col - cellWidth(line))) + (part.text ?? "");
      }
      return line;
    });
}
const normalise = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
const work = mkdtempSync(join(tmpdir(), "cssints-figure-table-"));
const cols = Math.max(80, layout.width + 2 * PADDING_X);
const out = join(work, "table.txt");
const run = spawnSync(
  "bun",
  [
    "terminal/solid.ts",
    "--page",
    "figure",
    "--spec",
    new URL("./specs/table.json", import.meta.url).pathname,
    "--cols",
    String(cols),
    "--rows",
    String(rows + 2 * PADDING_Y),
    "--dump",
    out,
  ],
  { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
);
if (run.status !== 0) bad("the terminal", `exit ${run.status}: ${run.stderr.trim()}`);
else {
  const cells = rowsOfCells(readFileSync(out, "utf8"));
  const pixel = rowsOfFrame(dump).map(normalise).filter(Boolean);
  let differ = -1;
  for (let i = 0; i < cells.length && i < pixel.length; i++)
    if (cells[i] !== pixel[i]) {
      differ = i;
      break;
    }
  if (cells.length !== pixel.length) bad("the terminal's rows", `${cells.length} rows, the pixel figure's ${pixel.length}`);
  else if (differ >= 0)
    bad("the terminal's rows", `row ${differ + 1}: ${JSON.stringify(cells[differ])} is not ${JSON.stringify(pixel[differ])}`);
  else ok("the terminal's rows", `${cells.length} rows, the pixel figure's words; ${cols} columns`);
}

const text = render(spec, { width: cols }).split("\n");
if (text[0] === spec.title && text.every((line) => cellWidth(line) <= cols))
  ok("the text half", `${text.length} lines, the title first, the widest ${Math.max(...text.map(cellWidth))} cells`);
else bad("the text half", `the first line is ${JSON.stringify(text[0])}`);

console.log(`\n${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
