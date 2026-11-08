// The three planning kinds' invariants, read back from the frame and not from a string: `timeline`'s bars against the
// spans their data gives, `statusKey`'s entries against the statuses the figures use, `nowNextLater`'s columns against
// the cards' count and order; then `check`'s refusals in their sentences; then the same three specs on the terminal, row
// for row. The command goldens are the same capture `solid/dump.ts` stores, field by field.
//
// The geometry comes from `solid/dump.ts`'s `capture` — the same last frame solid/goldens stores — so a bar is the box
// Clay laid out, not the number the layout asked for. A cell is 8px across, as the layout's own unit; a fill may round to
// the nearest half cell of its span.
//
// The map is the data: `solid/specs/from-map.ts` writes `timeline.json`, and `solid/test.sh` cmps it; `nowNextLater.json`
// is hand-written (the map's `Left:` lines are not machine-readable enough to group), so here every card's words are held
// to the map's, and every status's name to its words, so a renamed map line cannot leave either figure stale.
//
//   bun solid/figure-planning.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Layout } from "./src/figure/registry.ts";
import { CELL_WIDTH, layoutOf, PADDING_X } from "./src/figure/kinds.ts";
import { check, parse, type Spec } from "./src/figure/spec.ts";
import { cellWidth } from "./src/figure/text.ts";

const { capture } = await import("./dump.ts");
const { format } = await import("./src/format.ts");

const SPECS = ["timeline", "statusKey", "nowNextLater"] as const;
type Name = (typeof SPECS)[number];
const GOLDENS: Record<Name, string> = {
  timeline: "figure-timeline",
  statusKey: "figure-status-key",
  nowNextLater: "figure-now-next-later",
};
const HALF_CELL = 0.5;
let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));
const spec = (name: Name): Spec => {
  const parsed = parse(readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/${name}.json: ${parsed.problems.join(" ")}`);
  return parsed.spec;
};
const cells = (text: string) => [...text].length;
/** The map as one line: the figures' words are the map's, and its prose wraps. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

interface Cmd {
  element: string | null;
  type: string;
  box: number[];
  text?: string;
  color?: number[];
}
const commandOf = (dump: { commands: Cmd[] }, id: string) => dump.commands.find((c) => c.element === id);
const rowOf = (box: number[]) => Math.round(box[1]! / 16);
function rowsOfFrame(dump: { commands: Cmd[] }): string[] {
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const c of dump.commands)
    if (c.type === "text" && c.text !== undefined) {
      const row = rowOf(c.box);
      const parts = rows.get(row) ?? [];
      parts.push({ x: c.box[0]!, text: c.text });
      rows.set(row, parts);
    }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(" "))
    .map((line) => line.replace(/\s+/g, " ").trim());
}
const stripDots = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map(stripDots)
    .filter(Boolean);
}

const work = mkdtempSync(join(tmpdir(), "cssints-figure-planning-"));

// ---- (a) the timeline's bars: a row's bar starts and ends at the cells its span says, in cells ----------------------
const timeline = spec("timeline");
if (timeline.kind !== "timeline") throw new Error("timeline.json is not a timeline");
const timelineLayout = layoutOf(timeline);
const timelineDump = await capture("figure", undefined, { spec: timeline, warm: 2 });
{
  const width = timeline.options?.width ?? 40;
  const from = timeline.options?.start ?? Math.min(0, ...timeline.data.map((row) => row.start));
  const to = timeline.options?.end ?? Math.max(...timeline.data.map((row) => row.end), from + 1);
  const unit = timeline.options?.unit ?? "";
  const labelWidth = Math.max(...timeline.data.map((row) => cellWidth(row.label))) + 1;
  const cellOf = (value: number) => Math.round(((value - from) * width) / (to - from));
  let worst = 0;
  let worstAt = "";
  let off = 0;
  timeline.data.forEach((row, i) => {
    // a label is a text in a cell of its own, and a cell with no fill draws no command: the row's first cell is the
    // figure's own padding, so the row's axis starts there plus the label column
    const fill = commandOf(timelineDump, `fig-fill-${i}`);
    if (!fill) {
      bad(`timeline: ${row.label}`, `the frame has no fig-fill-${i}`);
      return;
    }
    const start = Math.max(0, Math.min(width, cellOf(row.start)));
    const end = Math.max(start, Math.min(width, cellOf(row.end)));
    // the bar's left edge is the padding, the label's cells and the span's offset; its width is the span in cells
    const at = (fill.box[0]! - (PADDING_X + labelWidth + start) * CELL_WIDTH) / CELL_WIDTH;
    const length = (fill.box[2]! - (end - start) * CELL_WIDTH) / CELL_WIDTH;
    const error = Math.max(Math.abs(at), Math.abs(length));
    if (error >= worst) (worst = error), (worstAt = row.label);
    if (error > HALF_CELL) off++;
    const words = timelineDump.commands.find((c) => c.type === "text" && c.text === timelineLayout.bars[i]!.text);
    if (!words)
      bad(`timeline: ${row.label}'s numbers`, `no text command reads ${JSON.stringify(timelineLayout.bars[i]!.text)}`);
  });
  if (!off)
    ok("timeline: the bars", `${timeline.data.length} rows, each bar at its span's cells (worst ${worst.toFixed(2)} of a cell: ${worstAt})`);
  else bad("timeline: the bars", `${off} row(s) are not where their spans say (worst ${worst.toFixed(2)} cells: ${worstAt})`);

  // the axis's ends: the first and the last step under the axis's own first and last cells, laid out as cells (a space
  // is an item, not a character: a proportional space would drift off the row's cells)
  const startWord = `${from}${unit}`;
  const endWord = `${to}${unit}`;
  const axisStart = timelineDump.commands.find((c) => c.type === "text" && c.text === startWord);
  const axisEnd = timelineDump.commands.find((c) => c.type === "text" && c.text === endWord);
  const startAt = (PADDING_X + labelWidth) * CELL_WIDTH;
  const endAt = (PADDING_X + labelWidth + width - cells(endWord)) * CELL_WIDTH;
  const aligned = axisStart?.box[0] === startAt && axisEnd?.box[0] === endAt && axisStart.box[1] === axisEnd.box[1];
  if (aligned)
    ok("timeline: the axis's labels", `${JSON.stringify(startWord)} at its first cell, ${JSON.stringify(endWord)} at its last`);
  else
    bad(
      "timeline: the axis's labels",
      `${JSON.stringify([axisStart?.box, axisEnd?.box])} for ${startAt} and ${endAt}`,
    );
}

// ---- (b) the status key: an entry a status the figures use, and none they do not ------------------------------------
const key = spec("statusKey");
if (key.kind !== "statusKey") throw new Error("statusKey.json is not a statusKey");
const keyDump = await capture("figure", undefined, { spec: key, warm: 2 });
{
  const declared = [...(key.options?.used ?? [])].sort();
  const named = key.data.map((entry) => entry.label).sort();
  if (declared.join(", ") === named.join(", "))
    ok("statusKey: the entries", `${named.length} statuses, the declared set (${named.join(", ")})`);
  else bad("statusKey: the entries", `${JSON.stringify(named)} is not the declared ${JSON.stringify(declared)}`);
  const used = new Set(timeline.data.map((row) => row.status).filter((status): status is string => !!status));
  const missing = [...used].filter((status) => !named.includes(status));
  if (!missing.length)
    ok("statusKey: the statuses a figure uses", `${[...used].sort().join(", ")} — each has a row (the timeline's own)`);
  else bad("statusKey: the statuses a figure uses", `${missing.join(", ")} have no row`);
  const drawn = key.data.every(
    (entry) =>
      keyDump.commands.some((c) => c.type === "text" && c.text === entry.label) &&
      keyDump.commands.some((c) => c.type === "text" && c.text === entry.sentence) &&
      commandOf(keyDump, `fig-mark-${key.data.indexOf(entry)}`) !== undefined,
  );
  if (drawn) ok("statusKey: the rows", "a mark, the word and the sentence, one row a status");
  else bad("statusKey: the rows", "a row is missing its mark, its word or its sentence");
  const marks = key.data.map((_, i) => commandOf(keyDump, `fig-mark-${i}`));
  const rows = new Set(marks.map((mark) => mark?.box[1]));
  if (marks.every((mark) => mark && mark.box[2] === CELL_WIDTH) && rows.size === key.data.length)
    ok("statusKey: the marks", `${marks.length} one-cell marks, one a row`);
  else bad("statusKey: the marks", `${JSON.stringify(marks.map((mark) => mark?.box))} for one cell a status`);
}

// ---- (c) the board: three columns, the cards' count and their order --------------------------------------------------
const board = spec("nowNextLater");
if (board.kind !== "nowNextLater") throw new Error("nowNextLater.json is not a nowNextLater");
const boardLayout = layoutOf(board);
const boardDump = await capture("figure", undefined, { spec: board, warm: 2 });
{
  const columns = ["now", "next", "later"] as const;
  let wrong = 0;
  columns.forEach((column, c) => {
    const cards = board.data[column];
    const segments = boardLayout.boxes.filter((box) => box.id.startsWith(`fig-card-${c}-`));
    const indexes = new Set(segments.map((box) => Number(box.id.split("-")[3])));
    if (indexes.size !== cards.length) {
      bad(`nowNextLater: the ${column} column`, `${indexes.size} cards drawn for the data's ${cards.length}`);
      wrong++;
      return;
    }
    const texts = cards.map((card, i) => {
      const parts = segments
        .filter((box) => Number(box.id.split("-")[3]) === i)
        .sort((a, b) => Number(a.id.split("-")[4]) - Number(b.id.split("-")[4]))
        .map((box) => box.text);
      // a wrap at a slash joins without a space, as the words read: "`aria-controls`/" then "`describedBy`"
      return parts.reduce(
        (text, part) => (text === "" ? part : text.endsWith("/") ? text + part : `${text} ${part}`),
        "",
      );
    });
    const same = texts.every((text, i) => text === cards[i]);
    const framed = segments.every((box) => boardDump.commands.some((c) => c.type === "text" && c.text === box.text));
    if (same && framed)
      ok(`nowNextLater: the ${column} column`, `${cards.length} card(s), the data's order and words, each text in the frame`);
    else {
      bad(`nowNextLater: the ${column} column`, `${JSON.stringify(texts)} is not ${JSON.stringify(cards)} (frame ${framed})`);
      wrong++;
    }
    // the cards' rows run down the frame: the first segment of each card is lower than the one above it
    const topOf = (text: string) => boardDump.commands.find((c) => c.type === "text" && c.text === text)?.box[1];
    const tops = cards.map((_, i) => {
      const first = segments
        .filter((box) => Number(box.id.split("-")[3]) === i)
        .sort((a, b) => Number(a.id.split("-")[4]) - Number(b.id.split("-")[4]))[0];
      return first ? topOf(first.text) : undefined;
    });
    if (tops.every((top, i) => i === 0 || (top !== undefined && top >= tops[i - 1]!)))
      ok(`nowNextLater: the ${column} order`, "each card's first line is below the one above it");
    else {
      bad(`nowNextLater: the ${column} order`, JSON.stringify(tops));
      wrong++;
    }
  });
  // the three columns are side by side, not stacked: the header texts are on one row and their x grows
  const heads = columns.map((column) => boardDump.commands.find((c) => c.type === "text" && c.text === column.toUpperCase()));
  if (heads.every((head) => head?.box[1] === heads[0]?.box[1]) && heads.every((head, c) => c === 0 || head!.box[0]! > heads[c - 1]!.box[0]!))
    ok("nowNextLater: the columns", `${heads.map((head) => head?.text).join(", ")} — three headings on one row`);
  else bad("nowNextLater: the columns", JSON.stringify(heads.map((head) => head?.box)));
  if (!wrong) ok("nowNextLater: the board", "every column holds its cards, in the data's order");
}

// ---- (d) the hand-written specs are the map's words: a renamed Left: line or status cannot leave a figure stale ------
{
  const map = flat(readFileSync(new URL("../docs/map.md", import.meta.url), "utf8"));
  const lost = board.data.next.concat(board.data.now, board.data.later).filter((card) => !map.includes(flat(card)));
  if (!lost.length)
    ok("nowNextLater: the map's words", `${board.data.now.length + board.data.next.length + board.data.later.length} cards, each a fragment of a Left: line`);
  else bad("nowNextLater: the map's words", `not in native/docs/map.md: ${JSON.stringify(lost)}`);
  const statuses = key.data.filter((entry) => !map.toLowerCase().includes(entry.label.toLowerCase()));
  if (!statuses.length) ok("statusKey: the map's words", `${key.data.map((entry) => entry.label).join(", ")} — each a word the map uses`);
  else bad("statusKey: the map's words", `not in native/docs/map.md: ${JSON.stringify(statuses.map((entry) => entry.label))}`);
  const steps = timeline.data.filter((row) => !map.includes(flat(row.label)));
  if (!steps.length) ok("timeline: the map's steps", `${timeline.data.length} labels, each a step's own words`);
  else bad("timeline: the map's steps", `not in native/docs/map.md: ${JSON.stringify(steps.map((row) => row.label))}`);
}

// ---- (e) the command goldens: the same capture, stored as solid/goldens/<name>.json ---------------------------------
for (const name of SPECS) {
  const s = spec(name);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const golden = readFileSync(new URL(`./goldens/${GOLDENS[name]}.json`, import.meta.url), "utf8").trim();
  const got = format({ commands: dump.commands, effects: dump.effects });
  if (got === golden) ok(`${name}: the golden`, `solid/goldens/${GOLDENS[name]}.json, every command field identical`);
  else {
    const at = got.split("\n").findIndex((line, i) => line !== golden.split("\n")[i]);
    bad(
      `${name}: the golden`,
      `solid/goldens/${GOLDENS[name]}.json differs at line ${at + 1}: ` +
        `${JSON.stringify(got.split("\n")[at])} is not ${JSON.stringify(golden.split("\n")[at])}`,
    );
  }
}

// ---- (f) the same spec on the terminal: the cells' rows are the pixel figure's rows ---------------------------------
for (const name of SPECS) {
  const s = spec(name);
  const l: Layout = layoutOf(s);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const pixel = rowsOfFrame(dump).map(stripDots);
  const rows = l.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2;
  const out = join(work, `${name}.txt`);
  const run = spawnSync(
    "bun",
    ["terminal/solid.ts", "--page", "figure", "--spec", new URL(`./specs/${name}.json`, import.meta.url).pathname,
      "--cols", "80", "--rows", String(rows), "--dump", out],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  if (run.status !== 0) {
    bad(`${name}: the terminal`, `exit ${run.status}: ${run.stderr.trim()}`);
    continue;
  }
  const cellsRows = rowsOfCells(readFileSync(out, "utf8"));
  let differ = -1;
  for (let i = 0; i < cellsRows.length && i < pixel.length; i++)
    if (cellsRows[i] !== pixel[i]) {
      differ = i;
      break;
    }
  if (cellsRows.length !== pixel.length)
    bad(`${name}: the terminal's rows`, `${cellsRows.length} rows, the pixel figure's ${pixel.length}`);
  else if (differ >= 0)
    bad(`${name}: the terminal's rows`, `row ${differ + 1}: ${JSON.stringify(cellsRows[differ])} is not ${JSON.stringify(pixel[differ])}`);
  else ok(`${name}: the terminal's rows`, `${cellsRows.length} rows, the pixel figure's words (cells, not pixels)`);
}

// ---- (g) `check`'s refusals, with their sentences -------------------------------------------------------------------
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((p) => p === sentence || p.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
refuses(
  "a span that ends before it starts",
  { kind: "timeline", source: "Sample", data: [{ label: "build", start: 3, end: 1 }] },
  "build ends at 1 before it starts at 3.",
);
refuses(
  "a timeline row with no label",
  { kind: "timeline", source: "Sample", data: [{ start: 0, end: 1 }] },
  "Row 1 needs a label: a step is a word, not nothing.",
);
refuses(
  "a date out of order",
  {
    kind: "timeline",
    source: "Sample",
    data: [{ label: "design", start: 0, end: 1, date: "2026-10-31" }, { label: "build", start: 1, end: 2, date: "2026-10-19" }],
  },
  "build's date 2026-10-19 is before design's 2026-10-31: dates run down the rows.",
);
refuses(
  "a timeline longer than its width",
  { kind: "timeline", source: "Sample", data: [{ label: "research", start: 0, end: 9 }], options: { width: 48, start: 0, end: 8 } },
  "research ends at cell 54, past the timeline's 48 cells (options.width).",
);
refuses(
  "a board with an empty column",
  { kind: "nowNextLater", data: { now: ["Export to CSV"], next: ["Saved views"], later: [] } },
  "The later column has no card: every column needs one.",
);
refuses(
  "a status key naming a status no figure uses",
  { kind: "statusKey", data: [{ label: "Shipped", sentence: "the thing left the door" }], options: { used: ["Done", "Left"] } },
  "Shipped is not a status any figure here uses: the declared ones are Done, Left.",
);
refuses(
  "a status key row with no sentence",
  { kind: "statusKey", data: [{ label: "Done" }], options: { used: ["Done"] } },
  "Done needs a sentence: what the status means here.",
);

if (failed) {
  console.error(`solid/figure-planning.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure-planning.test.ts: ${checks} checks, three planning kinds (timeline, statusKey, nowNextLater)`);
