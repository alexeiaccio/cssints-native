// The three chart kinds' invariants, read back from the frame and not from a string: a sparkline's points are its values
// (an eighth a point, worst error in eighths), the meter's fill is value/range and its verdict the engine's comparison,
// a heatmap's every cell is its value's band and its ratio the engine's, then `check`'s refusals in their sentences, the
// same three specs on the terminal (the pixel figure's words, cell for cell), and the mutations a kind's numbers break.
//
//   bun solid/figure-charts.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture } = await import("./dump.ts");
const { CELL_HEIGHT, layoutOf } = await import("./src/figure/kinds.ts");
const { HEATMAP_BANDS, shadeOf, sparkEighth } = await import("./src/figure/kinds/charts.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { render, SHADES, SPARK } = await import("./src/figure/text.ts");
const { formatValue } = await import("./src/figure/kinds/shared.ts");
const { variant } = await import("./src/pack.ts");
const { format } = await import("./src/format.ts");
const styles = await import("./app/Figure.styles.ts");

/** The engine's contrast, through the published `cssints/check` (an Effect yielding `{ ratio }`): a meter's and a
 *  heatmap's numbers are held to it, not to the copy in `src/figure/contrast.ts` that they refuse and draw by. */
const { contrast: engineContrast } = await import("cssints/check");
const { Effect } = await import("effect");
const { shown } = await import("./src/figure/contrast.ts");
const engineRatio = (fg: string, bg: string): number => Effect.runSync(engineContrast(fg, bg)).ratio;

const SPECS = ["sparkline", "meter", "heatmap"] as const;
/** One stored command golden a spec: the desktop's last frame, the shape `solid/dump.ts --commands` writes. */
const GOLDENS: Record<(typeof SPECS)[number], string> = {
  sparkline: "figure-sparkline",
  meter: "figure-meter",
  heatmap: "figure-heatmap",
};
/** A cell is 8x16 px: a point's height rounds to an eighth (2px), and a fill may sit half a cell from its ratio. */
const HALF_CELL = 0.5;

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
  size?: number;
}
const commandOf = (dump: { commands: Cmd[] }, id: string) => dump.commands.find((c) => c.element === id);
/** A text command's row: a line is one cell down. Floor, not round: a sparkline's glyph sits at the bar's top, which is
 *  low in its row for a short bar, and the terminal places a text at `floor(y / 16)` too. */
const rowOf = (box: number[]) => Math.floor(box[1]! / CELL_HEIGHT);
/** The figure's lines as words: each row's text commands, left to right. A text that starts inside the cell of the one
 *  before it is drawn against it with no space (a sparkline's glyphs, one a cell); a gap of a cell or more is a space. */
function rowsOfFrame(dump: { commands: Cmd[] }): string[] {
  const rows = new Map<number, { x: number; width: number; text: string }[]>();
  for (const c of dump.commands)
    if (c.type === "text" && c.text !== undefined) {
      const row = rowOf(c.box);
      const parts = rows.get(row) ?? [];
      parts.push({ x: c.box[0]!, width: c.box[2]!, text: c.text });
      rows.set(row, parts);
    }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, unsorted]) => {
      const parts = unsorted.sort((a, b) => a.x - b.x);
      let line = "";
      for (const [i, part] of parts.entries()) {
        if (i > 0 && part.x - (parts[i - 1]!.x + parts[i - 1]!.width) >= 8) line += " ";
        line += part.text;
      }
      return line;
    })
    .map((line) => line.replace(/\s+/g, " ").trim());
}
/** A fill is "." and a full stop is a full stop: both sides lose their dots, so a heatmap's shade and a sentence read
 *  the same on the cells and in Clay's text commands. */
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

/** The terminal's colour table as `[r,g,b] -> cells` for the fills, which a heatmap's four shades are read from. */
function fillsOfCells(text: string): Map<string, number> {
  const out = new Map<string, number>();
  let inTable = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("# colours")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const match = /^\d+ (\d+),(\d+),(\d+) \d+ (\d+)$/.exec(line);
    if (match) out.set(match.slice(1, 4).join(","), Number(match[4]));
  }
  return out;
}

/** A `variant`'s background as `r,g,b`, the three channels the frame writes for a box. */
const backgroundOf = (style: unknown): string => {
  const box = variant(style as never, undefined).box;
  return [14, 15, 16].map((i) => Math.round(Number(box?.[i] ?? -1))).join(",");
};

const work = mkdtempSync(join(tmpdir(), "cssints-figure-charts-"));

for (const name of SPECS) {
  const s = spec(name);
  const l = layoutOf(s);
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  const lines = rowsOfFrame(dump);
  if (dump.commands.length === 0) {
    bad(`${name}: the frame`, "no commands");
    continue;
  }

  // the command golden: the same capture, stored as solid/goldens/figure-<name>.json
  const want = readFileSync(new URL(`./goldens/${GOLDENS[name]}.json`, import.meta.url), "utf8").trim();
  const got = format({ commands: dump.commands, effects: dump.effects });
  if (got === want) ok(`${name}: the golden`, `solid/goldens/${GOLDENS[name]}.json, every command field identical`);
  else {
    const at = got.split("\n").findIndex((line, i) => line !== want.split("\n")[i]);
    bad(
      `${name}: the golden`,
      `solid/goldens/${GOLDENS[name]}.json differs at line ${at + 1}: ` +
        `${JSON.stringify(got.split("\n")[at])} is not ${JSON.stringify(want.split("\n")[at])}`,
    );
  }

  // the rows are the data's, in order (a heatmap's column heading above its inks)
  const axis = 1;
  let cursor = 0;
  const labelRows = l.labels.map((label) => {
    while (cursor < dump.commands.length) {
      const command = dump.commands[cursor++]!;
      if (command.type === "text" && command.text === label.text) return command;
    }
    return undefined;
  });
  const inOrder = labelRows.every((command, i) => {
    if (!command) return false;
    if (i === 0) return true;
    return command.box[axis]! > labelRows[i - 1]!.box[axis]!;
  });
  if (inOrder) ok(`${name}: the rows`, `${l.labels.map((label) => label.text).join(", ")} — the data's order`);
  else bad(`${name}: the rows`, JSON.stringify(labelRows.map((c) => [c?.text, c?.box[axis]])));

  // the terminal: the cells' rows are the pixel figure's rows, in words and count
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
  } else {
    const cellText = readFileSync(out, "utf8");
    const cells = rowsOfCells(cellText);
    const pixel = lines.map(stripDots);
    let differ = -1;
    for (let i = 0; i < cells.length && i < pixel.length; i++) if (cells[i] !== pixel[i]) { differ = i; break; }
    if (cells.length !== pixel.length)
      bad(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's ${pixel.length}`);
    else if (differ >= 0)
      bad(`${name}: the terminal's rows`, `row ${differ + 1}: ${JSON.stringify(cells[differ])} is not ${JSON.stringify(pixel[differ])}`);
    else ok(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's words (cells, not pixels)`);

    if (name === "heatmap") {
      // the four shades on the cells: a fill's colour is its level's role, and its count is its cells' area
      const fills = fillsOfCells(cellText);
      const data = s.kind === "heatmap" ? s.data : undefined;
      const slot = l.lines.flatMap((line) => line.items).find((item) => item.kind === "shade")?.cells ?? 0;
      const wantFills = new Map<string, number>();
      if (data)
        data.values.forEach((row) =>
          row.forEach((value) => {
            const key = backgroundOf(styles.s.shade[shadeOf(value)]);
            wantFills.set(key, (wantFills.get(key) ?? 0) + 1);
          }),
        );
      const wrong = [...wantFills].filter(([colour, cells]) => (fills.get(colour) ?? 0) !== cells * slot);
      if (!wrong.length && wantFills.size === 4)
        ok("heatmap: the terminal's shades", `four fills, ${[...wantFills.values()].reduce((a, b) => a + b, 0)} cells at ${slot} a cell`);
      else
        bad(
          "heatmap: the terminal's shades",
          `${fills.size} fill colour(s); ${wrong.map(([c, n]) => `${c} has ${fills.get(c) ?? 0}, want ${n * slot}`).join("; ")}`,
        );
    }
  }

  // ---- the sparkline: a point's eighth is its value's, and the labels are the series' own
  if (s.kind === "sparkline") {
    const { values, unit = "", label } = s.data;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const sparks = l.lines.flatMap((line) => line.items.filter((item) => item.kind === "spark"));
    let worst = 0;
    let worstAt = "";
    for (const [i, item] of sparks.entries()) {
      if (item.kind !== "spark") continue;
      const want8 = sparkEighth(values[i]!, lo, hi);
      const fill = commandOf(dump, item.fillId);
      const drawn = fill ? fill.box[3]! / 2 - 1 : Number.NaN;
      for (const [what, got8] of [["layout", item.eighth], ["frame", drawn]] as const) {
        const error = Math.abs(got8 - want8);
        if (error > worst) (worst = error), (worstAt = `point ${i + 1} ${values[i]} ms, ${what} ${got8}, want ${want8}`);
      }
    }
    if (sparks.length === values.length && worst === 0)
      ok(
        `${name}: the points`,
        `${sparks.length} eighths, each its value's (${values.map((v) => SPARK[sparkEighth(v, lo, hi)]).join("")}); worst 0.00 of an eighth`,
      );
    else if (sparks.length !== values.length)
      bad(`${name}: the points`, `${sparks.length} points for ${values.length} values`);
    else bad(`${name}: the points`, `${worst.toFixed(2)} eighths off (${worstAt})`);
    const prefix = unit ? ` ${unit}` : "";
    const note = `min ${formatValue(lo)}${prefix}  max ${formatValue(hi)}${prefix}`;
    const last = `${formatValue(values[values.length - 1]!)}${prefix}`;
    const noteInFrame = dump.commands.some((c) => c.type === "text" && c.text === note);
    const lastInFrame = dump.commands.some((c) => c.type === "text" && c.text === last);
    if (noteInFrame && lastInFrame)
      ok(`${name}: the labels`, `"${note}" under the row, "${last}" after it — the series' own min, max and last`);
    else bad(`${name}: the labels`, `note ${noteInFrame}, last ${lastInFrame} in the frame`);
    const glyphs = values.map((v) => SPARK[sparkEighth(v, lo, hi)]).join("");
    if (render(s).includes(`${label} ${glyphs}`))
      ok(`${name}: the text`, `"${label} ${glyphs}" — the same eighths in the text half`);
    else bad(`${name}: the text`, `no "${label} ${glyphs}" in ${JSON.stringify(render(s).split("\n")[1])}`);
  }

  // ---- the meter: the fill is value/range, the verdict the engine's comparison
  if (s.kind === "meter") {
    const { fg, bg, min, value } = s.data;
    const max = s.data.max ?? 21;
    const fill = commandOf(dump, "fig-fill-0");
    const track = commandOf(dump, "fig-track-0");
    const error = fill && track ? Math.abs(fill.box[2]! / 8 - (track.box[2]! / 8) * (value / max)) : Number.NaN;
    if (error <= 0.01)
      ok(`${name}: the fill`, `${(fill!.box[2]! / 8).toFixed(2)} of ${(track!.box[2]! / 8).toFixed(0)} cells, ${error.toFixed(2)} off ${shown(value)}/${max}`);
    else bad(`${name}: the fill`, `${error.toFixed(2)} cells off ${value}/${max}`);
    const ratio = engineRatio(fg, bg);
    const pass = ratio >= min;
    const verdict = `${pass ? "pass" : "fails"} ${min}:1`;
    const command = dump.commands.find((c) => c.type === "text" && c.text === verdict);
    const role = [0, 1, 2].map((i) => Math.round(Number((pass ? variant(styles.s.fill.good, undefined).box : variant(styles.s.fill.problem, undefined).box)?.[14 + i] ?? -1)));
    const right = command && role.every((channel, i) => Math.abs(Number(command.color?.[i]) - channel) <= 1);
    if (right && l.pairs[0]?.pass === pass)
      ok(`${name}: the verdict`, `"${verdict}" — ${shown(ratio)}:1 from the engine, ${pass ? "passes" : "fails"} ${min}:1`);
    else bad(`${name}: the verdict`, `"${verdict}" drawn ${right}, the layout says ${l.pairs[0]?.pass}, the engine ${pass}`);
    if (dump.commands.some((c) => c.type === "text" && c.text === `${shown(ratio)}:1`))
      ok(`${name}: the value`, `"${shown(ratio)}:1" is the engine's ratio of ${fg} on ${bg}`);
    else bad(`${name}: the value`, `no "${shown(ratio)}:1" in the frame`);
  }

  // ---- the heatmap: every cell's shade is its value's band, and every ratio the engine's
  if (s.kind === "heatmap") {
    const { rows: inks, columns: pages, values } = s.data;
    const shades = l.lines.flatMap((line) => line.items.filter((item) => item.kind === "shade"));
    let wrongBand = 0;
    let wrongColour = 0;
    let wrongRatio = 0;
    let checked = 0;
    for (const [r, row] of values.entries())
      for (const [c, value] of row.entries()) {
        checked++;
        const want = shadeOf(value);
        const shade = shades.find((item) => item.id === `fig-shade-${r}-${c}`);
        if (!shade || shade.kind !== "shade" || shade.level !== want) wrongBand++;
        const box = commandOf(dump, `fig-shade-${r}-${c}`);
        const colour = backgroundOf(styles.s.shade[want]);
        if (!box || ![0, 1, 2].every((i) => Math.abs(Number(box.color?.[i]) - Number(colour.split(",")[i])) <= 1)) wrongColour++;
        if (Math.abs(engineRatio(inks[r]!.fg, pages[c]!.bg) - value) > 0.005) wrongRatio++;
      }
    if (shades.length === checked && !wrongBand && !wrongColour && !wrongRatio)
      ok(
        `${name}: the cells`,
        `${checked} shades, each its value's band and its own colour (${inks.length} inks × ${pages.length} pages), every ratio the engine's`,
      );
    else
      bad(
        `${name}: the cells`,
        `${shades.length} shades for ${checked} cells; band ${wrongBand}, colour ${wrongColour}, ratio ${wrongRatio} wrong`,
      );
    // the band table: the values' counts by band, and the floors themselves in the next band
    const counts = [0, 0, 0, 0];
    for (const row of values) for (const value of row) counts[shadeOf(value)]! += 1;
    const edges = [
      [1, 0], [2.99, 0], [3, 1], [4.49, 1], [4.5, 2], [6.99, 2], [7, 3], [21, 3],
    ] as const;
    const edgeWrong = edges.filter(([value, level]) => shadeOf(value) !== level);
    if (counts.every((n) => n > 0) && !edgeWrong.length)
      ok(
        `${name}: the bands`,
        `${HEATMAP_BANDS.join("/")}: ${counts.map((n, i) => `${i} ${n} cell${n === 1 ? "" : "s"}`).join(", ")}; a floor is the next band`,
      );
    else bad(`${name}: the bands`, `${JSON.stringify(counts)} at ${JSON.stringify(edges)}; ${edgeWrong.length} edge(s) wrong`);
    const header = dump.commands.filter((c) => c.type === "text").map((c) => c.text ?? "");
    const headerOk = pages.every((page) => header.some((text) => text.includes(page.label)));
    if (headerOk) ok(`${name}: the headings`, `${pages.map((page) => page.label).join(", ")} above the inks`);
    else bad(`${name}: the headings`, `${JSON.stringify(header)} has no ${pages.map((page) => page.label).join(", ")}`);
  }
}

// ---- the refusals, in the kit's voice
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((p) => p === sentence || p.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
refuses("a sparkline with one point", {
  kind: "sparkline",
  source: "Sample",
  data: { label: "draw", values: [0.31] },
}, '"draw" has 1');
refuses("a sparkline with a point that is not a number", {
  kind: "sparkline",
  source: "Sample",
  data: { label: "draw", values: [0.31, "n/a"] },
}, '"draw" point 2 is "n/a": a sparkline\'s points are numbers.');
refuses("a meter outside its range", {
  kind: "meter",
  source: "Sample",
  data: { label: "link on bgSubtle", fg: "#1971c2", bg: "#f1f3f5", min: 4.5, value: 22, max: 21 },
}, "link on bgSubtle is 22, outside 0 to 21: a meter's value sits in its range.");
refuses("a meter whose value is not its colours'", {
  kind: "meter",
  source: "Sample",
  data: { label: "link on bgSubtle", fg: "#1971c2", bg: "#f1f3f5", min: 4.5, value: 3, max: 21 },
}, "link on bgSubtle says 3.00:1, but #1971c2 on #f1f3f5 makes 4.51:1.");
refuses("a meter whose colour is not hex", {
  kind: "meter",
  source: "Sample",
  data: { label: "link on bgSubtle", fg: "rgb(25 113 194)", bg: "#f1f3f5", min: 4.5, value: 4.51, max: 21 },
}, 'link on bgSubtle\'s fg is a hex value like #080808, not "rgb(25 113 194)".');
refuses("a heatmap with a ragged row", {
  kind: "heatmap",
  source: "Sample",
  data: {
    rows: [{ label: "grey.7", fg: "#495057" }, { label: "grey.8", fg: "#343a40" }],
    columns: [{ label: "bg", bg: "#f8f9fa" }],
    values: [[7.75], [10.91, 9.7]],
  },
}, "grey.8 has 2 values for 1 background; a heatmap is one value a cell.");
refuses("a heatmap value outside 1..21", {
  kind: "heatmap",
  source: "Sample",
  data: {
    rows: [{ label: "grey.7", fg: "#495057" }],
    columns: [{ label: "bg", bg: "#f8f9fa" }],
    values: [[0.5]],
  },
}, "grey.7 on bg is 0.5: a ratio runs from 1 to 21.");
refuses("a heatmap colour that is not hex", {
  kind: "heatmap",
  source: "Sample",
  data: {
    rows: [{ label: "grey.7", fg: "rgb(73 80 87)" }],
    columns: [{ label: "bg", bg: "#f8f9fa" }],
    values: [[7.75]],
  },
}, 'grey.7\'s fg is a hex value like #495057, not "rgb(73 80 87)".');
refuses("a heatmap ratio its pair does not make", {
  kind: "heatmap",
  source: "Sample",
  data: {
    rows: [{ label: "grey.7", fg: "#495057" }],
    columns: [{ label: "bg", bg: "#f8f9fa" }],
    values: [[3.0]],
  },
}, "grey.7 on bg says 3.00:1, but #495057 on #f8f9fa makes 7.75:1.");

// ---- the mutations, as the checks they break
{
  // a sparkline drawn evenly instead of from its values: the eighth error the point check allows is zero
  const s = spec("sparkline");
  if (s.kind !== "sparkline") throw new Error("sparkline.json is not a sparkline");
  const { values } = s.data;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const wanted = values.map((value) => sparkEighth(value, lo, hi));
  const even = values.map((_, i) => Math.round((i / (values.length - 1)) * 7));
  const worst = wanted.reduce(
    (a, want, i) => (Math.abs(even[i]! - want) > Math.abs(a.off) ? { i, want, off: even[i]! - want } : a),
    { i: 0, want: wanted[0]!, off: 0 },
  );
  if (Math.abs(worst.off) > 0)
    ok(
      "mutation: a sparkline drawn evenly",
      `point ${worst.i + 1} is ${values[worst.i]} ms, ${worst.want} eighths; drawn evenly it is ${worst.want + worst.off}, ` +
        `${Math.abs(worst.off)} eighths off`,
    );
  else bad("mutation: a sparkline drawn evenly", "the even drawing is the values' own");
}
{
  // a meter's verdict flipped: the engine's comparison disagrees, and the check's verdict is that comparison
  const s = spec("meter");
  if (s.kind !== "meter") throw new Error("meter.json is not a meter");
  const ratio = engineRatio(s.data.fg, s.data.bg);
  const pass = ratio >= s.data.min;
  const flipped = !pass;
  if (flipped !== pass)
    ok(
      "mutation: the meter's verdict flipped",
      `the engine says ${shown(ratio)}:1 ${pass ? "passes" : "fails"} ${s.data.min}:1; flipped it says ` +
        `${flipped ? "pass" : "fails"}, which the comparison refuses`,
    );
  else bad("mutation: the meter's verdict flipped", "the flipped verdict is still the engine's");
}
{
  // a heatmap's shade from the cell's index instead of its value: the band table fails
  const s = spec("heatmap");
  if (s.kind !== "heatmap") throw new Error("heatmap.json is not a heatmap");
  const cells = s.data.values.flat();
  const wrong = cells
    .map((value, i) => ({ value, index: i % 4, band: shadeOf(value) }))
    .filter((cell) => cell.index !== cell.band);
  if (wrong.length)
    ok(
      "mutation: a heatmap shade from the index",
      `${wrong.length} of ${cells.length} cells differ: ${wrong[0]!.value} is band ${wrong[0]!.band}, its index paints ${wrong[0]!.index}`,
    );
  else bad("mutation: a heatmap shade from the index", "the index's shades are the values' bands");
}

if (failed) {
  console.error(`solid/figure-charts.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure-charts.test.ts: ${SPECS.length} specs, ${checks} checks, the terminal's rows among them`);
