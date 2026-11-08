// The four motion kinds' invariants, read back from the frame and from the layout — and, above all, from the solver:
// `solid/src/motion.ts` is the model these figures show, so a sample that is not the model's at its own instant is a
// failure here even when the figure looks right.
//
// For every spec in the four (motion-timing, easing, stagger, frame-strip):
//   (a) the layout on the desktop and its command golden (`solid/goldens/figure-<name>.json`, every command field);
//   (b) the stored frame (`solid/frames/figure-<name>.png`), through `solid/main.ts figure --expect` — the same frame the
//       suite stores, so a figure cannot drift from its spec;
//   (c) the same spec on the terminal: the cells' rows are the pixel figure's words and count, with no kind in the cell
//       renderer (`text.ts` draws the layout);
//   (d) the text half: within a README's 80 cells, its title first, and a Markdown fence.
// Then the kinds' own numbers:
//   (e) a timing track's last sample is its target (within the solver's own settle, 0.5px), every sample is `Track.at(t)`'s
//       x, and the settle row is the instant the solver calls settled — sampled, not typed — with the frame's bar full;
//   (f) an easing curve's dots are its samples: one a sample, two cells apart, each row's value within half a level (a
//       level is a cell — the grid's whole error);
//   (g) a strip's box at frame n is the track's `at(t_n)`: the printed value within 0.011px and the box in the cell the
//       offset rounds to;
//   (h) a stagger's indent is its delay and its bar its span, and the printed range is the item's own.
// Then `check`'s refusals with their sentences, the three mutations (evenly spaced boxes, a curve a cell off its target, a
// typed settle row) as the assertions they break, and — with Playwright's Chromium — the browser drawing each spec **by
// name** from the same file.
//
//   bun solid/figure-motion.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const { capture } = await import("./dump.ts");
const { CELL_WIDTH, PADDING_X, layoutOf, sizeOf } = await import("./src/figure/kinds.ts");
const { landingOf, motionName, presentAt, shownValue } = await import("./src/figure/kinds/motion.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { markdown, render } = await import("./src/figure/text.ts");
const { format } = await import("./src/format.ts");

import type { EasingSpec, FrameStripSpec, MotionTimingSpec, Spec, StaggerSpec } from "./src/figure/spec.ts";

const NAMES = ["motion-timing", "easing", "stagger", "frame-strip"] as const;
/** The solver's settle: 0.5px and 0.5px/s (`motion.ts`), so a sample within this of its target is the target's. */
const SETTLE = 0.5;
/** A sample is written to two places, so the model's own value and the data's differ by half a hundredth at most. */
const SAMPLE = 0.011;
const native = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "cssints-figure-motion-"));

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const specOf = (name: string): Spec => {
  const parsed = parse(readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/${name}.json: ${parsed.problems.join(" ")}`);
  return parsed.spec;
};
/** A spec's data copied, so a mutation cannot touch the file the checks read. */
const copyOf = (name: string): Record<string, unknown> =>
  JSON.parse(JSON.stringify(specOf(name))) as Record<string, unknown>;

interface Cmd {
  element: string | null;
  type: string;
  box: number[];
  text?: string;
  color?: number[];
}
const commandOf = (dump: { commands: Cmd[] }, id: string) =>
  dump.commands.find((command) => command.element === id);
/** The figure's lines as words: each row's text commands, left to right (a blank row is no row). */
function rowsOfFrame(dump: { commands: Cmd[] }): string[] {
  const rows = new Map<number, { x: number; text: string }[]>();
  for (const command of dump.commands)
    if (command.type === "text" && command.text !== undefined) {
      const row = Math.round(command.box[1]! / 16);
      const parts = rows.get(row) ?? [];
      parts.push({ x: command.box[0]!, text: command.text });
      rows.set(row, parts);
    }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
/** The terminal's dump as rows: everything above the colour table, dots (a track, a fill, a mark) dropped, blank rows
 *  dropped with them — the pixel side drops its own. */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map((line) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
/** An item of the layout, by id: the line it is on and the cell it starts at. */
function itemAt(l: ReturnType<typeof layoutOf>, id: string) {
  for (const [row, line] of l.lines.entries()) {
    let cell = 0;
    for (const item of line.items) {
      // a text's box id is `<textId>-cell`: the id a kind asks for is its text's
      if (item.id === id || (item.kind === "text" && item.textId === id)) {
        const text = item.kind === "text" ? item.text : "";
        return { row, cell, cells: item.cells, text };
      }
      cell += item.cells;
    }
  }
  return undefined;
}

// ---- (a)-(d): every spec, three targets -----------------------------------------------------------------------------

const dumps = new Map<string, { commands: Cmd[]; effects: unknown }>();
for (const name of NAMES) {
  const spec = specOf(name);
  const l = layoutOf(spec);
  const dump = await capture("figure", undefined, { spec, warm: 2 });
  dumps.set(name, dump);
  const size = sizeOf(spec);
  if (dump.commands.length === 0) {
    bad(`${name}: the frame`, "no commands");
    continue;
  }
  ok(
    `${name}: the desktop declares it`,
    `${dump.commands.length} commands, ${size.width}x${size.height} px (${size.width / CELL_WIDTH}x${size.height / 16} ` +
      `cells), ${l.lines.length} rows`,
  );

  // (a) the command golden: the stored frame, every field compared
  const goldenPath = `solid/goldens/figure-${name}.json`;
  const want = readFileSync(new URL(`./goldens/figure-${name}.json`, import.meta.url), "utf8").trim();
  const got = format({ commands: dump.commands, effects: dump.effects });
  if (got === want) ok(`${name}: the golden`, `${goldenPath}, every command field identical`);
  else {
    const at = got.split("\n").findIndex((line, i) => line !== want.split("\n")[i]);
    bad(
      `${name}: the golden`,
      `${goldenPath} differs at line ${at + 1}: ${JSON.stringify(got.split("\n")[at])} is not ` +
        JSON.stringify(want.split("\n")[at]),
    );
  }

  // (b) the stored frame: the page at rest (`--warm 30`, every figure's frames), pixel for pixel
  const png = `solid/frames/figure-${name}.png`;
  const run = spawnSync(
    "bun",
    ["solid/main.ts", "figure", "--spec", `solid/specs/${name}.json`, "--warm", "30", "--expect", png],
    { cwd: native, encoding: "utf8" },
  );
  if (run.status === 0)
    ok(`${name}: the stored frame`, `${png}, ${statSync(new URL(`./frames/figure-${name}.png`, import.meta.url)).size} B, identical`);
  else bad(`${name}: the stored frame`, `${png}: exit ${run.status}: ${(run.stderr || run.stdout).trim()}`);

  // (c) the same spec on the terminal: the rows are the pixel figure's words and count
  const out = join(work, `${name}.txt`);
  const terminal = spawnSync(
    "bun",
    ["terminal/solid.ts", "--page", "figure", "--spec", new URL(`./specs/${name}.json`, import.meta.url).pathname,
      "--cols", "80", "--rows", String(l.lines.length + 2), "--dump", out],
    { cwd: native, encoding: "utf8" },
  );
  if (terminal.status !== 0) {
    bad(`${name}: the terminal`, `exit ${terminal.status}: ${terminal.stderr.trim()}`);
  } else {
    const cells = rowsOfCells(readFileSync(out, "utf8"));
    // a dot is a track's cell, a fill's and a mark's in the dump, and a figure's decimal point on both sides: the two
    // are stripped alike, so the comparison is the words and their count (the numbers' exact text is (e)'s and (g)'s)
    const pixel = rowsOfFrame(dump).map((line) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim());
    const at = cells.findIndex((line, i) => line !== pixel[i]);
    if (cells.length !== pixel.length)
      bad(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's ${pixel.length}`);
    else if (at >= 0)
      bad(`${name}: the terminal's rows`, `row ${at + 1}: ${JSON.stringify(cells[at])} is not ${JSON.stringify(pixel[at])}`);
    else ok(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's words (cells, not pixels)`);
  }

  // (d) the text half: the same layout as characters, inside a README's 80 cells
  const text = render(spec, { width: 80 });
  const lines = text.split("\n");
  const widest = Math.max(...lines.map((line) => [...line].length));
  const md = markdown(spec);
  if (widest <= 80 && lines[0] === spec.title && md.includes("```text") && md.includes(`_${spec.source}_`))
    ok(`${name}: the text`, `${lines.length} lines, ${widest} of 80 cells, its title and its fence`);
  else bad(`${name}: the text`, `${lines.length} lines, ${widest} cells, the first ${JSON.stringify(lines[0])}`);
}

// ---- (e) motionTiming: the samples are the solver's, and the settle row is an instant, not a literal ----------------

/** The rows a track claims are settled but the solver is not: a typed settle row is the one thing this catches. */
function typedSettleRows(spec: MotionTimingSpec): string[] {
  const out: string[] = [];
  for (const track of spec.data.tracks)
    for (const sample of track.samples) {
      if (sample.value !== track.target) continue;
      const want = presentAt(track.motion, track.start, track.target, sample.ms);
      if (Math.abs(want - track.target) > SETTLE)
        out.push(
          `${track.label}'s row at ${sample.ms}ms says ${shownValue(sample.value)}px (its target), but ` +
            `${motionName(track.motion)} is on ${shownValue(want)}px there`,
        );
    }
  return out;
}

{
  const spec = specOf("motion-timing") as MotionTimingSpec;
  const l = layoutOf(spec);
  const dump = dumps.get("motion-timing")!;
  let samples = 0;
  let worst = 0;
  for (const track of spec.data.tracks) {
    const last = track.samples[track.samples.length - 1]!;
    if (Math.abs(last.value - track.target) <= SETTLE)
      ok(
        `motion-timing: ${track.label}'s last sample`,
        `${last.value}px at ${last.ms}ms is its target (within the solver's ${SETTLE}px settle)`,
      );
    else bad(`motion-timing: ${track.label}'s last sample`, `${last.value}px, its target is ${track.target}px`);
    for (const sample of track.samples) {
      const want = presentAt(track.motion, track.start, track.target, sample.ms);
      worst = Math.max(worst, Math.abs(want - sample.value));
      samples++;
      if (Math.abs(want - sample.value) > SAMPLE)
        bad(
          `${track.label} at ${sample.ms}ms`,
          `${sample.value}px, ${motionName(track.motion)} is at ${want.toFixed(3)}px there`,
        );
    }
  }
  ok("motion-timing: every sample is Track.at", `${samples} samples, worst ${worst.toFixed(4)}px off the solver`);

  // the settle row's bar, read back from the frame: full, and the row says settled
  const settledRows = spec.data.tracks.map((track) => {
    const last = track.samples[track.samples.length - 1]!;
    const bar = l.bars.find((candidate) => candidate.label === `${last.ms}ms` && candidate.text === shownValue(track.target)!);
    return bar;
  });
  const frames = settledRows.map((bar) => {
    if (!bar) return undefined;
    const fill = commandOf(dump, bar.fillId);
    const box = commandOf(dump, bar.trackId);
    return fill && box && fill.box[2] === box.box[2] && fill.box[2] === bar.track * CELL_WIDTH;
  });
  if (frames.every(Boolean) && settledRows.length === spec.data.tracks.length)
    ok(
      "motion-timing: the settle rows",
      `${settledRows.length} tracks, each ending on a full ${(settledRows[0]!.track * CELL_WIDTH).toFixed(0)}px bar and its target`,
    );
  else bad("motion-timing: the settle rows", `${frames.filter(Boolean).length} of ${settledRows.length} settled rows are full bars`);
  const typed = typedSettleRows(spec);
  if (!typed.length) ok("motion-timing: the settle rows are sampled", "every target-valued row is the instant the solver settles on");
  else bad("motion-timing: the settle rows are sampled", typed.join("; "));
}

// ---- (f) easing: a dot a sample, two cells apart, its row within half a level ---------------------------------------

{
  const spec = specOf("easing") as EasingSpec;
  const l = layoutOf(spec);
  const rows = spec.options?.rows ?? 7;
  const values = spec.data.curves.flatMap((curve) => [curve.start, curve.target, ...curve.samples.map((s) => s.value)]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const levelWidth = rows > 1 ? (hi - lo) / (rows - 1) : 0;
  let dots = 0;
  let worstLevel = 0;
  let columnsOk = true;
  for (const [c, curve] of spec.data.curves.entries()) {
    const marks = curve.samples.map((sample, i) => {
      const level = levelWidth === 0 ? 0 : Math.round(((hi - sample.value) / (hi - lo)) * (rows - 1));
      return { i, sample, level, item: itemAt(l, `fig-dot-${c}-${level}-${2 * i}`) };
    });
    const base = marks[0]?.item?.cell;
    for (const mark of marks) {
      dots++;
      if (!mark.item || base === undefined || mark.item.cell - base !== 2 * mark.i) {
        columnsOk = false;
        bad(`easing: ${curve.label}'s sample ${mark.i + 1}`, `no dot at two cells a sample (${JSON.stringify(mark.item)})`);
        continue;
      }
      const rowValue = Number(itemAt(l, `fig-edge-${c}-${mark.level}`)?.text ?? Number.NaN);
      const off = Number.isFinite(rowValue) ? Math.abs(rowValue - mark.sample.value) : Infinity;
      worstLevel = Math.max(worstLevel, off);
      if (off > levelWidth / 2)
        bad(
          `easing: ${curve.label}'s sample ${mark.i + 1}`,
          `its row is ${rowValue}px, the sample ${mark.sample.value}px: ${off.toFixed(2)}px, over half a level`,
        );
    }
  }
  if (columnsOk)
    ok("easing: the polyline is the samples", `${dots} dots, two cells a sample, the block's first column the start`);
  ok(
    "easing: the dots' rows",
    `worst ${worstLevel.toFixed(2)}px from its sample's value; half a level is ${(levelWidth / 2).toFixed(2)}px`,
  );
}

// ---- (g) frameStrip: the box at frame n is the track's at(t_n), within the cell it rounds to -----------------------

{
  const spec = specOf("frame-strip") as FrameStripSpec;
  const l = layoutOf(spec);
  const cells = spec.options?.width ?? 20;
  let frames = 0;
  let worst = 0;
  let worstCell = 0;
  for (const [s, strip] of spec.data.strips.entries()) {
    const target = strip.target ?? strip.start;
    const landing = landingOf(strip.motion, strip.start, target);
    const positions = [strip.start, landing, ...strip.frames.map((frame) => frame.value)];
    const lo = Math.min(...positions);
    const hi = Math.max(...positions);
    const span = hi - lo;
    for (const [i, frame] of strip.frames.entries()) {
      frames++;
      const want = presentAt(strip.motion, strip.start, target, frame.ms);
      worst = Math.max(worst, Math.abs(want - frame.value));
      const offset = span === 0 ? 0 : Math.round(((frame.value - lo) / span) * (cells - 1));
      const mark = itemAt(l, `fig-mark-${s}-${i}`);
      const label = itemAt(l, `fig-time-${s}-${i}`);
      const drawn = mark && label ? mark.cell - label.cell - label.cells : Number.NaN;
      const wantCell = span === 0 ? 0 : ((want - lo) / span) * (cells - 1);
      worstCell = Math.max(worstCell, Math.abs(wantCell - drawn));
      if (drawn !== offset)
        bad(`frame-strip: ${strip.label}'s frame ${i + 1}`, `its box is ${drawn} cells in, the offset rounds to ${offset}`);
      if (Math.abs(want - frame.value) > SAMPLE)
        bad(
          `frame-strip: ${strip.label}'s frame ${i + 1}`,
          `says ${frame.value}px at ${frame.ms}ms, ${motionName(strip.motion)} is at ${want.toFixed(3)}px`,
        );
    }
  }
  ok("frame-strip: the boxes are the motion's", `${frames} frames, worst ${worst.toFixed(4)}px off the solver`);
  ok(
    "frame-strip: the boxes' cells",
    `worst ${worstCell.toFixed(2)} of a cell from the solver's own offset (a dot is one cell: half a cell is the rounding)`,
  );
}

// ---- (h) stagger: the delays are the indents and the spans the bars, and the ranges the items' own ----------------

{
  const spec = specOf("stagger") as StaggerSpec;
  const l = layoutOf(spec);
  const dump = dumps.get("stagger")!;
  const width = spec.options?.width ?? 16;
  const done = Math.max(...spec.data.items.map((item) => item.delay + item.duration));
  const perCell = done > 0 ? done / width : 1;
  const labelWidth = Math.max(...spec.data.items.map((item) => [...item.label].length)) + 1;
  const wrong: string[] = [];
  const framed: string[] = [];
  for (const [i, item] of spec.data.items.entries()) {
    const bar = l.bars.find((candidate) => candidate.label === item.label);
    const indent = itemAt(l, `fig-delay-${i}`)?.cells ?? 0;
    const span = Math.max(1, Math.round(item.duration / perCell));
    if (!bar) {
      wrong.push(`${item.label} has no bar`);
      continue;
    }
    if (indent !== Math.max(0, Math.round(item.delay / perCell)))
      wrong.push(`${item.label}'s indent is ${indent}, its delay ${Math.round(item.delay / perCell)} cells`);
    if (bar.track !== span) wrong.push(`${item.label}'s bar is ${bar.track} cells, its span ${span}`);
    const range = `${item.delay}-${item.delay + item.duration}ms`;
    if (bar.text !== range) wrong.push(`${item.label}'s range reads ${JSON.stringify(bar.text)}, not ${JSON.stringify(range)}`);
    const track = commandOf(dump, bar.trackId);
    const x = PADDING_X * CELL_WIDTH + (labelWidth + indent) * CELL_WIDTH;
    if (!track || track.box[0] !== x || track.box[2] !== span * CELL_WIDTH)
      framed.push(`${item.label} at x ${track?.box[0]} of ${span} cells (wanted ${x})`);
  }
  if (!wrong.length)
    ok(
      "stagger: the spans are the items'",
      `${spec.data.items.length} rows, ${spec.data.items.map((item) => `${item.delay}ms+${item.duration}ms`).join(", ")}, ` +
        `${perCell.toFixed(1)}ms a cell`,
    );
  else bad("stagger: the spans are the items'", wrong.join("; "));
  if (!framed.length)
    ok("stagger: the frame's bars", "each bar starts at its delay's cell and is its span wide (32px a cell)");
  else bad("stagger: the frame's bars", framed.join("; "));
}

// ---- the refusals, in the others' register -------------------------------------------------------------------------

const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((problem) => problem === sentence || problem.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const springTrack = (samples: unknown) => ({
  kind: "motionTiming",
  source: "Sample",
  data: { tracks: [{ label: "the panel, out", start: 163.88, target: 177.88, motion: { kind: "spatial", duration: 200, bounce: 0 }, samples }] },
});
refuses(
  "a sample list that is not monotonic in time",
  springTrack([{ ms: 0, value: 163.88 }, { ms: 50, value: 170.4 }, { ms: 40, value: 172 }]),
  "the panel, out's sample 3 is at 40ms, after sample 2's 50ms; a track's samples go forward in time.",
);
refuses(
  "a duration of nothing",
  {
    kind: "motionTiming",
    source: "Sample",
    data: { tracks: [{ label: "the panel, out", start: 0, target: 10, motion: { kind: "spatial", duration: 0, bounce: 0 }, samples: [{ ms: 0, value: 0 }] }] },
  },
  "the panel, out has a duration of 0ms: a spring's duration is above zero (ω = 2π / duration).",
);
refuses(
  "a bounce outside 0 to 1",
  {
    kind: "motionTiming",
    source: "Sample",
    data: { tracks: [{ label: "the menu, in", start: -10, target: -20, motion: { kind: "spatial", duration: 220, bounce: 1.2 }, samples: [{ ms: 0, value: -10 }] }] },
  },
  "the menu, in has a bounce of 1.2: a bounce is between 0 and 1 (ζ = 1 - bounce).",
);
refuses(
  "a strip whose frames are not the track's",
  {
    kind: "frameStrip",
    source: "Sample",
    data: {
      strips: [{
        label: "the feed's fling",
        start: 11.48,
        motion: { kind: "decay", velocity: 87.03 },
        frames: [{ ms: 0, value: 11.48 }, { ms: 200, value: 20 }],
      }],
    },
  },
  "the feed's fling's frame 2 is at 200ms and 20.00px, but decay(87.03 px/s) from 11.48 to 54.95 is at 25.82px then.",
);
refuses(
  "a stagger whose delay is negative",
  { kind: "stagger", source: "Sample", data: { items: [{ label: "card 2", delay: -50, duration: 300 }] } },
  "card 2 has a delay of -50ms: a delay is zero or more.",
);
refuses(
  "an easing curve that ends away from its target",
  {
    kind: "easing",
    source: "Sample",
    data: {
      curves: [{
        label: "the panel in",
        start: 149.88,
        target: 163.88,
        motion: { kind: "spatial", duration: 220, bounce: 0.1 },
        samples: [{ ms: 0, value: 149.88 }, { ms: 100, value: 160 }, { ms: 200, value: 162.88 }],
      }],
    },
  },
  "the panel in ends at 162.88px, not its target 163.88px; a curve ends where it is going.",
);

// ---- the mutations, as the assertions they break -------------------------------------------------------------------

// (1) a strip's boxes evenly spaced instead of the track's: the check names the frame and both numbers
{
  const spec = copyOf("frame-strip") as unknown as FrameStripSpec;
  const strip = (spec.data as { strips: FrameStripSpec["data"]["strips"][number][] }).strips[1]!;
  const positions = [strip.start, landingOf(strip.motion, strip.start, strip.target ?? strip.start)];
  const lo = Math.min(...positions);
  const hi = Math.max(...positions);
  const frames = (spec.data as { strips: { frames: { ms: number; value: number }[] }[] }).strips[1]!.frames.map(
    (frame, i) => ({ ms: frame.ms, value: Math.round((lo + ((hi - lo) * i) / 8) * 100) / 100 }),
  );
  (spec.data as unknown as { strips: { frames: unknown }[] }).strips[1]!.frames = frames;
  const problems = check(spec);
  const sentence = problems.find((problem) => problem.includes("but decay(87.03 px/s)"));
  const first = strip.frames[1]!;
  const want = presentAt(strip.motion, strip.start, strip.target ?? strip.start, first.ms);
  if (sentence)
    ok(
      "mutation: a strip's boxes evenly spaced",
      `${sentence} (the even frames are a straight line; the decay is at ${want.toFixed(2)}px where the mutation says ` +
        `${frames[1]!.value}px)`,
    );
  else bad("mutation: a strip's boxes evenly spaced", `the check printed no decay sentence: ${JSON.stringify(problems)}`);
}

// (2) an easing that ends a cell off its target: the last sample one value level short, refused with both numbers
{
  const spec = copyOf("easing") as unknown as EasingSpec;
  const curves = (spec.data as unknown as { curves: EasingSpec["data"]["curves"][number][] }).curves;
  const rows = spec.options?.rows ?? 7;
  const values = curves.flatMap((curve) => [curve.start, curve.target, ...curve.samples.map((s) => s.value)]);
  const level = (Math.max(...values) - Math.min(...values)) / (rows - 1);
  const curve = curves[0]!;
  const last = curve.samples[curve.samples.length - 1]!;
  (last as { value: number }).value = Math.round((curve.target - level) * 100) / 100;
  const sentence = `the panel in ends at ${shownValue(last.value)}px, not its target ${shownValue(curve.target)}px; a curve ends where it is going.`;
  if (check(spec).includes(sentence))
    ok("mutation: an easing a cell off its target", `${sentence} (a level is ${level.toFixed(2)}px there)`);
  else bad("mutation: an easing a cell off its target", `no ${JSON.stringify(sentence)}: ${JSON.stringify(check(spec))}`);
}

// (3) a timing settle row typed: the target's value at an instant the solver is not settled on, caught by (e)'s numbers
{
  const spec = copyOf("motion-timing") as unknown as MotionTimingSpec;
  const track = (spec.data as unknown as { tracks: MotionTimingSpec["data"]["tracks"][number][] }).tracks[0]!;
  const last = track.samples[track.samples.length - 1]!;
  // the target's value at a sixth of the way: a row typed where the track is still 2.5px short
  (last as { ms: number }).ms = 100;
  const typed = typedSettleRows(spec);
  const want = presentAt(track.motion, track.start, track.target, last.ms);
  if (typed.length)
    ok(
      "mutation: a timing settle row typed",
      `${typed[0]} (the typed row is ${last.ms}ms: ${want.toFixed(2)}px, its target ${track.target}px)`,
    );
  else bad("mutation: a timing settle row typed", "the settle-row invariant did not move");
}

// ---- (i) the browser, by name: the same spec file, no page code for the kind ---------------------------------------

const wasmDir = process.env.WASM_DIR || join(process.env.TMPDIR || "/tmp", "cssints-native-web");
const wasm = join(wasmDir, "ui.wasm");
const { chromium } = await import("playwright");
if (!existsSync(wasm) || !existsSync(chromium.executablePath())) {
  console.log(`skip the browser: no ${wasm} or Playwright's chromium (sh browser/build.sh; bunx playwright install chromium)`);
} else {
  // the bundle is built from **this tree** into a directory of this run's: the shared ${TMPDIR}/cssints-native-web is
  // every checkout's, and a sibling worktree's build there is not this page (its kinds are not this tree's)
  const out = join(work, "browser");
  const build = spawnSync("bun", ["browser/solid/build.ts", out], { cwd: native, encoding: "utf8" });
  const bundle = join(out, "figure.js");
  if (build.status !== 0 || !existsSync(bundle)) {
    bad("the browser: the bundle", `exit ${build.status}: ${(build.stderr || build.stdout).trim().slice(0, 400)}`);
    process.exit(1);
  }
  ok("the browser: the bundle", `${statSync(bundle).size} B from this tree`);
  const ROOT = resolve(native);
  const MIME: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".ttf": "font/ttf",
    ".json": "application/json",
    ".png": "image/png",
  };
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    const file =
      path === "/browser/solid/ui.wasm" ? join(wasmDir, "ui.wasm") : path === "/browser/solid/figure.js" ? bundle : join(ROOT, path);
    try {
      const body = await (await import("node:fs/promises")).readFile(file);
      response.writeHead(200, { "content-type": MIME[extname(file)] ?? "text/plain" }).end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 420 }, deviceScaleFactor: 1 });
    for (const name of NAMES) {
      const spec = specOf(name);
      await page.goto(`http://127.0.0.1:${port}/browser/solid/figure.html?spec=${name}`);
      await page.waitForFunction(() => (window as unknown as { __page?: unknown }).__page, null, { timeout: 20000 });
      await page.evaluate(() => (window as unknown as { __page: { warm(n: number): void } }).__page.warm(2));
      const drawn = JSON.parse(
        await page.evaluate(() => (window as unknown as { __page: { dump(): string } }).__page.dump()),
      ) as { commands: { text?: string }[] };
      const errors = await page.evaluate(() => (window as unknown as { __page: { errors(): number } }).__page.errors());
      if (errors) bad(`the browser: ?spec=${name}`, `${errors} Clay errors`);
      else if (!drawn.commands.some((command) => command.text === spec.title))
        bad(`the browser: ?spec=${name}`, `the frame has no ${JSON.stringify(spec.title)}`);
      else ok(`the browser: ?spec=${name}`, `${drawn.commands.length} commands, the file's own figure ("${spec.title}")`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (failed) {
  console.error(`solid/figure-motion.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure-motion.test.ts: ${NAMES.length} specs, ${checks} checks, the solver's own numbers among them`);
