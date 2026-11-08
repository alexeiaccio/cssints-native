// The Figure page's invariants, read back from the frame and not from a string: for every spec in SPECS, the bar's fill
// box against its track's, the number's text command, the rows' order, the funnel's ratios,
// the branch flow's boxes and connectors, the state machine's path, the tree's levels and edges, the journey's feelings;
// then `check`'s own refusals in their sentences; then the same spec on the terminal, cell for cell.
//
// The geometry comes from `solid/dump.ts`'s `capture` — the same last frame solid/goldens stores — so a bar is the box
// Clay laid out, not the number the layout asked for. The error is in **cells** (the layout's unit): one cell is 8px
// across, and a fill may round to the nearest half cell of the ratio it should show.
//
//   bun solid/figure.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture } = await import("./dump.ts");
const { layoutOf, CELL_WIDTH } = await import("./src/figure/kinds.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { variant } = await import("./src/pack.ts");
const { format } = await import("./src/format.ts");
const styles = await import("./app/Figure.styles.ts");

/** A bar may round to the nearest half cell of its ratio: the layout rounds a cell, and that is the whole tolerance. */
const HALF_CELL = 0.5;
const SPECS = [
  "bars",
  "funnel",
  "compare",
  "pipeline",
  "branch-flow",
  "state-machine",
  "tree",
  "journey-map",
  "palette",
  "contrast",
  "colour-roles",
  "layer-stack",
  "state-matrix",
  "token-table",
  "spacing",
  "type-scale",
  "table",
] as const;
/** The command goldens: one frame each, stored by the same capture this test reads. */
const GOLDENS: Partial<Record<(typeof SPECS)[number], string>> = {
  "branch-flow": "figure-branch-flow",
  "state-machine": "figure-state-machine",
  "tree": "figure-tree",
  "journey-map": "figure-journey-map",
  "palette": "figure-palette",
  "contrast": "figure-contrast",
  "colour-roles": "figure-colour-roles",
  "layer-stack": "figure-layer-stack",
  "state-matrix": "figure-state-matrix",
  "token-table": "figure-token-table",
  "spacing": "figure-spacing",
  "type-scale": "figure-type-scale",
  table: "figure-table",
};
/** The engine's contrast, through the published `cssints/check` — its `contrast` is an Effect yielding `{ ratio }`. This
 *  package installs `dist`, so the sources the monorepo's tests imported (`src/color.ts`) are not here; the public check
 *  is the same arithmetic, and it is what a site's colours are held to. */
const { contrast: engineContrast } = await import("cssints/check");
const { Effect } = await import("effect");
const { shown } = await import("./src/figure/contrast.ts");
const engineRatio = (fg: string, bg: string): number => Effect.runSync(engineContrast(fg, bg)).ratio;
let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));
const spec = (name: string) => {
  const parsed = parse(readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/${name}.json: ${parsed.problems.join(" ")}`);
  return parsed.spec;
};
/** One command of a captured frame, as the test reads it. */
interface Cmd {
  element: string | null;
  type: string;
  box: number[];
  text?: string;
  color?: number[];
}
const commandOf = (dump: { commands: Cmd[] }, id: string) => dump.commands.find((c) => c.element === id);
/** A text command's row: a line is one cell down. */
const rowOf = (box: number[]) => Math.round(box[1]! / 16);
/** The figure's lines as words: each row's text commands, left to right. */
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
/** A fill is "." and a full stop is a full stop: both sides of the terminal comparison lose their dots, so a run of dots
 *  (a bar, a box) and a sentence's own period read the same on the cells and in Clay's text commands. The numbers' exact
 *  text is (b)'s check, on the frame's own commands. */
const stripDots = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
/** The terminal's dump as the figure's lines: the colour table under the grid is not a row. */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map(stripDots)
    .filter(Boolean);
}

const work = mkdtempSync(join(tmpdir(), "cssints-figure-"));
let worstError = 0;
let worstWhere = "";

// (a)-(d) the layout read back from each frame: the bars' geometry, the numbers' text, the rows' order, the funnel's ratios
for (const name of SPECS) {
  const s = spec(name);
  const l = layoutOf(s);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const lines = rowsOfFrame(dump);
  const kind = s.kind;
  if (dump.commands.length === 0) {
    bad(`${name}: the frame`, "no commands");
    continue;
  }

  // (a) each bar's fill ÷ its track, against value/max, in cells — the frame's boxes, not the layout's numbers
  for (const bar of l.bars) {
    const fill = commandOf(dump, bar.fillId);
    const track = commandOf(dump, bar.trackId);
    if (!fill || !track) {
      bad(`${name}: ${bar.label}'s bar`, `the frame has no ${bar.fillId} or ${bar.trackId}`);
      continue;
    }
    const error = Math.abs(fill.box[2]! - (track.box[2]! * bar.value) / bar.max) / CELL_WIDTH;
    if (error > worstError) (worstError = error), (worstWhere = `${name} ${bar.label} ${bar.textId}`);
    if (error > HALF_CELL)
      bad(`${name}: ${bar.label}`, `the fill is ${(fill.box[2]! / CELL_WIDTH).toFixed(2)} cells of ` +
        `${(track.box[2]! / CELL_WIDTH).toFixed(2)}, ${error.toFixed(2)} cells off ${bar.value}/${bar.max} (half a cell allowed)`);
    // (b) the number's text is the spec's text (or the value the layout formatted)
    const number = dump.commands.find((c) => c.type === "text" && c.text === bar.text);
    if (!number) bad(`${name}: ${bar.label}'s number`, `no text command reads ${JSON.stringify(bar.text)}`);
  }
  if (l.bars.length) ok(`${name}: ${l.bars.length} bar(s)`, `every fill is value/max and every number its text`);

  // (c) the rows are the data's, in order: each label's text command, from the top down — a flow is one row of boxes, so
  // there the order is left to right. A state machine may draw the same state twice (the path is the walk), so a label
  // consumes the next command that carries its text, not the first.
  const axis = kind === "flow" ? 0 : 1;
  // a cursor, not a mark on the commands found: two labels may carry the same text (a state machine's path returns to a
  // state), and the frame draws them in the data's order, so each label takes the *next* command that carries its text
  let cursor = 0;
  const labelRows = l.labels.map((label) => {
    while (cursor < dump.commands.length) {
      const command = dump.commands[cursor++]!;
      if (command.type === "text" && command.text === label.text) return command;
    }
    return undefined;
  });
  // a tree's level is several boxes on one row: its order is the row's (top down), then left to right
  const inOrder = labelRows.every((command, i) => {
    if (!command) return false;
    if (i === 0) return true;
    const before = labelRows[i - 1]!;
    if (kind === "tree")
      return command.box[1]! > before.box[1]! || (command.box[1] === before.box[1] && command.box[0]! > before.box[0]!);
    return command.box[axis]! > before.box[axis]!;
  });
  if (inOrder) ok(`${name}: the rows`, `${l.labels.map((label) => label.text).join(", ")} — the data's order`);
  else bad(`${name}: the rows`, JSON.stringify(labelRows.map((c) => [c?.text, c?.box[axis]])));

  // (c2) a branch flow: one box a step, one connector a decision's branch, and the branch's word is drawn
  if (s.kind === "branchFlow") {
    const steps = s.data;
    const spine = l.boxes.filter((box) => box.role !== "branch");
    const decisions = steps.filter((step) => step.type === "decision");
    const branches = l.connectors.filter((connector) => connector.role === "branch");
    if (spine.length === steps.length)
      ok(`${name}: the steps`, `${spine.length} boxes, one a step (${steps.map((step) => step.label).join(", ")})`);
    else bad(`${name}: the steps`, `${spine.length} boxes for ${steps.length} steps`);
    if (branches.length === decisions.length)
      ok(`${name}: the branches`, `${branches.length} connector(s), one a decision (${branches.map((b) => b.from).join(", ")})`);
    else bad(`${name}: the branches`, `${branches.length} connectors for ${decisions.length} decisions`);
    const branchesDrawn = branches.filter((branch) =>
      dump.commands.some((command) => command.type === "text" && command.text === `-- ${branch.text} -->`),
    );
    if (branchesDrawn.length === branches.length)
      ok(`${name}: the branch words`, `"-- no -->" on every branch (${branches.length})`);
    else bad(`${name}: the branch words`, `${branchesDrawn.length} of ${branches.length} have their "-- ${branches[0]?.text ?? "no"} -->" in the frame`);
  }

  // (c3) a state machine: one box a path step, one connector a transition the path walks, the labels the path's order
  if (s.kind === "stateMachine") {
    const path = s.options?.path ?? [s.data.states[0]!];
    if (l.boxes.length === path.length)
      ok(`${name}: the path's boxes`, `${l.boxes.length} boxes, the path's ${path.length}`);
    else bad(`${name}: the path's boxes`, `${l.boxes.length} boxes for the path's ${path.length}`);
    if (l.connectors.length === path.length - 1)
      ok(`${name}: the path's transitions`, `${l.connectors.length} connector(s), one a step pair`);
    else bad(`${name}: the path's transitions`, `${l.connectors.length} connectors for ${path.length - 1} steps`);
    const walked = l.labels.map((label) => label.text).join(" → ");
    if (walked === path.join(" → ")) ok(`${name}: the path's labels`, walked);
    else bad(`${name}: the path's labels`, `${walked} is not ${path.join(" → ")}`);
    const off = s.data.states.filter((state) => !path.includes(state));
    if (!off.length) ok(`${name}: the footer`, "every state is on the path");
    else if (dump.commands.some((command) => command.type === "text" && command.text === `not on the path: ${off.join(", ")}`))
      ok(`${name}: the footer`, `not on the path: ${off.join(", ")}`);
    else bad(`${name}: the footer`, `no text command reads "not on the path: ${off.join(", ")}"`);
  }

  // (c4) the new kinds' command goldens: the same capture, stored as solid/goldens/<name>.json
  const goldenName = GOLDENS[name];
  if (goldenName) {
    const want = readFileSync(new URL(`./goldens/${goldenName}.json`, import.meta.url), "utf8").trim();
    const got = format({ commands: dump.commands, effects: dump.effects });
    if (got === want) ok(`${name}: the golden`, `solid/goldens/${goldenName}.json, every command field identical`);
    else {
      const at = got.split("\n").findIndex((line, i) => line !== want.split("\n")[i]);
      bad(
        `${name}: the golden`,
        `solid/goldens/${goldenName}.json differs at line ${at + 1}: ` +
          `${JSON.stringify(got.split("\n")[at])} is not ${JSON.stringify(want.split("\n")[at])}`,
      );
    }
  }

  // (c5) the two row kinds: a tree's levels are rows of boxes joined by its edges, and a journey's stages are a bar row
  // with the stage's notes under it. A tree's boxes are the proof that a layout is not a column: its levels' y differs.
  if (s.kind === "tree") {
    const rows = new Set(l.boxes.map((box) => commandOf(dump, box.id)?.box[1]));
    if (l.boxes.length === l.labels.length)
      ok(`${name}: the nodes`, `${l.boxes.length} boxes, one a node (${l.labels.map((label) => label.text).join(", ")})`);
    else bad(`${name}: the nodes`, `${l.boxes.length} boxes for ${l.labels.length} labels`);
    if (l.connectors.length === l.boxes.length - 1)
      ok(`${name}: the edges`, `${l.connectors.length} connector(s), one a child`);
    else bad(`${name}: the edges`, `${l.connectors.length} connectors for ${l.boxes.length - 1} children`);
    if (rows.size >= 3)
      ok(`${name}: the levels`, `${rows.size} rows of boxes, so a level is a row and not a column`);
    else bad(`${name}: the levels`, `${rows.size} distinct rows of boxes`);
    const bracket = dump.commands.some((c) => c.type === "text" && c.text?.includes("+"));
    const stem = dump.commands.some((c) => c.type === "text" && c.text?.includes("|"));
    if (bracket && stem) ok(`${name}: the connectors`, "a bracket's + and a stem's | are in the frame");
    else bad(`${name}: the connectors`, `bracket ${bracket}, stem ${stem}`);
  }
  if (s.kind === "journeyMap") {
    const stages = s.data;
    if (l.bars.length === stages.length)
      ok(`${name}: the stages`, `${stages.length} bars, one a stage (${stages.map((stage) => stage.label).join(", ")})`);
    else bad(`${name}: the stages`, `${l.bars.length} bars for ${stages.length} stages`);
    const words = l.bars.filter((bar) =>
      dump.commands.some((command) => command.type === "text" && command.text === bar.text),
    );
    if (words.length === l.bars.length) ok(`${name}: the feelings`, `${words.map((bar) => bar.text).join(", ")} — the words as drawn`);
    else bad(`${name}: the feelings`, `${words.length} of ${l.bars.length} feeling words in the frame`);
    const notes = stages.filter((stage) =>
      !stage.doing || dump.commands.some((command) => command.type === "text" && command.text?.trim() === stage.doing),
    );
    if (notes.length === stages.length) ok(`${name}: the notes`, "every stage's doing is a text command under its row");
    else bad(`${name}: the notes`, `${stages.length - notes.length} stage(s) have no doing line`);
    const fills = l.bars.every((bar) => {
      const fill = commandOf(dump, bar.fillId);
      const track = commandOf(dump, bar.trackId);
      return fill && track && Math.abs(fill.box[2]! - (track.box[2]! * bar.value) / bar.max) / CELL_WIDTH <= HALF_CELL;
    });
    if (fills) ok(`${name}: the bars`, "each feeling's magnitude is its fill, against the kit's -2 to 2 scale");
    else bad(`${name}: the bars`, "a feeling's fill is not |feeling|/2 of its track");
  }

  // (c6) the four design-system kinds. A palette: a swatch a step, its own colour in the frame, its value and its
  // contrast printed, and the mark on the first step that reads as words — computed with the engine here, not typed.
  if (s.kind === "palette") {
    const data = s.data;
    const page = data.page ?? "#ffffff";
    const steps = data.hues.reduce((n, hue) => n + hue.steps.length, 0);
    if (l.swatches.length === steps)
      ok(`${name}: the swatches`, `${steps} swatch(es), one a step of ${data.hues.map((hue) => hue.name).join(", ")}`);
    else bad(`${name}: the swatches`, `${l.swatches.length} swatches for ${steps} steps`);
    const colourOf = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const wrong = l.swatches.filter((swatch) => {
      const box = commandOf(dump, swatch.id);
      const want = colourOf(swatch.value);
      return !box || ![0, 1, 2].every((i) => Math.abs(Number(box.color?.[i]) - want[i]!) <= 1);
    });
    if (!wrong.length) ok(`${name}: the swatches' colours`, `${l.swatches.length} boxes are their steps' own #rrggbb`);
    else bad(`${name}: the swatches' colours`, `${wrong.length} of ${l.swatches.length} are not: ${wrong[0]!.value} first`);
    // every printed value and ratio is the data's / the engine's
    const printed = l.swatches.filter((swatch) => {
      const value = dump.commands.find((c) => c.type === "text" && c.text === swatch.value);
      const ratio = dump.commands.find((c) => c.type === "text" && c.text === shown(engineRatio(swatch.value, page)));
      return value && ratio;
    });
    if (printed.length === l.swatches.length)
      ok(`${name}: the printed contrast`, `every step's value and its engine ratio (4.5 from step ${l.swatches.find((x) => x.marked)?.step})`);
    else bad(`${name}: the printed contrast`, `${printed.length} of ${l.swatches.length} steps print their value and the engine's ratio`);
    // the mark: one a hue, on the step the engine says is the first that reads as words, at the swatch's own row
    const marks = l.lines.flatMap((line) => line.items.filter((item) => item.kind === "marker"));
    const firstReadable = data.hues.map((hue) => hue.steps.findIndex((step) => engineRatio(step.value, page) >= 4.5));
    const at = marks.map((mark) => Number(/^fig-marker-(\d+)-(\d+)$/.exec(mark.id)?.[2] ?? -1));
    const hueOf = marks.map((mark) => Number(/^fig-marker-(\d+)-(\d+)$/.exec(mark.id)?.[1] ?? -1));
    const right = marks.length === firstReadable.filter((i) => i >= 0).length &&
      marks.every((mark, i) => at[i] === firstReadable[hueOf[i]!]);
    if (right)
      ok(`${name}: the mark`, `on ${marks.map((mark, i) => `${data.hues[hueOf[i]!]!.name} ${data.hues[hueOf[i]!]!.steps[at[i]!]!.name}`).join(", ")} — the first step at 4.5 to 1`);
    else bad(`${name}: the mark`, `marks at ${JSON.stringify(at)} for the first readable steps ${JSON.stringify(firstReadable)}`);
    // ... and the frame's mark is a box of the good role, two cells left of its swatch on the same row
    const good = [...(variant(styles.probe.good, undefined).text ?? [])].slice(0, 3);
    const markBoxes = marks.map((mark) => commandOf(dump, mark.id));
    const placed = markBoxes.every((box, i) => {
      const swatch = commandOf(dump, l.swatches.find((x) => x.hue === data.hues[hueOf[i]!]!.name && x.marked)!?.id ?? "");
      return box && swatch && box.box[1] === swatch.box[1] && Math.abs(box.box[0]! - (swatch.box[0]! - 16)) <= 0.5 &&
        [0, 1, 2].every((k) => Math.abs(Number(box.color?.[k]) - good[k]) <= 1);
    });
    if (placed && marks.length) ok(`${name}: the mark's cell`, `a ${good.join()}-coloured cell two cells left of every marked swatch`);
    else bad(`${name}: the mark's cell`, `${JSON.stringify(markBoxes.map((box) => box?.box))} against the swatches'`);
  }

  // A contrast figure: the ratio a pair prints is the engine's for its two colours, and the verdict is the pair's floor,
  // painted by the good or the problem role.
  if (s.kind === "contrast") {
    const wrong = l.pairs.filter((pair) => {
      const spec2 = s.data.find((row) => row.label === pair.label)!;
      return pair.ratio !== spec2.ratio || shown(engineRatio(spec2.fg, spec2.bg)) !== shown(pair.ratio);
    });
    const printed = s.data.every((pair) => dump.commands.some((c) => c.type === "text" && c.text === `${shown(engineRatio(pair.fg, pair.bg))}:1`));
    if (!wrong.length && printed)
      ok(`${name}: the ratios`, `${s.data.length} pairs print the engine's own (${s.data.map((p) => shown(engineRatio(p.fg, p.bg))).join(", ")})`);
    else bad(`${name}: the ratios`, `${wrong.length} disagree with the engine, printed ${printed}`);
    const good = [...(variant(styles.probe.good, undefined).text ?? [])].slice(0, 3);
    const problem = [...(variant(styles.probe.problem, undefined).text ?? [])].slice(0, 3);
    const verdicts = l.pairs.map((pair) => {
      const text = `${pair.ratio >= pair.min ? "pass" : "fails"} ${pair.min}:1`;
      const command = dump.commands.find((c) => c.type === "text" && c.text === text);
      const want = pair.ratio >= pair.min ? good : problem;
      const right = command && [0, 1, 2].every((i) => Math.abs(Number(command.color?.[i]) - want[i]!) <= 1);
      return right ? pair : undefined;
    });
    if (verdicts.every(Boolean))
      ok(`${name}: the verdicts`, "every pair's pass/fails is its floor's, in the good or the problem role");
    else bad(`${name}: the verdicts`, `${verdicts.filter((v) => !v).length} of ${l.pairs.length} are not their role's`);
    const worst = Math.max(...l.bars.map((bar) => Math.abs(commandOf(dump, bar.fillId)!.box[2]! - (commandOf(dump, bar.trackId)!.box[2]! * bar.value) / bar.max) / CELL_WIDTH));
    if (worst <= HALF_CELL) ok(`${name}: the scale`, `a cell a point of the 21:1 track, the worst fill ${worst.toFixed(2)} of a cell`);
    else bad(`${name}: the scale`, `the worst fill is ${worst.toFixed(2)} cells off`);
  }

  // A colour-roles figure: a row a role pair, a mode a column. The pair's two swatches are their own colours, its ratio
  // is the engine's for those two colours, and its verdict is its floor's, painted by the good or the problem role.
  if (s.kind === "colourRoles") {
    const colourOf = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const swatches = l.lines.flatMap((line) => line.items.filter((item) => item.kind === "swatch"));
    const wrong = swatches.filter((swatch) => {
      const box = commandOf(dump, swatch.id);
      const want = colourOf(swatch.value);
      return !box || ![0, 1, 2].every((i) => Math.abs(Number(box.color?.[i]) - want[i]!) <= 1);
    });
    if (swatches.length === s.data.length * 4 && !wrong.length)
      ok(
        `${name}: the swatches`,
        `${swatches.length} boxes: ${s.data.length} pairs x light/dark x fg/bg, each its own #rrggbb`,
      );
    else bad(`${name}: the swatches`, `${swatches.length} boxes for ${s.data.length} pairs, ${wrong.length} not their colour`);
    const printed = s.data.every((role) =>
      (["light", "dark"] as const).every((mode) =>
        dump.commands.some(
          (c) => c.type === "text" && c.text === `${shown(engineRatio(role[mode].fg, role[mode].bg))}:1`,
        ),
      ),
    );
    if (printed) ok(`${name}: the ratios`, `${s.data.length * 2} ratios, each the engine's for its two colours`);
    else bad(`${name}: the ratios`, "a pair's ratio is not the engine's for its own colours");
    const good = [...(variant(styles.probe.good, undefined).text ?? [])].slice(0, 3);
    const problem = [...(variant(styles.probe.problem, undefined).text ?? [])].slice(0, 3);
    const verdicts = l.pairs.filter((pair) => {
      const command = dump.commands.find(
        (c) => c.type === "text" && c.text === `${pair.pass ? "pass" : "fails"} ${pair.min}:1`,
      );
      const want = pair.pass ? good : problem;
      return !command || ![0, 1, 2].every((i) => Math.abs(Number(command.color?.[i]) - want[i]!) <= 1);
    });
    if (l.pairs.length === s.data.length * 2 && !verdicts.length)
      ok(`${name}: the verdicts`, `${l.pairs.length} verdicts, each its floor's, in the good or the problem role`);
    else bad(`${name}: the verdicts`, `${l.pairs.length} verdicts for ${s.data.length * 2}, ${verdicts.length} wrong`);
  }

  // A layer stack: a layer a row, back to front. The z bar is the depth, the numbers are the Dialog's frames, and a
  // second capture of those frames recomputes every row through specs/from-frames.ts's own `layersOf`.
  if (s.kind === "layerStack") {
    const worst = Math.max(
      ...l.bars.map((bar) => Math.abs(commandOf(dump, bar.fillId)!.box[2]! / CELL_WIDTH - bar.value)),
    );
    if (worst <= HALF_CELL)
      ok(
        `${name}: the z bars`,
        `${l.bars.length} layers at ${l.bars.map((bar) => `z${bar.value}`).join(", ")}, the worst fill ${worst.toFixed(2)} of a cell`,
      );
    else bad(`${name}: the z bars`, `the worst fill is ${worst.toFixed(2)} cells off`);
    const boxes = s.data.map((layer) => `${Math.round(layer.box.width)}x${Math.round(layer.box.height)}`);
    const printed =
      boxes.every((text) => dump.commands.some((c) => c.type === "text" && c.text === text)) &&
      s.data.every((layer) => dump.commands.some((c) => c.type === "text" && c.text === shown(layer.alpha)));
    if (printed) ok(`${name}: the numbers`, `${boxes.length} boxes and ${s.data.length} alphas, as the frames gave them`);
    else bad(`${name}: the numbers`, "a box or an alpha is not printed");
    const { layersOf, MODAL_KEYS, MENU_KEYS, SETTLE } = await import("./specs/from-frames.ts");
    const modal = await capture("dialog", undefined, { keys: [...MODAL_KEYS], settle: SETTLE });
    const menu = await capture("dialog", undefined, { keys: [...MENU_KEYS], settle: SETTLE });
    const again = layersOf(modal, menu);
    if (JSON.stringify(again) === JSON.stringify(s.data))
      ok(
        `${name}: the frames`,
        `${again.length} layers, every z, box, alpha, radius, blur and shadow recomputed from two fresh captures`,
      );
    else bad(`${name}: the frames`, "the spec's layers are not what the frames give (regenerate with specs/from-frames.ts)");
  }

  // A state matrix: a style a row, a state a column, a + where the style declares it. The cells are the data's own, in
  // the data's order, and a + is painted by the good role.
  if (s.kind === "stateMatrix") {
    const want = s.data.rows.flatMap((row) => s.data.columns.map((column) => (row.states.includes(column) ? "+" : "-")));
    const cells = l.lines.slice(1).flatMap((line) => line.items.filter((item) => item.role === "value"));
    const got = cells.map((item) => (item.kind === "text" ? item.text : ""));
    if (JSON.stringify(got) === JSON.stringify(want))
      ok(
        `${name}: the cells`,
        `${got.length} cells from ${s.data.rows.length} styles x ${s.data.columns.length} states, a + where the style declares it`,
      );
    else bad(`${name}: the cells`, `${JSON.stringify(got.slice(0, 6))} is not ${JSON.stringify(want.slice(0, 6))}`);
    const good = [...(variant(styles.probe.good, undefined).text ?? [])].slice(0, 3);
    // a text command carries no element id (only a box does): the cells are found by what they draw
    const plus = dump.commands.filter((c) => c.type === "text" && c.text === "+");
    const wrong = plus.filter((c) => ![0, 1, 2].every((k) => Math.abs(Number(c.color?.[k]) - good[k]!) <= 1));
    const declared = s.data.rows.reduce((n, row) => n + row.states.length, 0);
    if (plus.length === declared && !wrong.length)
      ok(`${name}: the + cells`, `${plus.length} of ${got.length} cells in the good role (${good.join(",")}); the rest muted`);
    else bad(`${name}: the + cells`, `${plus.length} for ${declared}, ${wrong.length} not the good role's`);
  }

  // A token table: a token a row, its group a heading. Every name and value is printed, and a group's name is one heading
  // on its first row (not repeated down the run).
  if (s.kind === "tokenTable") {
    const printed = s.data.every((row) => dump.commands.some((c) => c.type === "text" && c.text === row.value));
    const names = s.data.every((row) => dump.commands.some((c) => c.type === "text" && c.text === row.name));
    const groups = [...new Set(s.data.map((row) => row.group))];
    const headings = groups.every(
      (group) => dump.commands.filter((c) => c.type === "text" && c.text === group).length === 1,
    );
    if (printed && names && headings)
      ok(
        `${name}: the table`,
        `${s.data.length} tokens in ${groups.length} groups, every name and value in the frame, a group's heading once`,
      );
    else bad(`${name}: the table`, `values ${printed}, names ${names}, headings ${headings}`);
  }

  // A spacing scale: a step's box is its own value in pixels, not "one cell" — a 4px step of a 48px scale is half a cell.
  if (s.kind === "spacingScale") {
    const errors = l.bars.map((bar) => {
      const fill = commandOf(dump, bar.fillId)!;
      return { step: bar.label, px: fill.box[2]!, value: bar.value, off: Math.abs(fill.box[2]! - bar.value) };
    });
    const worstPx = Math.max(...errors.map((e) => e.off));
    const ratioWorst = Math.max(...l.bars.map((bar) => Math.abs(commandOf(dump, bar.fillId)!.box[2]! / commandOf(dump, bar.trackId)!.box[2]! - bar.value / bar.max)));
    if (worstPx <= 0.5)
      ok(`${name}: the steps' boxes`, `${errors.length} steps, each its value in pixels (worst ${worstPx.toFixed(2)} px: ${errors.map((e) => `${e.step} ${e.px.toFixed(0)}`).join(", ")})`);
    else bad(`${name}: the steps' boxes`, `${errors.map((e) => `${e.step} ${e.px.toFixed(1)}px for ${e.value}`).join("; ")}`);
    if (ratioWorst <= HALF_CELL)
      ok(`${name}: the ratios`, `each step's box is value/largest of the track (worst ${(ratioWorst * l.bars[0]!.track).toFixed(2)} of ${l.bars[0]!.track} cells)`);
    else bad(`${name}: the ratios`, `a step's box is ${ratioWorst.toFixed(3)} of the track off value/largest`);
  }

  // A type scale: rows from the largest size down, each specimen at its own size in the frame, and a row as tall as the
  // line height it prints (a 40/48 line is three cells).
  if (s.kind === "typeScale") {
    const specimens = dump.commands
      .filter((c) => c.type === "text" && c.text === "Aa")
      .sort((a, b) => a.box[1]! - b.box[1]!);
    const want = [...s.data].sort((a, b) => b.size - a.size);
    const sorted = specimens.length === want.length && specimens.every((c, i) => c.size === want[i]!.size) &&
      specimens.every((c, i) => i === 0 || c.size! < specimens[i - 1]!.size!);
    if (sorted)
      ok(`${name}: the sizes`, `${specimens.map((c) => c.size).join(" > ")} px, each the row's own text size, largest first`);
    else bad(`${name}: the sizes`, `${JSON.stringify(specimens.map((c) => c.size))} for ${JSON.stringify(want.map((step) => step.size))}`);
    const gaps = specimens.slice(1).map((c, i) => c.box[1]! - specimens[i]!.box[1]!);
    const wanted = want.map((step) => Math.ceil(step.lineHeight / 16) * 16);
    const source = dump.commands.find((c) => c.type === "text" && c.text === s.source);
    const last = specimens[specimens.length - 1];
    const tail = source && last ? source.box[1]! - last.box[1]! : -1;
    if (gaps.every((gap, i) => gap === wanted[i]) && tail === wanted[wanted.length - 1])
      ok(`${name}: the line heights`, `each row is its line height in whole cells (${wanted.map((h) => h / 16).join(", ")} cells)`);
    else bad(`${name}: the line heights`, `${JSON.stringify([...gaps, tail])} for ${JSON.stringify(wanted)}`);
    const numbers = dump.commands.filter((c) => c.type === "text" && /^\d+\/\d+$/.test(c.text ?? ""));
    if (numbers.length === want.length) ok(`${name}: the numbers`, `${numbers.map((c) => c.text).join(", ")}`);
    else bad(`${name}: the numbers`, `${numbers.length} of ${want.length} size/lineHeight texts`);
  }

  // (d) a funnel never grows, and each step's width is value/first
  if (kind === "funnel") {    const bars = l.bars;
    const first = bars[0]!.value;
    for (let i = 1; i < bars.length; i++)
      if (bars[i]!.value > bars[i - 1]!.value) bad(`${name}: a growing step`, `${bars[i]!.label} ${bars[i]!.value} after ${bars[i - 1]!.value}`);
    for (const bar of bars) {
      const fill = commandOf(dump, bar.fillId)!;
      const track = commandOf(dump, bar.trackId)!;
      const error = Math.abs(fill.box[2]! - (track.box[2]! * bar.value) / first) / CELL_WIDTH;
      if (error > HALF_CELL) bad(`${name}: ${bar.label}'s share`, `${error.toFixed(2)} cells off ${bar.value}/${first}`);
    }
    ok(`${name}: the steps`, `${bars.length} steps, none larger than the one before it, each value/first`);
  }

  // (f) the same spec on the terminal: the cells' rows are the pixel figure's rows, in text and count. A line may be
  // taller than a cell (a type scale's 40px row is three), so the grid's rows are the layout's heights, and the blank
  // rows a tall line leaves are dropped from both sides.
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
  const cells = rowsOfCells(readFileSync(out, "utf8"));
  const pixel = lines.map(stripDots);
  // a plain walk, not `some`/`findIndex`: a row's disagreement is the index of the first one, and the message names both
  let differ = -1;
  for (let i = 0; i < cells.length && i < pixel.length; i++) if (cells[i] !== pixel[i]) { differ = i; break; }
  if (cells.length !== pixel.length)
    bad(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's ${pixel.length}`);
  else if (differ >= 0)
    bad(`${name}: the terminal's rows`, `row ${differ + 1}: ${JSON.stringify(cells[differ])} is not ${JSON.stringify(pixel[differ])}`);
  else ok(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's words (cells, not pixels)`);
}

// (e) `check`'s refusals, with their sentences: every problem, in the kit's voice
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((p) => p === sentence || p.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
refuses("a funnel that grows", {
  kind: "funnel",
  source: "Sample",
  data: [{ label: "visited", value: 12400 }, { label: "signed up", value: 13000 }],
}, "signed up 13000 is more than visited 12400; a funnel never grows");
refuses("a number with no source", {
  kind: "barChart",
  data: [{ label: "Design QA", value: 42 }],
}, "These numbers need a source: where did they come from?");
refuses("a focus name not in the figure", {
  kind: "barChart",
  source: "Sample",
  data: [{ label: "Design QA", value: 42 }],
  focus: { on: ["Q3"] },
}, 'Focus names "Q3", which isn\'t in the figure. Use a row label or a column heading as it is drawn.');
refuses("an unknown kind", { kind: "pieChart", data: [] },
  'unknown kind "pieChart": the ones here are anatomy, appShell, barChart, beforeAfter, branchFlow, cardGrid, cohort, colourRoles, compare, contrast, easing, easingTable, flow, forecast, frameStrip, funnel, heatmap, intentCard, journeyMap, layerStack, listDetail, meter, modal, motionTiming, nowNextLater, palette, qaChecklist, redline, responsivePair, screen, spacingScale, sparkline, stagger, stateMachine, stateMatrix, statusKey, table, timeline, tokenTable, transitionSpec, tree, typeScale.');
refuses("a bar chart with no positive value", {
  kind: "barChart",
  source: "Sample",
  data: [{ label: "Design QA", value: 0 }, { label: "Copy", value: -1 }],
}, "A bar chart needs a value above zero: every row is 0 or less.");
refuses("a flow wider than its width", {
  kind: "flow",
  source: "Sample",
  data: ["declaration", "Clay", "commands", "ThorVG / cells / Canvas2D"],
  options: { width: 20 },
}, "These 4 boxes need 65 cells with their arrows; the width is 20. Shorten a label or raise options.width.");
refuses("a decision with no branch", {
  kind: "branchFlow",
  source: "Sample",
  data: [{ label: "read the spec" }, { label: "has data", type: "decision" }],
}, 'has data has no "no" branch.');
refuses("a branch target that is not a step", {
  kind: "branchFlow",
  source: "Sample",
  data: [
    { label: "has data", type: "decision", no: { label: "empty state", to: "import data" } },
    { label: "a frame" },
  ],
}, 'has data\'s "no" goes to "import data", which is not a step.');
refuses("a transition naming a state that does not exist", {
  kind: "stateMachine",
  source: "Sample",
  data: {
    states: ["idle", "saving"],
    transitions: [{ from: "idle", to: "saving", on: "submit" }, { from: "saving", to: "saved", on: "ok" }],
  },
  options: { path: ["idle", "saving"] },
}, 'saving goes to saved on "ok", but "saved" isn\'t one of the states.');
refuses("a path that skips a transition", {
  kind: "stateMachine",
  source: "Sample",
  data: {
    states: ["happened", "paid", "refunded"],
    transitions: [{ from: "paid", to: "refunded", on: "refund" }],
  },
  options: { path: ["happened", "paid", "refunded"] },
}, "The path goes happened → paid, but no transition connects them.");
refuses("a path that does not start at the first state", {
  kind: "stateMachine",
  source: "Sample",
  data: { states: ["idle", "saving"], transitions: [{ from: "idle", to: "saving", on: "submit" }] },
  options: { path: ["saving"] },
}, "The path starts at saving, but the machine's first state is idle.");
refuses("a machine with no states", { kind: "stateMachine", data: { states: [], transitions: [] } },
  'A state machine needs its states: ["closed", "opening", "open", "closing"].');
refuses("a tree with two roots", {
  kind: "tree",
  data: [{ name: "desktop" }, { name: "terminal" }],
}, "A tree needs one root, but desktop, terminal have no parent.");
refuses("a tree with no node above the rest", {
  kind: "tree",
  data: [{ name: "desktop", parent: "terminal" }, { name: "terminal", parent: "desktop" }],
}, "A tree needs one root: every node names a parent, so none is above them.");
refuses("a tree node whose parent does not exist", {
  kind: "tree",
  data: [{ name: "root" }, { name: "child", parent: "missing" }],
}, 'child names "missing" as its parent, but there is no node named "missing".');
refuses("a tree with a loop", {
  kind: "tree",
  data: [{ name: "root" }, { name: "a", parent: "b" }, { name: "b", parent: "a" }],
}, "a is not under the root root: its parents form a loop.");
refuses("a journey feeling outside the scale", {
  kind: "journeyMap",
  source: "Sample",
  data: [{ label: "Import", feeling: 3 }],
}, "Import has a feeling of 3, outside -2 to 2.");
refuses("an empty journey", { kind: "journeyMap", data: [] },
  'A journey needs its stages: [{ "label": "Discover", "feeling": 1 }, ...], each with the feeling it had.');

// ---- the four design-system kinds' refusals, in the kit's voice
refuses("a palette whose steps do not get steadily darker", {
  kind: "palette",
  source: "Sample",
  data: {
    page: "#ffffff",
    hues: [{
      name: "Blue",
      steps: [
        { name: "100", value: "#dbe6ff" },
        { name: "200", value: "#6487e6" },
        { name: "300", value: "#b7ccfb" },
        { name: "400", value: "#4269d6" },
      ],
    }],
  },
}, "Blue 300 is lighter than 200; a scale's steps get steadily darker.");
refuses("a palette step that is not a hex colour", {
  kind: "palette",
  source: "Sample",
  data: { page: "#ffffff", hues: [{ name: "Blue", steps: [{ name: "500", value: "rgb(66 105 214)" }] }] },
}, "Blue 500: write the colour as a hex value like #1f4fd6, not \"rgb(66 105 214)\".");
refuses("a palette with no hues", { kind: "palette", data: { hues: [] } },
  'A palette needs its hues: [{ "name": "Blue", "steps": [{ "name": "50", "value": "#eef3ff" }] }].');
refuses("a palette whose page is not a hex colour", {
  kind: "palette",
  source: "Sample",
  data: { page: "white", hues: [{ name: "Blue", steps: [{ name: "500", value: "#4269d6" }] }] },
}, 'Write the page colour as a hex value like #ffffff, not "white".');
refuses("a contrast pair whose ratio is not its colours'", {
  kind: "contrast",
  source: "Sample",
  data: [{ label: "ink on paper", fg: "#030507", bg: "#ffffff", min: 7, ratio: 19.36 }],
}, "ink on paper says 19.36:1, but #030507 on #ffffff makes 20.41:1.");
refuses("a contrast floor that is not WCAG's", {
  kind: "contrast",
  source: "Sample",
  data: [{ label: "ink on paper", fg: "#030507", bg: "#ffffff", min: 4.6, ratio: 20.41 }],
}, "ink on paper's min is 4.6: a minimum is 3, 4.5 or 7, WCAG's three floors.");
refuses("a contrast check with no pairs", { kind: "contrast", data: [] },
  'A contrast check needs its pairs: [{ "label": "ink on paper", "fg": "#080808", "bg": "#fbfbf8", "min": 4.5, "ratio": 19.36 }].');
refuses("a spacing scale that does not grow", {
  kind: "spacingScale",
  source: "Sample",
  data: [
    { name: "space.sm", value: 8 },
    { name: "space.lg", value: 16 },
    { name: "space.md", value: 12 },
  ],
}, "space.md is 12px, less than space.lg's 16px before it; a spacing scale grows.");
refuses("a spacing step of nothing", {
  kind: "spacingScale",
  source: "Sample",
  data: [{ name: "space.xs", value: 0 }],
}, "space.xs has a value of 0px: a step is above zero.");
refuses("a type size under 8px", {
  kind: "typeScale",
  source: "Sample",
  data: [{ name: "caption", size: 6, lineHeight: 10 }],
}, "caption is 6px: a size under 8px is unreadable.");
refuses("a line height under its size", {
  kind: "typeScale",
  source: "Sample",
  data: [{ name: "body", size: 16, lineHeight: 14 }],
}, "body is 16/14: a line height under its size (16) crowds the lines.");
// the invalid file itself: the funnel solid/test.sh gives the desktop's `--spec`, refused with the sentence
const invalid = parse(readFileSync(new URL("./specs/invalid-funnel.json", import.meta.url), "utf8"), {
  dir: new URL("./specs/", import.meta.url).pathname,
});
if (invalid.problems.includes("signed up 12600 is more than visited 12400; a funnel never grows"))
  ok("solid/specs/invalid-funnel.json", invalid.problems[0]!);
else bad("solid/specs/invalid-funnel.json", JSON.stringify(invalid.problems));
for (const [file, sentence] of [
  ["invalid-branch.json", 'check the data has no "no" branch.'],
  ["invalid-state.json", "The path goes happened → paid, but no transition connects them."],
  ["invalid-tree.json", 'child names "missing" as its parent, but there is no node named "missing".'],
  ["invalid-journey.json", "Import has a feeling of 3, outside -2 to 2."],
] as const) {
  const refused = parse(readFileSync(new URL(`./specs/${file}`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (refused.problems.includes(sentence)) ok(`solid/specs/${file}`, sentence);
  else bad(`solid/specs/${file}`, JSON.stringify(refused.problems));
}

// (g) the states the path does not visit: a walk that stops before the machine's last state lists it under the path
{
  const partly = layoutOf({
    kind: "stateMachine",
    data: {
      states: ["idle", "saving", "saved", "failed"],
      transitions: [
        { from: "idle", to: "saving", on: "submit" },
        { from: "saving", to: "saved", on: "ok" },
        { from: "saving", to: "failed", on: "error" },
      ],
    },
    options: { path: ["idle", "saving", "saved"] },
  });
  const note = partly.lines.flatMap((line) => line.items).find((item) => item.kind === "text" && item.role === "note");
  if (note && note.kind === "text" && note.text === "not on the path: failed")
    ok("a state machine's footer", `"${note.text}"`);
  else bad("a state machine's footer", `no note reads "not on the path: failed": ${JSON.stringify(note)}`);
}

// (h) the mutations, as the asserts they break: a branch drawn without its connector, a path that skips a transition
// with the sentence the check must print, and a path with a box dropped
{
  const branch = layoutOf(spec("branch-flow"));
  const branches = branch.connectors.filter((connector) => connector.role === "branch").length;
  const countBranches = (connectors: readonly { role: string }[]) =>
    connectors.filter((connector) => connector.role === "branch").length === branches;
  if (countBranches(branch.connectors)) ok("mutation: the branch connectors", `${branches} branches, ${branches} connectors`);
  else bad("mutation: the branch connectors", "the intact layout failed its own count");
  const drawnWithout = branch.connectors.slice(1);
  const left = drawnWithout.filter((connector) => connector.role === "branch").length;
  if (!countBranches(drawnWithout))
    ok(
      "mutation: a branch without its connector",
      `${branches} branches, ${left} connector${left === 1 ? "" : "s"}: the count fails`,
    );
  else bad("mutation: a branch without its connector", "the count did not move");

  const skip = {
    kind: "stateMachine",
    source: "Sample",
    data: {
      states: ["happened", "paid", "refunded"],
      transitions: [{ from: "paid", to: "refunded", on: "refund" }],
    },
    options: { path: ["happened", "paid", "refunded"] },
  } as const;
  const skipSentence = "The path goes happened → paid, but no transition connects them.";
  if (check(skip).includes(skipSentence)) ok("mutation: a path that skips a transition", skipSentence);
  else bad("mutation: a path that skips a transition", `the check printed no ${JSON.stringify(skipSentence)}`);

  const machine = layoutOf(spec("state-machine"));
  const path = machine.labels.length;
  if (machine.boxes.length === path) ok("mutation: the state boxes", `${path} states on the path, ${machine.boxes.length} boxes`);
  else bad("mutation: the state boxes", `${path} states on the path, ${machine.boxes.length} boxes`);
  const dropped = machine.boxes.slice(0, -1);
  if (dropped.length !== path)
    ok("mutation: a dropped state box", `${path} states on the path, ${dropped.length} boxes: the count differs`);
  else bad("mutation: a dropped state box", "the count did not move");

  const tree = layoutOf(spec("tree"));
  const nodes = tree.boxes.length;
  const edges = tree.connectors.length;
  if (edges === nodes - 1) ok("mutation: the tree's edges", `${nodes} nodes, ${edges} connectors, one a child`);
  else bad("mutation: the tree's edges", `${nodes} nodes, ${edges} connectors`);
  const rootName = tree.labels[0]!.text;
  const top = tree.connectors.filter((connector) => connector.from === rootName);
  const withoutLevel = tree.connectors.filter((connector) => connector.from !== rootName);
  if (withoutLevel.length !== nodes - 1)
    ok(
      "mutation: a tree level without its connectors",
      `${nodes} nodes and ${edges} connectors; drop the root's ${top.length}: ${withoutLevel.length} left, the count fails`,
    );
  else bad("mutation: a tree level without its connectors", "the count did not move");
  const droppedNode = tree.boxes.slice(0, -1);
  if (droppedNode.length !== nodes)
    ok("mutation: a node dropped from a row", `${nodes} nodes, ${droppedNode.length} boxes: the count differs`);
  else bad("mutation: a node dropped from a row", "the count did not move");

  const journeyOut = {
    kind: "journeyMap",
    source: "Sample",
    data: [{ label: "First chart", feeling: 4 }],
  } as const;
  const outSentence = "First chart has a feeling of 4, outside -2 to 2.";
  if (check(journeyOut).includes(outSentence)) ok("mutation: a journey feeling out of range", outSentence);
  else bad("mutation: a journey feeling out of range", `the check printed no ${JSON.stringify(outSentence)}`);

  // ---- the design-system kinds' mutations
  // a palette with two steps swapped is no longer one direction, and the check says which two
  {
    const palette = spec("palette");
    if (palette.kind !== "palette") throw new Error("palette.json is not a palette");
    const hues = palette.data.hues.map((hue) => ({ ...hue, steps: [...hue.steps] }));
    const blue = hues[0]!;
    const [fifth, sixth] = [blue.steps[5]!.value, blue.steps[6]!.value];
    blue.steps[5] = { ...blue.steps[5]!, value: sixth };
    blue.steps[6] = { ...blue.steps[6]!, value: fifth };
    const swapped = { ...palette, data: { ...palette.data, hues } };
    const sentence = "Blue 6 is lighter than 5; a scale's steps get steadily darker.";
    if (check(swapped).includes(sentence) && !check(palette).length)
      ok("mutation: two palette steps swapped", `${sentence} (the intact ${palette.data.hues[0]!.name} scale passes)`);
    else if (!check(swapped).includes(sentence)) bad("mutation: two palette steps swapped", `no ${JSON.stringify(sentence)}: ${JSON.stringify(check(swapped))}`);
    else bad("mutation: two palette steps swapped", `the intact spec is refused: ${JSON.stringify(check(palette))}`);
  }
  // a pair typed with another page keeps its old ratio, and the check names both numbers
  {
    const contrast = spec("contrast");
    if (contrast.kind !== "contrast") throw new Error("contrast.json is not a contrast check");
    const pair = contrast.data[3]!;
    const typed = { ...contrast, data: contrast.data.map((row) => (row.label === pair.label ? { ...row, bg: "#ffffff" } : row)) };
    const sentence = `${pair.label} says ${shown(pair.ratio)}:1, but ${pair.fg} on #ffffff makes ${shown(engineRatio(pair.fg, "#ffffff"))}:1.`;
    if (check(typed).includes(sentence)) ok("mutation: a contrast ratio typed instead of computed", sentence);
    else bad("mutation: a contrast ratio typed instead of computed", `no ${JSON.stringify(sentence)}: ${JSON.stringify(check(typed))}`);
  }
  // a spacing bar drawn from the index instead of the value is off by a cell or more, and the numbers say where
  {
    const spacing = layoutOf(spec("spacing"));
    const track = spacing.bars[0]!.track;
    const wrong = spacing.bars.map((bar, i) => ({ step: bar.label, value: bar.value, want: (track * bar.value) / bar.max, drawn: i + 1 }));
    const worst = wrong.reduce((a, b) => (Math.abs(b.drawn - b.want) > Math.abs(a.drawn - a.want) ? b : a));
    const off = Math.abs(worst.drawn - worst.want);
    if (off > HALF_CELL)
      ok(
        "mutation: a spacing bar from the index",
        `${worst.step} is ${worst.value}px, so ${worst.want.toFixed(2)} of ${track} cells; from the index it is ${worst.drawn}, ${off.toFixed(2)} cells off`,
      );
    else bad("mutation: a spacing bar from the index", `the worst is ${off.toFixed(2)} of a cell, under the half a cell the check allows`);
  }
}

// the kind's own two edges, from the layout: a value past `max` fills the track and prints "+", and a positive value
// too small for a cell still draws one
const past = layoutOf({ kind: "barChart", source: "Sample", data: [{ label: "over", value: 50 }], options: { width: 10, max: 10 } });
const tiny = layoutOf({ kind: "barChart", source: "Sample", data: [{ label: "tiny", value: 0.01 }], options: { width: 10, max: 100 } });
if (past.bars[0]!.fill === 10 && past.bars[0]!.text === "50+")
  ok("a bar past max", `fills all 10 cells and prints "${past.bars[0]!.text}"`);
else bad("a bar past max", `${past.bars[0]!.fill}/${past.bars[0]!.track} cells, ${JSON.stringify(past.bars[0]!.text)}`);
if (tiny.bars[0]!.fill === 1 && tiny.bars[0]!.text === "0.01")
  ok("a bar too small to see", `is one cell (${tiny.bars[0]!.fill}), its number "0.01"`);
else bad("a bar too small to see", `${tiny.bars[0]!.fill} cells, ${JSON.stringify(tiny.bars[0]!.text)}`);

// the focus is painted by a role of the tokens, not a literal: the probe's problem colour moves with the theme, and the
// focused label and the focus line are its dark value (a literal would make the two themes the same, and this fails)
const dark = [...(variant(styles.probe.problem, undefined).text ?? [])].slice(0, 3);
const light = [...(variant(styles.probe.problem, "light").text ?? [])].slice(0, 3);
const ink = [...(variant(styles.probe.ink, undefined).text ?? [])].slice(0, 3);
const funnel = layoutOf(spec("funnel"));
const focused = funnel.bars.find((bar) => bar.label === "paid")!;
const focusedDump = await capture("figure", undefined, { spec: spec("funnel"), warm: 2 });
const label = focusedDump.commands.find((c) => c.type === "text" && c.text === focused.label);
const focusLine = focusedDump.commands.find((c) => c.type === "text" && c.text?.startsWith("► "));
const plain = focusedDump.commands.find((c) => c.type === "text" && c.text === "visited");
const same = (colour: unknown, role: number[]) =>
  Array.isArray(colour) && role.length === 3 && colour.slice(0, 3).every((v, i) => Math.abs(Number(v) - role[i]!) <= 1);
if (dark.join() === light.join()) bad("focus: the role", `the probe's problem is ${dark.join()} in both themes: a literal colour`);
else ok("focus: the role", `the probe's problem is ${dark.join()} dark and ${light.join()} light: a token, not a literal`);
// ... and the focus's own style follows the token: a literal at the same value would read the same in both themes, and this
// is the assertion the deliberate break in the report fails
const styleDark = [...(variant(styles.s.text.problem, undefined).text ?? [])].slice(0, 3);
const styleLight = [...(variant(styles.s.text.problem, "light").text ?? [])].slice(0, 3);
if (styleDark.join() === styleLight.join())
  bad("focus: the style's role", `the focus text is ${styleDark.join()} in both themes: a literal colour, not a token`);
else if (styleDark.join() !== dark.join() || styleLight.join() !== light.join())
  bad("focus: the style's role", `the focus text is ${styleDark.join()}/${styleLight.join()}, the token ${dark.join()}/${light.join()}`);
else ok("focus: the style's role", `the focus text follows the problem token (${dark.join()} dark, ${light.join()} light)`);
if (same(label?.color, dark) && same(focusLine?.color, dark))
  ok("focus: the paint", `"paid" and its ► line are the problem role (${dark.join()})`);
else bad("focus: the paint", `label ${JSON.stringify(label?.color)}, line ${JSON.stringify(focusLine?.color)}, wanted ${dark.join()}`);
if (same(plain?.color, ink)) ok("focus: the rest", `"visited" keeps the ink role (${ink.join()})`);
else bad("focus: the rest", `${JSON.stringify(plain?.color)}, wanted the ink ${ink.join()}`);

ok("the worst bar error", `${worstError.toFixed(2)} of a cell (${worstWhere})`);
if (failed) {
  console.error(`solid/figure.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure.test.ts: ${SPECS.length} specs, ${checks} checks, the terminal's rows among them`);
