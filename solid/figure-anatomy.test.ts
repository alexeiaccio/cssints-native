// The anatomy kind, read back from the page and from its own frame: a component drawing is a page's captured frame cut to
// one region, with numbered callouts and a legend. The test is the kind's honesty:
//
//   (a) the spec's boxes and texts are the page's own capture, command for command (regenerate with specs/from-page.ts);
//   (b) the crop's cells are `round(crop/8, /16)`, a box crossing the edge is clipped and moved to the crop's corner, the
//       page's own background is dropped (it is the window, not a component), and a box under 2x1 cells is not drawn;
//   (c) every callout's digit is at `round((x-crop.x)/8)`, `round((y-crop.y)/16)` and replaces exactly that cell — the
//       rest of the row is the wireframe's own characters, so the drawing under the numbers is the page's;
//   (d) the legend is one line a callout, in the parts' order, its number and its words;
//   (e) the refusals, in their sentences;
//   (f) the same figure on the terminal, row for row, and its command golden on the desktop;
//   (g) the mutations: a callout rounded from the page instead of the crop, one a row out, and the background kept.
//
// The frames come from `solid/dump.ts`'s `capture` — the same call the goldens and `specs/from-page.ts` use — so this
// reads the page, not the spec's claim about it.
//
//   bun solid/figure-anatomy.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture } = await import("./dump.ts");
const { CELL_HEIGHT, CELL_WIDTH, PADDING_X, PADDING_Y, layoutOf } = await import("./src/figure/kinds.ts");
const { frameOf, wireframeOf } = await import("./src/figure/kinds/wireframe.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { format } = await import("./src/format.ts");
const { cellWidth, render } = await import("./src/figure/text.ts");

import type { AnatomyCrop, AnatomySpec, WireBox, WireSide } from "./src/figure/spec.ts";

interface Cmd {
  type: string;
  box: number[];
  text?: string;
}
interface Dump {
  commands: Cmd[];
  effects: unknown;
  size: [number, number];
}

const spec: AnatomySpec = (() => {
  const parsed = parse(readFileSync(new URL("./specs/anatomy.json", import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/anatomy.json: ${parsed.problems.join(" ")}`);
  return parsed.spec as AnatomySpec;
})();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const work = mkdtempSync(join(tmpdir(), "cssints-figure-anatomy-"));
const crop = spec.data.crop as AnatomyCrop;

// (a) the data is the page's own frame: the same capture the goldens are stored with, cut the way the spec says
const dump = (await capture(spec.data.page as "widgets", undefined, { width: spec.data.width, height: spec.data.height })) as Dump;
if (dump.size[0] === spec.data.width && dump.size[1] === spec.data.height)
  ok("the page", `${spec.data.page} at ${dump.size[0]}x${dump.size[1]}, the data's own size`);
else bad("the page", `the capture is ${dump.size.join("x")}, the data's ${spec.data.width}x${spec.data.height}`);
const frame = frameOf(dump.commands);
const sameFrame =
  JSON.stringify(frame.boxes) === JSON.stringify(spec.data.boxes) &&
  JSON.stringify(frame.texts) === JSON.stringify(spec.data.texts);
if (sameFrame)
  ok("the data is the frame", `${frame.boxes.length} boxes and ${frame.texts.length} texts, command for command`);
else bad("the data is the frame", "the spec's boxes/texts are not the capture's (regenerate with specs/from-page.ts)");

// (b) the crop, recomputed here: the same rule the kind states, written once in the test
const side: WireSide = { width: spec.data.width, height: spec.data.height, boxes: spec.data.boxes, texts: spec.data.texts };
const isBackground = (box: WireBox) => box.x <= 0 && box.y <= 0 && box.width >= side.width && box.height >= side.height;
function clipped(keepBackground: boolean): WireSide {
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  const boxes: WireBox[] = [];
  for (const box of side.boxes) {
    if (!keepBackground && isBackground(box)) continue;
    const x = Math.max(box.x, crop.x);
    const y = Math.max(box.y, crop.y);
    const width = Math.min(box.x + box.width, right) - x;
    const height = Math.min(box.y + box.height, bottom) - y;
    if (width <= 0 || height <= 0) continue;
    if (Math.round(width / CELL_WIDTH) < 2 || Math.round(height / CELL_HEIGHT) < 1) continue;
    boxes.push({ x: x - crop.x, y: y - crop.y, width, height });
  }
  const across = Math.max(1, Math.round(crop.width / CELL_WIDTH));
  const down = Math.max(1, Math.round(crop.height / CELL_HEIGHT));
  const texts = side.texts
    .filter((text) => {
      const col = Math.round((text.x - crop.x) / CELL_WIDTH);
      const row = Math.round((text.y - crop.y) / CELL_HEIGHT);
      return col >= 0 && col < across && row >= 0 && row < down;
    })
    .map((text) => ({ x: text.x - crop.x, y: text.y - crop.y, text: text.text }));
  return { width: crop.width, height: crop.height, boxes, texts };
}
const cut = clipped(false);
const wire = wireframeOf(cut);
const backgrounds = side.boxes.filter(isBackground).length;
if (wire.boxes.length === cut.boxes.length)
  ok(
    "the crop's boxes",
    `${wire.boxes.length} of the page's ${side.boxes.length}, at round(${crop.x},${crop.y}) ` +
      `${Math.round(crop.width / CELL_WIDTH)}x${Math.round(crop.height / CELL_HEIGHT)} cells; ` +
      `${backgrounds} page background dropped, ` +
      `${side.boxes.filter((box) => !isBackground(box)).length - cut.boxes.length} outside or under a cell`,
  );
else bad("the crop's boxes", `${wire.boxes.length} drawn for the cut's ${cut.boxes.length}`);
if (cut.texts.length)
  ok("the crop's texts", `${cut.texts.length} runs of the page's ${side.texts.length} start inside the crop`);
else bad("the crop's texts", "no run starts inside the crop");

// the grid the kind draws: the wireframe's characters with the callouts' digits stamped on it
const grid = wire.edges.map((row) => [...row]);
const wide = wire.texts.filter((text) => [...text.drawn].some((ch) => cellWidth(ch) === 2));
/** A digit on the grid the test compares with: one cell (the spec's pages are ASCII, so no wide glyph's second cell). */
const stampOn = (row: number, col: number, digit: string): void => {
  grid[row]![col] = digit;
};
const cellOf = (part: { x: number; y: number }) => ({
  col: Math.round((part.x - crop.x) / CELL_WIDTH),
  row: Math.round((part.y - crop.y) / CELL_HEIGHT),
});
for (const text of wire.texts) {
  if (text.cols <= 0) continue;
  let col = text.col;
  for (const ch of text.drawn) {
    grid[text.row]![col] = ch;
    col += cellWidth(ch);
  }
}
const placed = spec.data.parts.map((part) => ({ part, ...cellOf(part) }));
for (const { part, col, row } of placed) stampOn(row, col, String(part.n));

// (c) the layout: the title, the drawing, a blank, the legend, the source
const layout = layoutOf(spec);
const start = spec.title ? 1 : 0;
const drawing = layout.lines.slice(start, start + wire.height);
const rowText = (line: (typeof layout.lines)[number]) =>
  line.items.map((item) => (item.kind === "text" ? item.text : " ".repeat(item.cells))).join("");
let wrong = 0;
for (let row = 0; row < wire.height; row++) {
  const drawn = rowText(drawing[row]!).replace(/\s+$/, "");
  const want = grid[row]!.join("").replace(/\s+$/, "");
  if (drawn !== want) {
    if (!wrong) bad(`row ${row + 1}`, `${JSON.stringify(drawn)} is not ${JSON.stringify(want)}`);
    wrong++;
  }
}
if (!wrong)
  ok(
    "the drawing is the page's",
    `${wire.height} rows of ${wire.width} cells: the wireframe's characters, the callouts' digits over them; ` +
      `${wide.length} wide glyph(s)`,
  );
else bad("the drawing is the page's", `${wrong} of ${wire.height} rows differ`);
let misplaced = 0;
for (const { part, col, row } of placed) {
  const drawn = rowText(drawing[row] ?? { items: [] });
  if (drawn[col] !== String(part.n)) {
    misplaced++;
    if (misplaced === 1)
      bad(
        `callout ${part.n}`,
        `its digit is at ${part.x},${part.y} → ${col},${row}, which draws ${JSON.stringify(drawn[col] ?? "")}`,
      );
  }
}
if (!misplaced)
  ok(
    "the callouts' cells",
    `${placed.length} digits at round((x-${crop.x})/8), round((y-${crop.y})/16), one each ` +
      `(${placed.map((p) => `${p.part.n}@${p.col},${p.row}`).join(" ")})`,
  );
else bad("the callouts' cells", `${misplaced} of ${placed.length} digits are not at their cells`);
const accents = drawing.flatMap((line) =>
  line.items.filter((item) => item.kind === "text" && item.paint === "good" && item.role === "value"),
);
if (accents.length === placed.length)
  ok("the callouts' paint", `${accents.length} accents, one a digit, on a figure of ${layout.lines.length} lines`);
else bad("the callouts' paint", `${accents.length} accented runs for ${placed.length} callouts`);

// (d) the legend: a digit, a space, the words, one line a part, in the parts' order
const legend = layout.lines.slice(start + wire.height + 1, start + wire.height + 1 + placed.length);
const blank = layout.lines[start + wire.height];
const legends = legend.map((line) => line.items.map((item) => (item.kind === "text" ? item.text : "")).join(""));
const wanted = spec.data.parts.map((part) => `${part.n} ${part.label}`);
if (JSON.stringify(legends) === JSON.stringify(wanted))
  ok("the legend", `${legends.length} lines, one a callout: ${JSON.stringify(legends[0])}`);
else bad("the legend", `${JSON.stringify(legends)} is not ${JSON.stringify(wanted)}`);
if (blank && blank.items.every((item) => item.kind === "space"))
  ok("the legend's gap", "one blank line between the drawing and the numbers");
else bad("the legend's gap", "the drawing and the legend are not separated by a blank line");

// (e) the refusals, in their sentences
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((problem) => problem === sentence || problem.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const source = "Sample: a captured frame";
const withData = (data: unknown) => ({ kind: "anatomy", source, data });
refuses(
  "a page this repository does not have",
  withData({ ...clone(spec.data), page: "pieChart" }),
  'A wireframe\'s page is one this repository draws — dialog, list, sensors, sheet, sky, widgets — not "pieChart".',
);
refuses(
  "a crop outside the page",
  withData({ ...clone(spec.data), crop: { x: 300, y: 700, width: 296, height: 120 } }),
  "The crop 300,700 296x120 is not a region of the 360x760 page: a crop starts inside the page and ends inside it.",
);
refuses(
  "no parts",
  withData({ ...clone(spec.data), parts: [] }),
  'An anatomy needs its numbered parts: [ { "n": 1, "x": 40, "y": 76, "label": "the button" } ].',
);
refuses(
  "a number that is not one digit",
  withData({ ...clone(spec.data), parts: [{ n: 12, x: 40, y: 72, label: "the button" }] }),
  "Callout 12 needs a number from 1 to 9: one cell holds one digit.",
);
refuses(
  "a callout outside the crop",
  withData({ ...clone(spec.data), parts: [{ n: 2, x: 10, y: 56, label: "outside" }] }),
  "Callout 2 is at 10,56, outside the crop 32,56 296x120: a number is drawn on the drawing.",
);
refuses(
  "two callouts on one cell",
  withData({ ...clone(spec.data), parts: [{ n: 1, x: 32, y: 72, label: "a" }, { n: 2, x: 32, y: 72, label: "b" }] }),
  "Callout 1 and callout 2 share the drawing's cell 0,1: move one of them.",
);
refuses(
  "a crop wider than options.width",
  { kind: "anatomy", source, data: clone(spec.data), options: { width: 30 } },
  "The crop is 296px wide, 37 cells, but options.width is 30: draw it in a narrower figure or raise options.width.",
);

// (f) the pixel frame: its commands, its golden, and the terminal's rows
const figureFrame = (await capture("figure", undefined, { spec, warm: 2 })) as Dump;
const golden = readFileSync(new URL("./goldens/figure-anatomy.json", import.meta.url), "utf8").trim();
const got = format({ commands: figureFrame.commands, effects: figureFrame.effects });
if (got === golden) ok("the golden", "solid/goldens/figure-anatomy.json, every command field identical");
else {
  const at = got.split("\n").findIndex((text, i) => text !== golden.split("\n")[i]);
  bad("the golden", `solid/goldens/figure-anatomy.json differs at line ${at + 1}: ${JSON.stringify(got.split("\n")[at])}`);
}

/** The frame's rows as characters, each text command at its own cell column. */
function rowsOfFrame(dump: Dump): string[] {
  const rows = new Map<number, Cmd[]>();
  for (const command of dump.commands)
    if (command.type === "text" && command.text !== undefined) {
      const row = Math.round(command.box[1]! / CELL_HEIGHT);
      const parts = rows.get(row) ?? [];
      parts.push(command);
      rows.set(row, parts);
    }
  return [...rows.entries()]
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

/** The terminal's dump as rows: above the colour table, dots and runs of blanks dropped (figure.test.ts's reading). */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map((line) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const normalise = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
const rows = layout.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2 * PADDING_Y;
const cols = Math.max(80, layout.width + 2 * PADDING_X);
const out = join(work, "anatomy.txt");
const run = spawnSync(
  "bun",
  [
    "terminal/solid.ts", "--page", "figure",
    "--spec", new URL("./specs/anatomy.json", import.meta.url).pathname,
    "--cols", String(cols), "--rows", String(rows), "--dump", out,
  ],
  { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
);
if (run.status !== 0) bad("the terminal", `exit ${run.status}: ${run.stderr.trim()}`);
else {
  const cells = rowsOfCells(readFileSync(out, "utf8"));
  const pixel = rowsOfFrame(figureFrame).map(normalise).filter(Boolean);
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
const fence = Math.max(80, layout.width + 2 * PADDING_X);
const text = render(spec, { width: fence }).split("\n");
if (text[0] === spec.title && text.every((line) => cellWidth(line) <= fence))
  ok("the text half", `${text.length} lines, the title first, the widest ${Math.max(...text.map(cellWidth))} cells`);
else bad("the text half", `the first line is ${JSON.stringify(text[0])}`);

// (g) the mutations
// a callout rounded from the page instead of the crop lands at the page's own column: the digit is not at its cell
const first = spec.data.parts[0]!;
const pageCol = Math.round(first.x / CELL_WIDTH);
const cropCol = Math.round((first.x - crop.x) / CELL_WIDTH);
if (pageCol !== cropCol)
  ok(
    "mutation: a callout rounded from the page",
    `${first.x}px is cell ${pageCol} of the page and ${cropCol} of the crop: the crop's origin is not optional`,
  );
else bad("mutation: a callout rounded from the page", `${first.x}px rounds to ${pageCol} either way`);
// one row out: the digit lands on the row below, where the drawing's own character is
const oneRow = Math.round((first.y + CELL_HEIGHT - crop.y) / CELL_HEIGHT);
if (oneRow === Math.round((first.y - crop.y) / CELL_HEIGHT) + 1)
  ok("mutation: a callout a row out", `y+${CELL_HEIGHT} is row ${oneRow}, not ${oneRow - 1}`);
else bad("mutation: a callout a row out", `y+${CELL_HEIGHT} did not move the row`);
// the background kept: the page's own rectangle rings the crop, and the box count says so
const kept = clipped(true);
if (backgrounds === 1 && kept.boxes.length === cut.boxes.length + 1)
  ok(
    "mutation: the background kept",
    `${kept.boxes.length} boxes instead of ${cut.boxes.length}: the page's own rectangle would ring the crop`,
  );
else bad("mutation: the background kept", `${backgrounds} backgrounds, ${kept.boxes.length} boxes against ${cut.boxes.length}`);

console.log(`\n${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
