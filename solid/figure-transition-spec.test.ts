// The transitionSpec kind, read back from the Dialog's recorded scene and from its own frame: one transition, before and
// after — the element's two boxes, the properties that move between them, and the motion's duration and delay.
//
//   (a) the scene is the recorded one: solid/scenes/dialog-menu.json's key steps are the keys the frames are taken with;
//   (b) the data is the two frames: the spec is what `transitionOf` makes of a fresh capture at the entry's start and at
//       its settle, so the boxes and the five properties are the frame's own commands, group and shadow rows;
//   (c) the two boxes are the menu's rectangles, the same size, and the offset is the difference between them;
//   (d) the duration is the longest track the Dialog's constants name, and there is no delay;
//   (e) the drawing is the transition's: the two box rows are the layout's boxes and the frame's texts, and each property
//       row and the duration are its texts;
//   (f) the refusals, in their sentences;
//   (g) the command golden, the stored frame, the terminal's rows and the text half;
//   (h) a mutation: a box resized is refused with both sizes.
//
//   bun solid/figure-transition-spec.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BLUR, GROW, OUT, SLIDE } from "./src/animations.ts";
import { CELL_HEIGHT, PADDING_X, PADDING_Y, layoutOf } from "./src/figure/kinds.ts";
import { check, parse, type TransitionSpecSpec } from "./src/figure/spec.ts";
import { format } from "./src/format.ts";
import { cellWidth, render } from "./src/figure/text.ts";
import { MENU_KEYS, SETTLE, transitionOf } from "./specs/from-frames.ts";

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

const spec: TransitionSpecSpec = (() => {
  const parsed = parse(readFileSync(new URL("./specs/transition-spec.json", import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/transition-spec.json: ${parsed.problems.join(" ")}`);
  return parsed.spec as TransitionSpecSpec;
})();

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));
const yes = (fine: boolean, what: string, good: string, why: string) => (fine ? ok(what, good) : bad(what, why));
const work = mkdtempSync(join(tmpdir(), "cssints-figure-transition-"));

// (a) the scene is the recorded one, and its key steps are the frames' keys
{
  const scene = JSON.parse(
    readFileSync(new URL("./scenes/dialog-menu.json", import.meta.url), "utf8"),
  ) as { name: string; steps: { kind: string; name: string; down: boolean }[] };
  const keys = scene.steps.filter((step) => step.kind === "key" && step.down).map((step) => step.name);
  yes(
    spec.data.scene === scene.name && keys.join(",") === MENU_KEYS.join(","),
    "the scene is the recorded one",
    `solid/scenes/${scene.name}.json, its key steps ${keys.join(", ")} are the frames' keys`,
    `the spec says ${spec.data.scene}, the scene's keys ${keys.join(", ")}, the frames' ${MENU_KEYS.join(", ")}`,
  );
}

// (b) the data is the two frames: the entry's start and its settle
const start = await capture("dialog", undefined, { keys: [...MENU_KEYS], settle: 0 });
const rest = await capture("dialog", undefined, { keys: [...MENU_KEYS], settle: SETTLE });
const again = transitionOf(start, rest, "dialog-menu", "Enter on the Zoom control");
{
  const same = JSON.stringify(again) === JSON.stringify(spec.data);
  yes(
    same,
    "the data is the two frames",
    `settle 0 and ${SETTLE} of the dialog-menu keys: the boxes and ${again.properties.length} properties are the frame's`,
    `the spec is not what specs/from-frames.ts captures (regenerate it); the capture's first box is ` +
      `${again.from.x}, ${again.from.y} ${again.from.width}x${again.from.height}`,
  );
}

// (c) the two boxes are the menu's rectangles, the same size; the offset is their difference
{
  const rect = (frame: unknown, element: string) => {
    const command = (frame as Dump).commands.find((row) => row.element === element && row.type === "rectangle");
    return command?.box;
  };
  const from = rect(start, "zoom-menu");
  const to = rect(rest, "zoom-menu");
  const sameBox = (box: number[] | undefined, data: { x: number; y: number; width: number; height: number }) =>
    box !== undefined &&
    Math.abs(box[0]! - data.x) < 0.01 &&
    Math.abs(box[1]! - data.y) < 0.01 &&
    Math.abs(box[2]! - data.width) < 0.01 &&
    Math.abs(box[3]! - data.height) < 0.01;
  const offset = spec.data.properties.find((property) => property.name === "offset y");
  yes(
    sameBox(from, spec.data.from) &&
      sameBox(to, spec.data.to) &&
      offset !== undefined &&
      Math.abs(offset.from - spec.data.from.y) < 0.01 &&
      Math.abs(offset.to - spec.data.to.y) < 0.01,
    "the two boxes are the frame's",
    `from ${spec.data.from.x}, ${spec.data.from.y} and to ${spec.data.to.x}, ${spec.data.to.y}, ` +
      `${spec.data.from.width}x${spec.data.from.height}; the offset row is the boxes' y`,
    `the frame's ${JSON.stringify(from)} and ${JSON.stringify(to)} against the spec's ${JSON.stringify(spec.data.from)}`,
  );
}

// (d) the properties are the frame's group and shadow, and the duration is the longest track
{
  const group = (frame: unknown) =>
    (frame as { effects: { groups: { element: string | null; alpha: number; scale: number; rotate: number }[] } }).effects.groups.find(
      (row) => row.element === "zoom-menu",
    );
  const shadow = (frame: unknown) =>
    (frame as { effects: { shadows: { element: string | null; blur: number }[] } }).effects.shadows.find(
      (row) => row.element === "zoom-menu",
    );
  const begin = group(start);
  const end = group(rest);
  const fieldOf = (name: string) => spec.data.properties.find((property) => property.name === name);
  // the two places the spec stores: the group's scale is a float of the packet, so 0.959999979 is 96%
  const r = (value: number) => Math.round(value * 100) / 100;
  const values = {
    alpha: [begin?.alpha ?? 255, end?.alpha ?? 255],
    scale: [r((begin?.scale ?? 1) * 100), r((end?.scale ?? 1) * 100)],
    rotate: [r(begin?.rotate ?? 0), r(end?.rotate ?? 0)],
    "shadow blur": [r(shadow(start)?.blur ?? 0), r(shadow(rest)?.blur ?? 0)],
  } as const;
  const wrong = Object.entries(values).filter(([name, [from, to]]) => {
    const property = fieldOf(name);
    return !property || Math.abs(property.from - from) > 0.011 || Math.abs(property.to - to) > 0.011;
  });
  const duration = Math.round(Math.max(SLIDE.duration, BLUR.duration, OUT.duration, GROW.duration) * 1000);
  yes(
    !wrong.length && spec.data.duration === duration && spec.data.delay === 0,
    "the properties and the duration",
    `alpha ${values.alpha.join(" -> ")}, scale ${values.scale.join(" -> ")}, rotate ${values.rotate.join(" -> ")}, ` +
      `blur ${values["shadow blur"].join(" -> ")}; ${spec.data.duration}ms (the longest of SLIDE, BLUR, OUT and GROW), ` +
      `no delay`,
    `the frame's ${JSON.stringify(values)} against the spec's ${spec.data.properties.map((property) => property.name)}`,
  );
}

// (e) the drawing: the two box rows, the property rows and the duration
const layout = layoutOf(spec);
const dump = (await capture("figure", undefined, { spec, warm: 2 })) as Dump;
{
  const texts = dump.commands.filter((command) => command.type === "text").map((command) => command.text ?? "");
  const boxesDrawn = layout.boxes.length === 2 && layout.boxes.every((box) => texts.some((text) => text.includes(box.text)));
  const rowsDrawn = spec.data.properties.every((property) =>
    texts.some((text) => text.includes(`${property.name}`) && text.includes(`${property.from}`) && text.includes(`${property.to}`)),
  );
  yes(
    boxesDrawn && rowsDrawn && texts.some((text) => text.includes(`${spec.data.duration}ms`)),
    "the drawing is the transition's",
    `two box rows (${layout.boxes.map((box) => box.role).join(", ")}), ${spec.data.properties.length} property rows and ` +
      `the duration`,
    `boxes ${boxesDrawn}, rows ${rowsDrawn}`,
  );
}

// (f) the refusals, in their sentences
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
const source = "Sample: the Dialog's menu";
const transition = (data: unknown) => ({ kind: "transitionSpec", source, data });
refuses(
  "the same box twice",
  transition({ ...clone(spec.data), to: clone(spec.data.from) }),
  "The transition's two boxes are the same box at 40, 224.16: a transition moves between two boxes.",
);
refuses(
  "two boxes of different sizes",
  transition({ ...clone(spec.data), to: { ...clone(spec.data.to), height: 120 } }),
  "The transition's two boxes are 150x133 and 150x120: the two boxes are one element's, the same size.",
);
refuses(
  "a property that does not move",
  transition({
    ...clone(spec.data),
    properties: [{ name: "alpha", from: 225, to: 225, unit: "of 255" }],
  }),
  "the menu's alpha is 225 both from and to: a property a transition changes moves.",
);
refuses(
  "a transition with no scene",
  transition({ ...clone(spec.data), scene: "" }),
  "the menu needs the scene it was recorded in (solid/scenes/dialog-menu.json), and this one names nothing.",
);
refuses(
  "a duration of nothing",
  transition({ ...clone(spec.data), duration: 0 }),
  "the menu has a duration of 0ms: a transition's duration is above zero.",
);
refuses(
  "a transition with no properties",
  transition({ ...clone(spec.data), properties: [] }),
  'the menu needs the properties that move: [{ "name": "offset y", "from": 224.16, "to": 214.16, "unit": "px" }].',
);

// (g) the golden, the stored frame, the terminal's rows and the text half
{
  const golden = readFileSync(new URL("./goldens/figure-transition-spec.json", import.meta.url), "utf8").trim();
  const got = format({ commands: dump.commands, effects: dump.effects });
  if (got === golden) ok("the golden", "solid/goldens/figure-transition-spec.json, every command field identical");
  else {
    const line = got.split("\n").findIndex((row, i) => row !== golden.split("\n")[i]);
    bad(
      "the golden",
      `solid/goldens/figure-transition-spec.json differs at line ${line + 1}: ${JSON.stringify(got.split("\n")[line])}`,
    );
  }

  const run = spawnSync(
    "bun",
    [
      "solid/main.ts", "figure", "--spec", "solid/specs/transition-spec.json",
      "--warm", "30", "--expect", "solid/frames/figure-transition-spec.png",
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  yes(
    run.status === 0,
    "the stored frame",
    `solid/frames/figure-transition-spec.png, ${statSync(new URL("./frames/figure-transition-spec.png", import.meta.url)).size} B, identical`,
    `exit ${run.status}: ${(run.stderr || run.stdout).trim()}`,
  );

  const rows = layout.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2 * PADDING_Y;
  const cols = Math.max(80, layout.width + 2 * PADDING_X);
  const out = join(work, "transition-spec.txt");
  const terminal = spawnSync(
    "bun",
    [
      "terminal/solid.ts", "--page", "figure",
      "--spec", new URL("./specs/transition-spec.json", import.meta.url).pathname,
      "--cols", String(cols), "--rows", String(rows), "--dump", out,
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  if (terminal.status !== 0) bad("the terminal", `exit ${terminal.status}: ${terminal.stderr.trim()}`);
  else {
    const cells = rowsOfCells(readFileSync(out, "utf8"));
    const pixel = rowsOfFrame(dump).map(normalise).filter(Boolean);
    const at = cells.findIndex((line, i) => line !== pixel[i]);
    if (cells.length !== pixel.length) bad("the terminal's rows", `${cells.length} rows, the pixel figure's ${pixel.length}`);
    else if (at >= 0)
      bad("the terminal's rows", `row ${at + 1}: ${JSON.stringify(cells[at])} is not ${JSON.stringify(pixel[at])}`);
    else ok("the terminal's rows", `${cells.length} rows, the pixel figure's words; ${cols} columns`);
  }

  const text = render(spec, { width: cols }).split("\n");
  yes(
    text[0] === spec.title && text.every((line) => cellWidth(line) <= cols),
    "the text half",
    `${text.length} lines, the title first, the widest ${Math.max(...text.map(cellWidth))} of ${cols} cells`,
    `the first line is ${JSON.stringify(text[0])}`,
  );
}

// (h) the mutation: a box resized, refused with both sizes
{
  const mutated = clone(spec.data);
  mutated.to.height = 120;
  const problems = check({ kind: "transitionSpec", source, data: mutated });
  const hit = problems.find((problem) => problem.includes("150x133") && problem.includes("150x120"));
  if (hit) ok("mutation: a box resized", hit);
  else bad("mutation: a box resized", `no sentence with both sizes: ${JSON.stringify(problems)}`);
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
