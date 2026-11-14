// The easingTable kind, read back from the app's constants, from the solver and from its own frame: a row a curve, the
// class, the duration and bounce the page runs on, and the progress at 0/25/50/75/100% of its duration — which
// `solid/specs/from-motion.ts` writes by calling `solid/src/motion.ts` at those instants, not by reading a table.
//
//   (a) the rows are the app's curves: every row's duration, class and bounce is the constant in `src/animations.ts` that
//       the row names — a duration changed in a page is a failure here until the spec is regenerated;
//   (b) every progress value is the solver's at that instant, within the figure's own two places;
//   (c) the drawing is the table: the five percent columns share an x across every row, and a row's duration, bounce and
//       progress are the frame's own texts;
//   (d) the refusals, in their sentences;
//   (e) the command golden, the stored frame, the terminal's rows and the text half;
//   (f) a mutation: a progress value a point off the solver is refused with both numbers;
//   (g) a frame that differs says where: a label one character off is one glyph cell, and the diff names its box.
//
//   bun solid/figure-easing-table.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BLUR,
  CARD_ENTRY_A,
  CARD_ENTRY_Y,
  GROW,
  HOVER,
  OUT,
  OUT_SLIDE,
  SLIDE,
} from "./src/animations.ts";
import { CELL_HEIGHT, PADDING_X, PADDING_Y, layoutOf } from "./src/figure/kinds.ts";
import { EASING_POINTS, progressAt, shownValue } from "./src/figure/kinds/motion.ts";
import { check, parse, type EasingTableSpec } from "./src/figure/spec.ts";
import { format } from "./src/format.ts";
import { cellWidth, render } from "./src/figure/text.ts";
import type { Spring } from "./src/motion.ts";

const { capture } = await import("./dump.ts");

interface Cmd {
  type: string;
  element: string | null;
  box: number[];
  text?: string;
}
interface Dump {
  commands: Cmd[];
  effects: unknown;
}

const spec: EasingTableSpec = (() => {
  const parsed = parse(readFileSync(new URL("./specs/easing-table.json", import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/easing-table.json: ${parsed.problems.join(" ")}`);
  return parsed.spec as EasingTableSpec;
})();

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));
const yes = (fine: boolean, what: string, good: string, why: string) => (fine ? ok(what, good) : bad(what, why));
const work = mkdtempSync(join(tmpdir(), "cssints-figure-easing-"));

/** The app's curves, by the label the figure gives them: every row must be the constant the page runs on. */
const CURVES: Readonly<Record<string, Spring>> = {
  "the panel's entry": GROW,
  "the menu's slide": SLIDE,
  "the scrim's fade": OUT,
  "the panel's exit": OUT_SLIDE,
  "the card's entry": CARD_ENTRY_Y,
  "the card's fade": CARD_ENTRY_A,
  "a hover's fade": HOVER,
};

// (a) every row is the app's own constant: duration, class and bounce
{
  const wrong: string[] = [];
  for (const row of spec.data.rows) {
    const spring = CURVES[row.label];
    if (!spring) {
      wrong.push(`${row.label} is not one of the app's ${Object.keys(CURVES).length} curves`);
      continue;
    }
    const kind = spring.clamp ? "effect" : "spatial";
    if (row.motion.kind !== kind) wrong.push(`${row.label} is ${row.motion.kind}, the app's ${kind}`);
    if (row.motion.duration !== Math.round(spring.duration * 1000))
      wrong.push(
        `${row.label} is ${row.motion.duration}ms, the app's ${Math.round(spring.duration * 1000)}ms`,
      );
    if (row.motion.kind === "spatial" && row.motion.bounce !== spring.bounce)
      wrong.push(`${row.label}'s bounce is ${row.motion.bounce}, the app's ${spring.bounce}`);
  }
  yes(
    !wrong.length,
    "the rows are the app's constants",
    `${spec.data.rows.length} curves from src/animations.ts: ${spec.data.rows
      .map((row) => `${row.label} ${row.motion.kind} ${row.motion.duration}ms`)
      .join("; ")}`,
    wrong.join("; "),
  );
}

// (b) every progress value is the solver's at that instant
{
  let worst = 0;
  let values = 0;
  const wrong: string[] = [];
  for (const row of spec.data.rows) {
    EASING_POINTS.forEach((point, p) => {
      values++;
      const want = progressAt(row.motion, point);
      worst = Math.max(worst, Math.abs(want - row.progress[p]!));
      if (Math.abs(want - row.progress[p]!) > 0.011)
        wrong.push(`${row.label} at ${point}%: ${row.progress[p]}, the solver's ${want.toFixed(3)}`);
    });
  }
  yes(
    !wrong.length,
    "the progress is the solver's",
    `${values} values, worst ${worst.toFixed(4)}% off Track.at at its own instant`,
    wrong.join("; "),
  );
}

// (c) the drawing: the table's columns share an x, and a row's numbers are the frame's texts
const layout = layoutOf(spec);
const dump = (await capture("figure", undefined, { spec, warm: 2 })) as Dump;
{
  const texts = dump.commands.filter((command) => command.type === "text");
  const at = (text: string) => texts.find((command) => command.text?.trim() === text);
  const columns = EASING_POINTS.map((point) => at(`${point}%`)?.box[0]);
  const missing = columns.filter((x) => x === undefined).length;
  const rowsAligned = spec.data.rows.every((row) =>
    EASING_POINTS.every((_, p) => {
      const value = `${shownValue(row.progress[p]!)}%`;
      const x = columns[p];
      return x !== undefined && texts.some((command) => command.text?.trim() === value && command.box[0] === x);
    }),
  );
  const numbersDrawn = spec.data.rows.every((row) => {
    const ms = at(String(Math.round(row.motion.duration)));
    const bounce = at(
      row.motion.kind === "spatial"
        ? Number.isInteger(row.motion.bounce)
          ? String(row.motion.bounce)
          : row.motion.bounce.toFixed(2)
        : "-",
    );
    return ms !== undefined && bounce !== undefined;
  });
  const rule = texts.find((command) => /^-+$/.test(command.text?.trim() ?? ""));
  yes(
    missing === 0 && rowsAligned && numbersDrawn && rule !== undefined,
    "the drawing is the table",
    `${spec.data.rows.length} rows; the five percent columns at x ${columns.map((x) => Math.round(x ?? -1)).join(", ")}px, ` +
      `the header, the rule and a row's ms and bounce`,
    `${missing} headings missing, aligned ${rowsAligned}, numbers drawn ${numbersDrawn}, rule ${rule !== undefined}`,
  );
  const width = Math.max(...layout.lines.map((line) => line.items.reduce((n, item) => n + item.cells, 0)));
  yes(
    width <= 80,
    "the table fits a README's fence",
    `${width} of 80 cells, ${layout.lines.length} lines`,
    `${width} cells: a text half at 80 would cut it`,
  );
}

// (d) the refusals, in their sentences
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  yes(
    problems.some((problem) => problem === sentence || problem.includes(sentence)),
    `check: ${what}`,
    sentence,
    `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`,
  );
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const source = "Sample: the app's springs";
const rowOf = (i: number) => clone(spec.data.rows[i]!);
refuses(
  "a progress value that is not the solver's",
  { kind: "easingTable", source, data: { rows: [{ ...rowOf(0), progress: [0, 0, 86.85, 98.04, 100.04] }] } },
  "the panel's entry reads 0.00% at 25%, but spatial(0.22, 0.1) from 0 to 100 is at 49.40% then.",
);
refuses(
  "a row with four points",
  { kind: "easingTable", source, data: { rows: [{ ...rowOf(0), progress: [0, 49.4, 86.85, 98.04] }] } },
  "the panel's entry has 4 progress values: an easing table reads 0, 25, 50, 75, 100%.",
);
refuses(
  "a fling",
  {
    kind: "easingTable",
    source,
    data: {
      rows: [
        {
          label: "the feed's fling",
          motion: { kind: "decay", velocity: 87.03 },
          progress: [0, 49.4, 86.85, 98.04, 100.04],
        },
      ],
    },
  },
  "the feed's fling is a fling: an easing table's row is a spring's progress, and a fling has no duration to read five points of.",
);
refuses(
  "a duration of nothing",
  {
    kind: "easingTable",
    source,
    data: {
      rows: [
        {
          label: "the panel's entry",
          motion: { kind: "spatial", duration: 0, bounce: 0.1 },
          progress: [0, 49.4, 86.85, 98.04, 100.04],
        },
      ],
    },
  },
  "the panel's entry has a duration of 0ms: a spring's duration is above zero (ω = 2π / duration).",
);
refuses(
  "a label twice",
  { kind: "easingTable", source, data: { rows: [rowOf(0), rowOf(0)] } },
  "the panel's entry is two rows: one curve, one row.",
);

// (e) the golden, the stored frame and the terminal's rows
{
  const golden = readFileSync(new URL("./goldens/figure-easing-table.json", import.meta.url), "utf8").trim();
  const got = format({ commands: dump.commands, effects: dump.effects });
  if (got === golden) ok("the golden", "solid/goldens/figure-easing-table.json, every command field identical");
  else {
    const line = got.split("\n").findIndex((row, i) => row !== golden.split("\n")[i]);
    bad(
      "the golden",
      `solid/goldens/figure-easing-table.json differs at line ${line + 1}: ${JSON.stringify(got.split("\n")[line])}`,
    );
  }

  const run = spawnSync(
    "bun",
    [
      "solid/main.ts", "figure", "--spec", "solid/specs/easing-table.json",
      "--warm", "30", "--expect", "solid/frames/figure-easing-table.png",
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  yes(
    run.status === 0,
    "the stored frame",
    `solid/frames/figure-easing-table.png, ${statSync(new URL("./frames/figure-easing-table.png", import.meta.url)).size} B, identical`,
    `exit ${run.status}: ${(run.stderr || run.stdout).trim()}`,
  );

  // a frame that differs says where: one character of a label is one glyph cell, and the diff names it (a count alone
  // would send a reader through 75 KB of pixels). The numbers are the cell measured on this frame.
  {
    const wrong = join(work, "easing-table.json");
    writeFileSync(
      wrong,
      readFileSync(new URL("./specs/easing-table.json", import.meta.url), "utf8").replace(
        `"the scrim's fade"`,
        `"the scrim's fad3"`,
      ),
    );
    const actual = new URL("./frames/figure-easing-table.png.actual.png", import.meta.url);
    const miss = spawnSync(
      "bun",
      [
        "solid/main.ts", "figure", "--spec", wrong,
        "--warm", "30", "--expect", "solid/frames/figure-easing-table.png",
      ],
      { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
    );
    const message = (miss.stderr || miss.stdout).trim();
    yes(
      miss.status === 1 && /59 pixels differ in a 7x11 box at 101,98/.test(message),
      "a wrong label names its cell",
      message,
      `exit ${miss.status}: ${message}`,
    );
    rmSync(actual, { force: true });
  }

  const report = dump as unknown as { commands: Cmd[] };
  const rows = layout.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2 * PADDING_Y;
  const cols = Math.max(80, layout.width + 2 * PADDING_X);
  const out = join(work, "easing-table.txt");
  const terminal = spawnSync(
    "bun",
    [
      "terminal/solid.ts", "--page", "figure",
      "--spec", new URL("./specs/easing-table.json", import.meta.url).pathname,
      "--cols", String(cols), "--rows", String(rows), "--dump", out,
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  if (terminal.status !== 0) bad("the terminal", `exit ${terminal.status}: ${terminal.stderr.trim()}`);
  else {
    const cellRows = rowsOfCells(readFileSync(out, "utf8"));
    const pixel = rowsOfFrame(report).map(normalise).filter(Boolean);
    const differ = cellRows.findIndex((line, i) => line !== pixel[i]);
    if (cellRows.length !== pixel.length) bad("the terminal's rows", `${cellRows.length} rows, the pixel figure's ${pixel.length}`);
    else if (differ >= 0)
      bad("the terminal's rows", `row ${differ + 1}: ${JSON.stringify(cellRows[differ])} is not ${JSON.stringify(pixel[differ])}`);
    else ok("the terminal's rows", `${cellRows.length} rows, the pixel figure's words; ${cols} columns`);
  }

  const text = render(spec, { width: cols }).split("\n");
  const md = readFileSync(new URL("./specs/easing-table.json", import.meta.url), "utf8");
  yes(
    text[0] === spec.title &&
      text.every((line) => cellWidth(line) <= Math.max(80, layout.width + 2 * PADDING_X)) &&
      md.includes('"kind": "easingTable"'),
    "the text half",
    `${text.length} lines, the title first, the widest ${Math.max(...text.map(cellWidth))} cells`,
    `the first line is ${JSON.stringify(text[0])}`,
  );
}

// (f) the mutation: a progress value a point off the solver, and the check names both numbers
{
  const spec2 = clone(spec);
  const row = (spec2.data.rows[0] as { progress: number[] }).progress;
  row[1] = Math.round((row[1]! + 1) * 100) / 100;
  const sentence = spec2.data.rows[0]!.label;
  const problems = check(spec2);
  const hit = problems.find((problem) => problem.includes(sentence) && problem.includes("at 25%"));
  if (hit) ok("mutation: a progress value a point off", hit);
  else bad("mutation: a progress value a point off", `no sentence for ${sentence}: ${JSON.stringify(problems)}`);
}

/** The terminal's dump as rows: everything above the colour table, dots dropped, blank rows dropped. */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map((line) => normalise(line))
    .filter(Boolean);
}
/** The frame's rows as words: each text command at its cell, left to right. */
function rowsOfFrame(dump: Dump): string[] {
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const command of dump.commands)
    if (command.type === "text" && command.text !== undefined) {
      const row = Math.round(command.box[1]! / CELL_HEIGHT);
      const parts = rows.get(row) ?? [];
      parts.push({ x: command.box[0]!, text: command.text });
      rows.set(row, parts);
    }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" "));
}
function normalise(line: string): string {
  return line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

console.log(`\n${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
