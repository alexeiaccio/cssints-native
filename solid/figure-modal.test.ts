// The modal kind, read back from the Dialog and from its own frame: the page with the dialog open, cut to the cell grid
// exactly as a screen is, plus the panel's box under the drawing. The test is the kind's honesty:
//
//   (a) the spec's boxes and texts are a fresh capture of the Dialog with the same keys and settle, command for command;
//   (b) the panel the spec names is the frame's `settings-dialog` rectangle, and its cell rect is one of the wireframe's
//       boxes — a modal's panel is what the frame drew;
//   (c) the drawing is the wireframe's own characters (the box and text placement rounded to cells) with the panel's
//       note under it, and the text half is the same layout;
//   (d) the refusals, in their sentences;
//   (e) the command golden on the desktop and the terminal's rows.
//
//   bun solid/figure-modal.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture } = await import("./dump.ts");
const { CELL_HEIGHT, CELL_WIDTH, PADDING_X, PADDING_Y, layoutOf } = await import("./src/figure/kinds.ts");
const { cellBox, frameOf, wireframeOf } = await import("./src/figure/kinds/wireframe.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { format } = await import("./src/format.ts");
const { cellWidth, render } = await import("./src/figure/text.ts");

import type { ModalSpec } from "./src/figure/spec.ts";

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

const spec: ModalSpec = (() => {
  const parsed = parse(readFileSync(new URL("./specs/modal.json", import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/modal.json: ${parsed.problems.join(" ")}`);
  return parsed.spec as ModalSpec;
})();

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const work = mkdtempSync(join(tmpdir(), "cssints-figure-modal-"));

// (a) the data is the Dialog's frame, captured with the same keys: the same call the goldens are stored with
const dump = (await capture("dialog", undefined, { keys: [...spec.data.keys], settle: spec.data.settle })) as Dump;
if (dump.size[0] === spec.data.width && dump.size[1] === spec.data.height)
  ok("the page", `dialog at ${dump.size[0]}x${dump.size[1]}, the data's own size`);
else bad("the page", `the capture is ${dump.size.join("x")}, the data's ${spec.data.width}x${spec.data.height}`);
const frame = frameOf(dump.commands);
const sameFrame =
  JSON.stringify(frame.boxes) === JSON.stringify(spec.data.boxes) &&
  JSON.stringify(frame.texts) === JSON.stringify(spec.data.texts);
if (sameFrame) ok("the data is the frame", `${frame.boxes.length} boxes and ${frame.texts.length} texts, command for command`);
else bad("the data is the frame", "the spec's boxes/texts are not the capture's (regenerate with specs/from-frames.ts)");

// (b) the panel: the dialog's own rectangle, and a box of the drawing
const panel = dump.commands.find((c) => c.element === "settings-dialog" && c.type === "rectangle");
const samePanel =
  panel &&
  panel.box[0] === spec.data.panel.x &&
  panel.box[1] === spec.data.panel.y &&
  panel.box[2] === spec.data.panel.width &&
  panel.box[3] === spec.data.panel.height;
if (samePanel)
  ok("the panel", `settings-dialog at ${spec.data.panel.x},${spec.data.panel.y} ${spec.data.panel.width}x${spec.data.panel.height}`);
else bad("the panel", `the frame's settings-dialog is ${JSON.stringify(panel?.box)}, the data's ${JSON.stringify(spec.data.panel)}`);
const wire = wireframeOf(spec.data);
const panelCells = cellBox(spec.data.panel);
const drawn = wire.boxes.find(
  (box) => box.col === panelCells.col && box.row === panelCells.row && box.cols === panelCells.cols && box.rows === panelCells.rows,
);
if (drawn)
  ok(
    "the panel's cells",
    `${panelCells.col},${panelCells.row} ${panelCells.cols}x${panelCells.rows} at 1/8 scale, one of the ${wire.boxes.length} boxes drawn`,
  );
else bad("the panel's cells", `${JSON.stringify(panelCells)} is not one of the wireframe's boxes`);

// (c) the drawing: the wireframe's characters in the layout's rows, then the panel's note
const layout = layoutOf(spec);
const start = spec.title ? 1 : 0;
const lines = layout.lines.slice(start, start + wire.height);
const grid = wire.edges.map((row) => [...row]);
// the wireframe's own rule (lineOf): a row is walked from column 1, a run at the column it starts on is drawn and the
// walk jumps its cells — so two runs that round to overlapping cells show the first, as the layout's item does
for (let row = 0; row < wire.height; row++) {
  const starts = new Map(wire.texts.filter((text) => text.row === row && text.cols > 0).map((text) => [text.col, text]));
  let col = 0;
  while (col < wire.width) {
    const run = starts.get(col);
    if (run) {
      for (const ch of run.drawn) {
        grid[row]![col] = ch;
        col += cellWidth(ch);
      }
      continue;
    }
    col++;
  }
}
const rowText = (line: (typeof layout.lines)[number]) =>
  line.items.map((item) => (item.kind === "text" ? item.text : " ".repeat(item.cells))).join("");
let wrong = 0;
for (let row = 0; row < wire.height; row++) {
  const got = rowText(lines[row]!).replace(/\s+$/, "");
  const want = grid[row]!.join("").replace(/\s+$/, "");
  if (got !== want) {
    if (!wrong) bad(`row ${row + 1}`, `${JSON.stringify(got)} is not ${JSON.stringify(want)}`);
    wrong++;
  }
}
if (!wrong) ok("the drawing is the frame's", `${wire.height} rows of ${wire.width} cells: the page's boxes and runs, rounded to cells`);
else bad("the drawing is the frame's", `${wrong} of ${wire.height} rows differ`);
const note = rowText(layout.lines[start + wire.height]!);
const wantNote = `the panel ${Math.round(spec.data.panel.width)}x${Math.round(spec.data.panel.height)} at ${Math.round(spec.data.panel.x)},${Math.round(spec.data.panel.y)}`;
if (note === wantNote) ok("the panel's note", `"${note}" under the drawing`);
else bad("the panel's note", `${JSON.stringify(note)} is not ${JSON.stringify(wantNote)}`);

// (d) the refusals, in their sentences
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((problem) => problem === sentence || problem.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const source = "Sample: the Dialog, open";
refuses(
  "a page that is not the Dialog",
  { kind: "modal", source, data: { ...clone(spec.data), page: "widgets" } },
  'A modal is the Dialog\'s open frame: "page" is "dialog", not "widgets".',
);
refuses("no keys", { kind: "modal", source, data: { ...clone(spec.data), keys: [] } }, 'A modal needs the keys its frame is taken with: ["Tab", "Enter"].');
refuses(
  "a panel the frame did not draw",
  { kind: "modal", source, data: { ...clone(spec.data), panel: { x: 1, y: 2, width: 3, height: 4 } } },
  "The modal's panel 1,2 3x4 is not one of its frame's boxes: a modal's panel is what the frame drew.",
);

// (e) the golden and the terminal's rows
const figureFrame = (await capture("figure", undefined, { spec, warm: 2 })) as Dump;
const golden = readFileSync(new URL("./goldens/figure-modal.json", import.meta.url), "utf8").trim();
const got = format({ commands: figureFrame.commands, effects: figureFrame.effects });
if (got === golden) ok("the golden", "solid/goldens/figure-modal.json, every command field identical");
else {
  const at = got.split("\n").findIndex((text, i) => text !== golden.split("\n")[i]);
  bad("the golden", `solid/goldens/figure-modal.json differs at line ${at + 1}: ${JSON.stringify(got.split("\n")[at])}`);
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
const normalise = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
const rows = layout.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2 * PADDING_Y;
const cols = Math.max(80, layout.width + 2 * PADDING_X);
const out = join(work, "modal.txt");
const run = spawnSync(
  "bun",
  [
    "terminal/solid.ts", "--page", "figure",
    "--spec", new URL("./specs/modal.json", import.meta.url).pathname,
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

console.log(`\n${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
