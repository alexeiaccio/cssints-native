// The handoff and QA kinds' invariants, read back from the frame and held to their sources:
//
//   (a) redline: the parts' drawn x positions and widths against the spec's pixels (the worst error in px), each inside
//       the box; every part's numbers drawn; and the spec's numbers held to the **page's packed style** (app/Widgets.tsx's
//       row, track and thumb through src/pack.ts) — a redline whose numbers disagree with the page is the one failure the
//       kind cannot have.
//   (b) beforeAfter: the two boxes drawn on one row (and their sizes the states'), the numbers that changed recomputed
//       from the two Widgets frames, and two states whose boxes differ drawn 2 cells apart, with the box's change as a row.
//   (c) qaChecklist: the summary the rows count, its bar the passes, every row's name in the frame, and one role a verdict
//       (a mixed spec's three).
//   (d) `check`'s refusals, with their sentences.
//   (e) the mutations: a part outside its box, a caption that contradicts the frames, a summary off by one.
//   (f) the same three specs on the terminal, cell for cell, and the command goldens.
//
//   bun solid/figure-handoff.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { QaChecklistSpec, RedlineSpec } from "./src/figure/spec.ts";

const { capture } = await import("./dump.ts");
const { CELL_HEIGHT, CELL_WIDTH, layoutOf, PADDING_X, PADDING_Y } = await import("./src/figure/kinds.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { changesOf, summaryOf } = await import("./src/figure/kinds/handoff.ts");
const { format } = await import("./src/format.ts");
const { FIELDS, variant } = await import("./src/pack.ts");
const styles = await import("./app/Figure.styles.ts");
const widgets = await import("./app/Widgets.tsx");

/** A part of the redline's leader row may round to the nearest half cell, and no more: a cell is 8px. */
const HALF_CELL = CELL_WIDTH / 2;
/** A row of the before/after may round to the nearest half a cell down: 16px. */
const HALF_ROW = CELL_HEIGHT / 2;
const SPECS = ["redline", "before-after", "qa-checklist"] as const;
const GOLDENS: Record<(typeof SPECS)[number], string> = {
  redline: "figure-redline",
  "before-after": "figure-before-after",
  "qa-checklist": "figure-qa-checklist",
};

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
interface Cmd {
  element: string | null;
  type: string;
  box: number[];
  text?: string;
  color?: number[];
}
/** The figure's lines as words: each text command at its own cell column, then the row's blanks collapsed — the
 *  terminal's own grid, so a contiguous run of leader cells (the redline's) reads as one run and not as items joined by
 *  spaces. */
function rowsOfFrame(dump: { commands: Cmd[] }): string[] {
  const rows = new Map<number, Map<number, string>>();
  for (const c of dump.commands)
    if (c.type === "text" && c.text !== undefined) {
      const row = Math.round(c.box[1]! / CELL_HEIGHT);
      const line = rows.get(row) ?? new Map<number, string>();
      line.set(Math.round(c.box[0]! / CELL_WIDTH), c.text);
      rows.set(row, line);
    }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => {
      let out = "";
      for (const [col, text] of [...cells.entries()].sort((a, b) => a[0] - b[0])) out = out.padEnd(col, " ") + text;
      return out.replace(/\s+/g, " ").trim();
    });
}
const stripDots = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines.slice(0, at < 0 ? lines.length : at).map(stripDots).filter(Boolean);
}
/** Every text command at one row of the grid, left to right: the row's items, in drawing order. */
const textsAt = (dump: { commands: Cmd[] }, row: number) =>
  dump.commands
    .filter((c) => c.type === "text" && c.text !== undefined && Math.round(c.box[1]! / CELL_HEIGHT) === row)
    .sort((a, b) => a.box[0]! - b.box[0]!);
/** A layout's item by its name: `textItem` writes `<id>-cell` on the box and `<id>` on the text, so either finds it. */
const itemOf = (layout: { lines: { items: { id: string }[] }[] }, id: string) =>
  layout.lines.flatMap((line) => line.items).find((item) => item.id === id || item.id === `${id}-cell`);
/** A text item's own name: the text's id, which the box's `<id>-cell` wraps. */
const nameOf = (item: { id: string; textId?: string }) => item.textId ?? item.id.replace(/-cell$/, "");
/** The line a text id is on, and its own row of the grid: the padding above and the heights before it. */
function rowOf(layout: { lines: { items: { id: string }[]; height?: number }[] }, id: string): number {
  const at = layout.lines.findIndex((line) =>
    line.items.some((item) => item.id === id || item.id === `${id}-cell`),
  );
  if (at < 0) throw new Error(`no line holds ${id}`);
  return PADDING_Y + layout.lines.slice(0, at).reduce((n, line) => n + (line.height ?? 1), 0);
}
/** A text command's colour as the role's three channels (a frame's alpha is 255). */
const sameColour = (colour: number[] | undefined, role: number[]) =>
  Array.isArray(colour) && role.length >= 3 && [0, 1, 2].every((i) => Math.abs(Number(colour[i]) - role[i]!) <= 1);
const roleOf = (shape: unknown) => [...(variant(shape as never, undefined).text ?? [])].slice(0, 3);

const work = mkdtempSync(join(tmpdir(), "cssints-figure-handoff-"));

// ---- (a) the redline: the parts from the frame, the numbers from the page's packed style ----------------------------------
{
  const s = spec("redline");
  if (s.kind !== "redline") throw new Error("redline.json is not a redline");
  const layout = layoutOf(s);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const boxItem = itemOf(layout, "fig-redline-box");
  const boxCells = boxItem?.cells ?? 0;
  const boxX = PADDING_X * CELL_WIDTH;
  const leaderRow = rowOf(layout, "fig-redline-part-0");
  const drawn = textsAt(dump, leaderRow);
  const parts = s.data.parts;
  let worstInset = 0;
  let worstWidth = 0;

  if (drawn.length === parts.length && boxCells > 0) {
    // the box's own width: the outline's cells are what the page writes (item.cells * 8), against the data's pixels
    const boxError = Math.abs(boxCells * CELL_WIDTH - s.data.box.width);
    if (boxError <= HALF_CELL)
      ok(
        `redline: the box`,
        `${boxCells} cells (${boxCells * CELL_WIDTH}px) for the row's ${s.data.box.width}px, ${boxError.toFixed(1)}px out`,
      );
    else bad("redline: the box", `${boxCells * CELL_WIDTH}px for ${s.data.box.width}px, over half a cell`);
    const where: string[] = [];
    let outside = 0;
    parts.forEach((part, i) => {
      const x = drawn[i]!.box[0]! - boxX;
      const end = i + 1 < drawn.length ? drawn[i + 1]!.box[0]! - boxX : boxCells * CELL_WIDTH;
      const width = end - x;
      worstInset = Math.max(worstInset, Math.abs(x - part.x));
      worstWidth = Math.max(worstWidth, Math.abs(width - part.width));
      if (x < 0 || x + width > boxCells * CELL_WIDTH) outside++;
      where.push(`${part.label} ${x.toFixed(0)},${width.toFixed(0)}`);
    });
    if (!outside) ok(`redline: the parts are inside the box`, `${parts.length} parts within 0..${boxCells * CELL_WIDTH}px`);
    else bad("redline: the parts are inside the box", `${outside} of ${parts.length} outside 0..${boxCells * CELL_WIDTH}px`);
    if (worstInset <= HALF_CELL && worstWidth <= HALF_CELL)
      ok(
        `redline: the leaders`,
        `${where.join(", ")} — the worst inset ${worstInset.toFixed(1)}px and width ${worstWidth.toFixed(1)}px out of the ` +
          `numbers (half a cell allowed: a leader rounds to the cell)`,
      );
    else bad("redline: the leaders", `worst inset ${worstInset.toFixed(1)}px, worst width ${worstWidth.toFixed(1)}px`);
    // every number the spec carries is drawn: `x,y WxH` a part, in the parts' order
    const legend = dump.commands.filter((c) => c.type === "text" && (c.text ?? "").includes("x")).map((c) => c.text!).join(" ");
    const missing = parts.filter((part) => !legend.includes(`${part.x},${part.y} ${part.width}x${part.height}`));
    if (!missing.length)
      ok(`redline: the numbers drawn`, `${parts.length} parts' x, y and size in the numbers row (${legend.slice(0, 60)}…)`);
    else bad("redline: the numbers drawn", `${missing.length} of ${parts.length} are not: ${missing[0]!.label} first`);
  } else bad("redline: the leader row", `${drawn.length} text commands for ${parts.length} parts, box ${boxCells} cells`);

  // the spec's numbers against the page's own style: `s.row`'s padding and gap, `s.track`'s 44x24, `s.thumb`'s 20x20, and
  // the page's width and the root's padding. Read from the packed style, so a style change that left the spec stale fails
  // here with the number that moved.
  const row = variant(widgets.s.row as never).box!;
  const track = variant(widgets.s.track as never).box!;
  const thumb = variant(widgets.s.thumb as never).box!;
  const root = variant(widgets.s.root as never).box!;
  const [left, right, top, bottom] = [row[FIELDS.PADDING]!, row[FIELDS.PADDING + 1]!, row[FIELDS.PADDING + 2]!, row[FIELDS.PADDING + 3]!];
  const gap = row[FIELDS.GAP]!;
  const trackWidth = track[FIELDS.WIDTH + 2]!;
  const trackHeight = track[FIELDS.HEIGHT + 2]!;
  const pageWidth = widgets.size.width - root[FIELDS.PADDING]! - root[FIELDS.PADDING + 1]!;
  const boxHeight = top + trackHeight + bottom;
  const labelWidth = pageWidth - left - trackWidth - gap - right;
  const want: Record<string, [number, number, number, number]> = {
    [`padding left`]: [0, 0, left, boxHeight],
    track: [left, top, trackWidth, trackHeight],
    gap: [left + trackWidth, 0, gap, boxHeight],
    label: [left + trackWidth + gap, (boxHeight - 16) / 2, labelWidth, 16],
    [`padding right`]: [pageWidth - right, 0, right, boxHeight],
  };
  const stale = parts.filter((part) => {
    const at = want[part.label];
    return !at || at[0] !== part.x || at[1] !== part.y || at[2] !== part.width || at[3] !== part.height;
  });
  if (!stale.length && parts.length === Object.keys(want).length)
    ok(
      `redline: the page's own numbers`,
      `the row's ${left} padding and ${gap} gap, the ${trackWidth}x${trackHeight} track, the ${labelWidth} label — every ` +
        `number the packed style says (0px out, and the drawn leaders ${Math.max(worstInset, worstWidth).toFixed(1)}px)`,
    );
  else
    bad(
      "redline: the page's own numbers",
      stale.length
        ? `${stale.map((part) => `${part.label} is ${part.x},${part.y} ${part.width}x${part.height}, the style's ${JSON.stringify(want[part.label])}`).join("; ")}`
        : `${parts.length} parts for the style's ${Object.keys(want).length}`,
    );
  if (thumb[FIELDS.WIDTH + 2]! + 2 * track[FIELDS.PADDING]! === trackHeight)
    ok(
      "redline: the track's inset",
      `the ${thumb[FIELDS.WIDTH + 2]}x${thumb[FIELDS.HEIGHT + 2]} thumb inside the track's ${track[FIELDS.PADDING]!}px padding ` +
        `leaves ${trackHeight}px — the track's own height, the number the redline's box height uses`,
    );
  else bad("redline: the track's inset", "the thumb and the track's padding are not the track's height");
}

// ---- (b) the before/after: two boxes on one row, and the difference the frames make --------------------------------------
{
  const s = spec("before-after");
  if (s.kind !== "beforeAfter") throw new Error("before-after.json is not a before/after");
  const layout = layoutOf(s);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const boxRow = rowOf(layout, "fig-before-box");
  const boxes = textsAt(dump, boxRow);
  const [beforeBox, afterBox] = boxes;
  const beforeItem = itemOf(layout, "fig-before-box")!;
  const afterItem = itemOf(layout, "fig-after-box")!;
  if (beforeBox && afterBox && beforeItem && afterItem) {
    // the two boxes are drawn on one row (the eye compares them), in their own columns
    if (beforeBox.box[1] === afterBox.box[1])
      ok(
        `before/after: one row`,
        `both boxes start at y ${beforeBox.box[1]!.toFixed(0)}px; ${beforeBox.box[0]!.toFixed(0)} and ` +
          `${afterBox.box[0]!.toFixed(0)}px across`,
      );
    else bad("before/after: one row", `the boxes are at ${beforeBox.box[1]} and ${afterBox.box[1]}`);
    const column = afterBox.box[0]! - beforeBox.box[0]!;
    // the column is the caption's width (the panel's widest row) and the two cells between the panels
    const captionCells = itemOf(layout, "fig-before-caption")!.cells;
    const wanted = (captionCells + 2) * CELL_WIDTH;
    if (column === wanted) ok("before/after: the columns", `${column}px between the boxes' left edges (${captionCells + 2} cells)`);
    else bad("before/after: the columns", `${column}px, the layout's ${wanted}px`);
    // each box's drawn size against its state's, in cells
    const widthError = Math.max(
      Math.abs(beforeItem.cells * CELL_WIDTH - s.data.before.box.width),
      Math.abs(afterItem.cells * CELL_WIDTH - s.data.after.box.width),
    );
    const rowsDrawn = layout.lines.filter((line) =>
      line.items.some((item) => /^fig-before-box(-end|-\d+)?$/.test(nameOf(item))),
    ).length;
    const heightError = Math.abs(rowsDrawn * CELL_HEIGHT - s.data.before.box.height);
    if (widthError <= HALF_CELL && heightError <= HALF_ROW)
      ok(
        `before/after: the boxes`,
        `${beforeItem.cells}x${rowsDrawn} cells for ${s.data.before.box.width}x${s.data.before.box.height}px, ` +
          `${widthError.toFixed(1)}px across and ${heightError.toFixed(1)}px down (half a cell either way)`,
      );
    else bad("before/after: the boxes", `${widthError.toFixed(1)}px across, ${heightError.toFixed(1)}px down`);
  } else bad("before/after: the boxes", `${boxes.length} text commands on the box's row`);
  // the numbers that changed: the two states' own, drawn under the panels
  const changes = changesOf(s.data);
  const drawnChanges = dump.commands.filter((c) => c.type === "text" && c.text?.includes(" -> ")).map((c) => c.text!);
  const missing = changes.filter((change) => !drawnChanges.some((text) => text === `${change.before} -> ${change.after}`));
  if (!missing.length && changes.length)
    ok(
      `before/after: the numbers that changed`,
      changes.map((change) => `${change.label} ${change.before} -> ${change.after}`).join(", "),
    );
  else bad("before/after: the numbers that changed", `${drawnChanges.length} drawn for ${changes.length}: ${JSON.stringify(missing)}`);
  // ... and recomputed from the two Widgets frames: the track's colour (the rectangle whose colour moved) and the thumb's
  // x. This is `specs/from-frames.ts`'s whole job, held here by a second reading of the same two frames.
  const off = await capture("widgets", undefined, { keys: ["Tab", "Tab"] });
  const on = await capture("widgets", undefined, { keys: ["Tab", "Tab", "Space"] });
  const moved = off.commands
    .map((command, index) => ({ command, other: on.commands[index]! }))
    .filter(({ command, other }) => JSON.stringify(command) !== JSON.stringify(other));
  const colour = moved.find(({ command, other }) => JSON.stringify(command.color) !== JSON.stringify(other.color));
  const shifted = moved.find(({ command, other }) => command.box[0] !== other.box[0]);
  const rgb = (value: readonly number[] | undefined) => (value ?? []).slice(0, 3).map(Math.round).join(",");
  const fromFrames = colour && shifted
    ? [
        { label: "the track", before: rgb(colour.command.color), after: rgb(colour.other.color) },
        {
          label: "the thumb",
          before: `${Math.round(shifted.command.box[0]! - colour.command.box[0]!)}px`,
          after: `${Math.round(shifted.other.box[0]! - colour.command.box[0]!)}px`,
        },
      ]
    : [];
  const specMeasures = s.data.before.measures.map((measure, i) => ({
    label: measure.label,
    before: measure.value,
    after: s.data.after.measures[i]!.value,
  }));
  if (moved.length === 2 && JSON.stringify(fromFrames) === JSON.stringify(specMeasures))
    ok(
      `before/after: the frames' own difference`,
      `${moved.length} command(s) differ (the track's colour, the thumb's x); the spec's ${specMeasures.length} measures are ` +
        `theirs (${specMeasures.map((measure) => `${measure.label} ${measure.before} -> ${measure.after}`).join(", ")})`,
    );
  else bad("before/after: the frames' own difference", `${JSON.stringify(fromFrames)} against ${JSON.stringify(specMeasures)}`);

  // ... and a box whose width changed: the two boxes draw two cells apart, and the difference is the changed row's own
  // number (`the box 44x24 -> 60x24`), which is the caption of the change.
  const wide = {
    ...s,
    data: { ...s.data, after: { ...s.data.after, box: { width: 60, height: 24 } } },
  };
  const wideLayout = layoutOf(wide);
  const wideDump = await capture("figure", undefined, { spec: wide, warm: 2 });
  const before = itemOf(wideLayout, "fig-before-box")!;
  const after = itemOf(wideLayout, "fig-after-box")!;
  const drawn = after.cells * CELL_WIDTH - before.cells * CELL_WIDTH;
  const numbers = changesOf(wide.data).find((change) => change.label === "the box");
  const text = `${numbers?.before} -> ${numbers?.after}`;
  if (numbers && Math.abs(drawn - (wide.data.after.box.width - wide.data.before.box.width)) <= CELL_WIDTH &&
      wideDump.commands.some((command) => command.type === "text" && command.text === text))
    ok(
      "before/after: a box's width changed",
      `the boxes draw ${before.cells * CELL_WIDTH} and ${after.cells * CELL_WIDTH}px (${drawn}px apart) for 44 and 60px, ` +
        `and the row says "${text}"`,
    );
  else bad("before/after: a box's width changed", `${JSON.stringify([before.cells, after.cells])} for ${text}`);

  // ... and a narrow target stacks the same rows: a measure too wide for two columns puts the after panel under the before
  const narrow = {
    ...s,
    data: {
      ...s.data,
      before: { ...s.data.before, measures: [{ label: "the track", value: "60,64,78 at 44 by 24 with the thumb at 2, off and focused" }] },
      after: { ...s.data.after, measures: [{ label: "the track", value: "240,140,50 at 44 by 24 with the thumb at 22, on and focused" }] },
    },
  };
  const narrowLayout = layoutOf(narrow);
  const stackedDump = await capture("figure", undefined, { spec: narrow, warm: 2 });
  const beforeCaption = textsAt(stackedDump, rowOf(narrowLayout, "fig-before-caption"))[0];
  const afterCaption = textsAt(stackedDump, rowOf(narrowLayout, "fig-after-caption"))[0];
  if (beforeCaption && afterCaption && afterCaption.box[1]! > beforeCaption.box[1]!)
    ok(
      "before/after: stacked when narrow",
      `the columns would be ${itemOf(narrowLayout, "fig-before-caption")!.cells * 2 + 2} cells, so the after panel is ` +
        `${afterCaption.box[1]! - beforeCaption.box[1]!}px under the before's`,
    );
  else bad("before/after: stacked when narrow", `${JSON.stringify([beforeCaption?.box, afterCaption?.box])}`);
}

// ---- (c) the checklist: the summary counts its rows, and one role a verdict -----------------------------------------------
{
  const s = spec("qa-checklist");
  if (s.kind !== "qaChecklist") throw new Error("qa-checklist.json is not a checklist");
  const layout = layoutOf(s);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const summary = summaryOf(s.data.rows);
  const summaryText = dump.commands.find((c) => c.type === "text" && c.text === s.data.summary);
  const bar = layout.bars[0]!;
  const fill = dump.commands.find((c) => c.element === bar.fillId);
  const track = dump.commands.find((c) => c.element === bar.trackId);
  const pass = s.data.rows.filter((row) => row.verdict === "pass").length;
  if (summary === s.data.summary && s.data.summary === `${pass} of ${s.data.rows.length} pass` && summaryText)
    ok(`checklist: the summary`, `"${s.data.summary}" — the ${s.data.rows.length} rows counted, and drawn`);
  else bad("checklist: the summary", `"${s.data.summary}" for the rows' "${summary}"`);
  if (fill && track && fill.box[2] === track.box[2] && track.box[2] === pass * CELL_WIDTH)
    ok(
      `checklist: the passes' bar`,
      `${pass} of ${s.data.rows.length} cells (${track.box[2]!.toFixed(0)}px: the track is the rows, the fill the passes)`,
    );
  else bad("checklist: the passes' bar", `${JSON.stringify(fill?.box)} and ${JSON.stringify(track?.box)} for ${pass}/${s.data.rows.length}`);
  const names = dump.commands.filter((c) => c.type === "text").map((c) => c.text!);
  const undrawn = s.data.rows.filter((row) => !names.includes(row.check) || !names.includes(row.area));
  if (!undrawn.length)
    ok(`checklist: the rows`, `${s.data.rows.length} checks and their areas, as the suite names them`);
  else bad("checklist: the rows", `${undrawn.length} of ${s.data.rows.length} are not drawn: ${undrawn[0]!.check}`);

  // a mixed spec: the three verdicts in the three roles, one role a state, in the rows and in the key
  const mixed: QaChecklistSpec = {
    kind: "qaChecklist",
    title: "A checklist of all three",
    source: "Sample",
    data: {
      summary: "1 of 3 pass",
      rows: [
        { check: "a stored frame", area: "frames", verdict: "pass", source: "Sample" },
        { check: "a comparison", area: "terminal", verdict: "fail", source: "Sample" },
        { check: "a skipped one", area: "browser", verdict: "n/a", source: "Sample" },
      ],
    },
  };
  const mixedLayout = layoutOf(mixed);
  const mixedDump = await capture("figure", undefined, { spec: mixed, warm: 2 });
  const roles = {
    pass: roleOf(styles.s.text.good),
    fail: roleOf(styles.s.text.problem),
    "n/a": roleOf(styles.s.text.muted),
  };
  const painted = (["pass", "fail", "n/a"] as const).map((verdict, i) => {
    const row = rowOf(mixedLayout, `fig-qa-verdict-${i}`);
    const command = textsAt(mixedDump, row).find((c) => c.text === verdict);
    return { verdict, command, want: roles[verdict] };
  });
  const wrongRole = painted.filter((row) => !row.command || !sameColour(row.command.color, row.want));
  if (!wrongRole.length && new Set(Object.values(roles).map((role) => role.join())).size === 3)
    ok(
      "checklist: the verdicts' roles",
      `pass ${roles.pass.join()}, fail ${roles.fail.join()}, n/a ${roles["n/a"].join()} — one role a state, and the three differ`,
    );
  else
    bad(
      "checklist: the verdicts' roles",
      wrongRole
        .map((row) => `${row.verdict}: ${JSON.stringify(row.command?.color)} for ${row.want.join()}`)
        .join("; ") || "the three roles are not distinct",
    );
  // the key: the three marks in the same three roles, drawn
  const keyRows = (["pass", "fail", "n/a"] as const).map((verdict) => {
    const id = `fig-qa-key-${verdict.replace("/", "")}`;
    const line = mixedLayout.lines.find((l) => l.items.some((item) => nameOf(item).startsWith(id)));
    const item = line?.items.find((entry) => nameOf(entry).startsWith(id));
    const text = item && "text" in item ? item.text : "";
    const command = mixedDump.commands.find((c) => c.type === "text" && c.text === text);
    return { verdict, text, command };
  });
  if (keyRows.every((row) => row.command && sameColour(row.command.color, roles[row.verdict])))
    ok("checklist: the key", keyRows.map((row) => row.text.trim()).join(" · "));
  else bad("checklist: the key", JSON.stringify(keyRows.map((row) => [row.text, row.command?.color])));

  // every row is a test the suite runs: the file `test.sh` names after `bun`. A row naming a test the suite does not run
  // fails here.
  const stray = s.data.rows.filter((row) => {
    let text = "";
    try {
      text = readFileSync(new URL(`../${row.source.replace(/^native\//, "")}`, import.meta.url), "utf8");
    } catch {
      return true;
    }
    return !text.includes(`${row.check}.test.ts`);
  });
  if (!stray.length)
    ok(
      `checklist: the rows are the suite's`,
      `${s.data.rows.length} names, each a \`<name>.test.ts\` of \`test.sh\` ` +
        `(${[...new Set(s.data.rows.map((row) => row.source))].join(", ")})`,
    );
  else bad("checklist: the rows are the suite's", `${stray.length} not in their script: ${stray[0]!.check}`);
}

// ---- (d) `check`'s refusals, with their sentences -------------------------------------------------------------------------
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((p) => p === sentence || p.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const redlineOf = (data: unknown) => ({ kind: "redline", source: "Sample", data });
const beforeAfterOf = (data: unknown) => ({ kind: "beforeAfter", source: "Sample", data });
const checklistOf = (data: unknown) => ({ kind: "qaChecklist", source: "Sample", data });
const STATE = {
  caption: "off",
  box: { width: 44, height: 24 },
  measures: [{ label: "the thumb", value: "2px" }],
};

refuses("a redline part whose inset is outside the box", redlineOf({
  box: { label: "row", width: 280, height: 32 },
  parts: [
    { label: "padding", x: 0, y: 0, width: 10, height: 32, inset: true },
    { label: "track", x: 300, y: 4, width: 44, height: 24 },
  ],
}), "track starts at 300px, but row is 280px wide: an inset is inside its box.");
refuses("a redline part that ends past the box", redlineOf({
  box: { label: "row", width: 280, height: 32 },
  parts: [
    { label: "track", x: 0, y: 4, width: 44, height: 24 },
    { label: "label", x: 44, y: 8, width: 260, height: 16 },
  ],
}), "label ends at 304px, past row's 280px: a part is inside its box.");
refuses("a redline part that is not below the one before it", redlineOf({
  box: { label: "row", width: 280, height: 32 },
  parts: [
    { label: "track", x: 0, y: 4, width: 44, height: 24 },
    { label: "label", x: 40, y: 8, width: 100, height: 16 },
  ],
}), "label starts at 40px, inside the part before it (44px): a redline's parts tile its width.");
refuses("a redline with no parts", redlineOf({ box: { label: "row", width: 280, height: 32 }, parts: [] }),
  'A redline needs its parts: [{ "label": "track", "x": 10, "y": 4, "width": 44, "height": 24 }, ...], in pixels from the box\'s corner.');
refuses("a before/after with an empty caption", beforeAfterOf({
  before: { ...STATE, caption: "" },
  after: { ...STATE, caption: "on", measures: [{ label: "the thumb", value: "22px" }] },
}), "The before state needs a caption: what it is, like \"off\".");
refuses("two states captioned the same whose boxes differ", beforeAfterOf({
  before: { ...STATE, box: { width: 44, height: 24 }, measures: [{ label: "the thumb", value: "2px" }] },
  after: { ...STATE, box: { width: 60, height: 24 }, measures: [{ label: "the thumb", value: "22px" }] },
}), 'Both states are captioned "off", but their boxes differ (44x24 against 60x24): a caption names the state.');
refuses("a before/after with nothing changed", beforeAfterOf({
  before: { ...STATE, caption: "off" },
  after: { ...STATE, caption: "on" },
}), 'Nothing changes between "off" and "on": a before/after needs a number that changed, like the track\'s colour or the box\'s width.');
refuses("a before/after measuring different things", beforeAfterOf({
  before: { ...STATE, caption: "off" },
  after: { ...STATE, caption: "on", box: { width: 50, height: 24 }, measures: [{ label: "the track", value: "x" }] },
}), 'The before measures "the thumb" and the after does not: a before/after measures the same things twice.');
refuses("a checklist whose summary is off by one", checklistOf({
  summary: "2 of 3 pass",
  rows: [
    { check: "a", area: "frames", verdict: "pass", source: "Sample" },
    { check: "b", area: "frames", verdict: "pass", source: "Sample" },
    { check: "c", area: "frames", verdict: "pass", source: "Sample" },
  ],
}), 'The summary says "2 of 3 pass", but the rows count 3 of 3 pass: a checklist\'s summary is its rows\'.');
refuses("a checklist verdict the key does not name", checklistOf({
  summary: "0 of 1 pass",
  rows: [{ check: "a", area: "frames", verdict: "done", source: "Sample" }],
}), 'a has a verdict of "done": the key is pass, fail or n/a.');
refuses("a checklist row with no source", checklistOf({
  summary: "1 of 1 pass",
  rows: [{ check: "a", area: "frames", verdict: "pass" }],
}), "a needs a check, an area and a source: what it compares, where, and the script that prints it.");
refuses("a checklist with no rows", checklistOf({ summary: "0 of 0 pass", rows: [] }),
  'A checklist needs its rows: [{ "check": "solid/frames/sky.png", "area": "frames", "verdict": "pass", "source": "native/solid/test.sh" }].');

// an n/a row is not a pass: the summary counts the passes, so 1 of 2 pass with one skipped
{
  const skipped = checklistOf({
    summary: "1 of 2 pass",
    rows: [
      { check: "a", area: "frames", verdict: "pass", source: "Sample" },
      { check: "b", area: "browser", verdict: "n/a", source: "Sample" },
    ],
  });
  if (!check(skipped).length) ok("check: an n/a row is not a pass", '"1 of 2 pass" with one skipped row is right');
  else bad("check: an n/a row is not a pass", JSON.stringify(check(skipped)));
}

// ---- (e) the mutations -----------------------------------------------------------------------------------------------------
{
  // a redline whose track is outside its box: the check's own sentence, the insets' rule
  const redline = spec("redline");
  if (redline.kind !== "redline") throw new Error("redline.json is not a redline");
  const moved: RedlineSpec = {
    ...redline,
    data: {
      ...redline.data,
      parts: redline.data.parts.map((part, i) => (i === 1 ? { ...part, x: redline.data.box.width + 20 } : part)),
    },
  };
  const sentence = `track starts at ${redline.data.box.width + 20}px, but row is ${redline.data.box.width}px wide: an inset is inside its box.`;
  if (check(moved).includes(sentence) && !check(redline).length)
    ok("mutation: a redline part outside its box", `${sentence} (the intact spec passes)`);
  else bad("mutation: a redline part outside its box", `no ${JSON.stringify(sentence)}: ${JSON.stringify(check(moved))}`);

  // a before/after whose caption contradicts the frames: the thumb does not move, and the changed row is gone
  const beforeAfter = spec("before-after");
  if (beforeAfter.kind !== "beforeAfter") throw new Error("before-after.json is not a before/after");
  const still = {
    ...beforeAfter,
    data: {
      ...beforeAfter.data,
      after: {
        ...beforeAfter.data.after,
        measures: beforeAfter.data.after.measures.map((measure) =>
          measure.label === "the thumb" ? { ...measure, value: beforeAfter.data.before.measures[1]!.value } : measure,
        ),
      },
    },
  };
  const kept = changesOf(still.data).map((change) => change.label);
  const frames = changesOf(beforeAfter.data).map((change) => change.label);
  if (!kept.includes("the thumb") && frames.includes("the thumb"))
    ok(
      "mutation: a before/after whose thumb did not move",
      `the changed rows drop "the thumb" (${frames.join(", ")} -> ${kept.join(", ")}), which is what the frames' second ` +
        `command says (the thumb's x moves 2 -> 22: from-frames.ts reads it)`,
    );
  else bad("mutation: a before/after whose thumb did not move", `${JSON.stringify(kept)} still has the thumb`);

  // a summary off by one: the sentence, from the spec's own file
  const checklist = spec("qa-checklist");  if (checklist.kind !== "qaChecklist") throw new Error("qa-checklist.json is not a checklist");
  const pass = checklist.data.rows.filter((row) => row.verdict === "pass").length;
  const off: QaChecklistSpec = {
    ...checklist,
    data: { ...checklist.data, summary: `${pass - 1} of ${checklist.data.rows.length} pass` },
  };
  const offSentence = `The summary says "${pass - 1} of ${checklist.data.rows.length} pass", but the rows count ` +
    `${checklist.data.summary}: a checklist's summary is its rows'.`;
  if (check(off).includes(offSentence)) ok("mutation: a checklist summary off by one", offSentence);
  else bad("mutation: a checklist summary off by one", `no ${JSON.stringify(offSentence)}: ${JSON.stringify(check(off))}`);

  // a row naming a comparison the suite does not print: the same rule the test's own block applies
  {
    const invented = "the figure page: a comparison no script prints";
    const stray = checklist.data.rows
      .map((row, i) => (i === 0 ? { ...row, check: invented, source: "native/terminal/test.sh" } : row))
      .filter((row) => {
        const text = readFileSync(new URL(`../${row.source.replace(/^native\//, "")}`, import.meta.url), "utf8");
        return !text.includes(`${row.check}.test.ts`);
      });
    if (stray.length === 1 && stray[0]!.check === invented)
      ok(
        "mutation: a checklist row the suite does not print",
        `"${invented}" is in no \`identical\` or \`--expect\` of native/terminal/test.sh: the row fails, the other 11 pass`,
      );
    else bad("mutation: a checklist row the suite does not print", `${stray.length} row(s) fail, wanted the invented one`);
  }
}

// ---- (f) the same three specs on the terminal, and the command goldens -----------------------------------------------------
for (const name of SPECS) {
  const s = spec(name);
  const layout = layoutOf(s);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const rows = layout.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2 * PADDING_Y;
  const cols = layout.width + 2 * PADDING_X;
  const out = join(work, `${name}.txt`);
  const run = spawnSync(
    "bun",
    ["terminal/solid.ts", "--page", "figure", "--spec", new URL(`./specs/${name}.json`, import.meta.url).pathname,
      "--cols", String(cols), "--rows", String(rows), "--dump", out],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  if (run.status !== 0) {
    bad(`${name}: the terminal`, `exit ${run.status}: ${run.stderr.trim()}`);
  } else {
    const cells = rowsOfCells(readFileSync(out, "utf8"));
    const pixel = rowsOfFrame(dump).map(stripDots);
    let differ = -1;
    for (let i = 0; i < cells.length && i < pixel.length; i++) if (cells[i] !== pixel[i]) { differ = i; break; }
    if (cells.length !== pixel.length) bad(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's ${pixel.length}`);
    else if (differ >= 0)
      bad(`${name}: the terminal's rows`, `row ${differ + 1}: ${JSON.stringify(cells[differ])} is not ${JSON.stringify(pixel[differ])}`);
    else ok(`${name}: the terminal's rows`, `${cells.length} rows in ${cols} columns, the pixel figure's words (cells, not pixels)`);
  }
  const golden = readFileSync(new URL(`./goldens/${GOLDENS[name]}.json`, import.meta.url), "utf8").trim();
  const got = format({ commands: dump.commands, effects: dump.effects });
  if (got === golden) ok(`${name}: the golden`, `solid/goldens/${GOLDENS[name]}.json, every command field identical`);
  else {
    const at = got.split("\n").findIndex((line, i) => line !== golden.split("\n")[i]);
    bad(
      `${name}: the golden`,
      `solid/goldens/${GOLDENS[name]}.json differs at line ${at + 1}: ${JSON.stringify(got.split("\n")[at])} is not ` +
        `${JSON.stringify(golden.split("\n")[at])}`,
    );
  }
}

if (failed) {
  console.error(`solid/figure-handoff.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure-handoff.test.ts: 3 kinds, ${checks} checks, the terminal's rows and the goldens among them`);
