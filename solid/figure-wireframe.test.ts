// The screen kind of the wireframe area, read back from the page and from the frame: a screen is a captured page cut to
// the cell grid. The area's other kinds, `anatomy` (the same cut with numbered callouts) and `modal` (the Dialog, open,
// with its panel), have their own tests: solid/figure-anatomy.test.ts and solid/figure-modal.test.ts. (`responsivePair`'s
// data was the Sky feed of the web app, which is not in this package: the kind is here, its spec is not.) The test is the
// kind's honesty:
//
//   (a) the wireframe's box count is the page's own rectangles and borders (which commands count, which are skipped);
//   (b) every box's cell rect is `round(x/8)`, `round(y/16)`, `round(w/8)`, `round(h/16)` of the page's box, with the
//       worst rounding error in cells and in pixels — a wireframe at 1/8 scale is not pixel-accurate;
//   (c) the texts are the page's runs in the page's order, and a run cut to its cells ends in `…`;
//   (d) the refusals, in their sentences;
//   (e) the same figure on the terminal, row for row, and its command golden on the desktop;
//   (f) the mutations: a box rounded to pixels, and a run cut by bytes.
//
// The frames come from `solid/dump.ts`'s `capture` — the same call the goldens and `specs/from-page.ts` use — so this
// reads the page, not the spec's claim about it.
//
//   bun solid/figure-wireframe.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture, PAGES } = await import("./dump.ts");
const { CELL_HEIGHT, CELL_WIDTH, PADDING_X, PADDING_Y, layoutOf } = await import("./src/figure/kinds.ts");
const { cellBox, frameOf, KNOWN_PAGES, wireCells, wireframeOf } = await import("./src/figure/kinds/wireframe.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { format } = await import("./src/format.ts");
const { cellWidth, render } = await import("./src/figure/text.ts");

import type { ScreenSpec, WireSide } from "./src/figure/spec.ts";

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
const spec = <T,>(name: string): T => {
  const parsed = parse(readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/${name}.json: ${parsed.problems.join(" ")}`);
  return parsed.spec as T;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const work = mkdtempSync(join(tmpdir(), "cssints-figure-wireframe-"));
const names = { screen: "screen" } as const;

// the kind's list of pages is dump.ts's, less the Figure page itself (a wireframe of the wireframe would recurse)
const pages = Object.keys(PAGES).filter((page) => page !== "figure").sort();
if (pages.join(", ") === KNOWN_PAGES.join(", "))
  ok("the pages a wireframe may name", `${pages.length}, dump.ts's own (${pages.join(", ")})`);
else bad("the pages a wireframe may name", `${JSON.stringify(KNOWN_PAGES)} is not ${JSON.stringify(pages)}`);

/** One side captured again at its own size: the page's frame, not the spec's copy of it. */
async function captureSide(side: WireSide, page: string): Promise<Dump> {
  return (await capture(page as keyof typeof PAGES, undefined, { width: side.width, height: side.height })) as Dump;
}
const figureDump = async (s: ScreenSpec): Promise<Dump> =>
  (await capture("figure", undefined, { spec: s, warm: 2 })) as Dump;

/** The capture's boxes/texts as the spec should hold them, and the commands the kind leaves out. */
function skipped(commands: readonly Cmd[]) {
  const rects = commands.filter((command) => command.type === "rectangle" || command.type === "border");
  const drawn = rects.filter(
    (command) =>
      command.box[2]! > 0 &&
      command.box[3]! > 0 &&
      Math.round(command.box[2]! / CELL_WIDTH) >= 2 &&
      Math.round(command.box[3]! / CELL_HEIGHT) >= 1,
  );
  const others = commands.filter((command) => !["rectangle", "border", "text"].includes(command.type));
  return { rects, drawn, others, undersized: rects.length - drawn.length };
}

/** The frame's rows as characters: each text command at its cell column, the blanks reconstructed from x. */
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
        line += " ".repeat(Math.max(0, col - wireCells(line))) + (part.text ?? "");
      }
      return line;
    });
}

/** The terminal's dump as rows: above the colour table, dots and runs of blanks dropped (as figure.test.ts reads it). */
function rowsOfCells(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("# colours"));
  return lines
    .slice(0, at < 0 ? lines.length : at)
    .map((line) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The text cells' rows, the same normalisation the terminal's dump gets. */
const normalise = (line: string) => line.replace(/\./g, " ").replace(/\s+/g, " ").trim();

/** One side's checks: the frame is the spec's, the boxes are the page's, the texts are its runs in its order. */
async function checkSide(label: string, side: WireSide, page: string) {
  const dump = await captureSide(side, page);
  if (dump.size[0] !== side.width || dump.size[1] !== side.height)
    bad(`${label}: the size`, `the capture is ${dump.size[0]}x${dump.size[1]}, the data's ${side.width}x${side.height}`);
  else ok(`${label}: the size`, `the page at ${side.width}x${side.height} is the frame's own`);
  if (!dump.commands.length) {
    bad(`${label}: the frame`, "no commands");
    return undefined;
  }
  const expected = frameOf(dump.commands);
  const sameFrame =
    JSON.stringify(expected.boxes) === JSON.stringify(side.boxes) &&
    JSON.stringify(expected.texts) === JSON.stringify(side.texts);
  if (sameFrame)
    ok(
      `${label}: the data is the frame`,
      `${expected.boxes.length} boxes and ${expected.texts.length} texts, command for command`,
    );
  else
    bad(
      `${label}: the data is the frame`,
      "the spec's boxes/texts are not the capture's (regenerate with specs/from-page.ts)",
    );

  const counts = skipped(dump.commands);
  const wire = wireframeOf(side);
  if (wire.boxes.length === expected.boxes.length)
    ok(
      `${label}: the boxes`,
      `${expected.boxes.length} of the ${counts.rects.length} rectangles/borders, one each; ` +
        `${counts.undersized} under 2x1 cells skipped, ${counts.others.length} image/scissor/overlay/custom skipped`,
    );
  else bad(`${label}: the boxes`, `${wire.boxes.length} drawn for the page's ${expected.boxes.length}`);

  let worst = 0;
  let worstAt = "";
  let wrong = 0;
  for (const [i, box] of expected.boxes.entries()) {
    const rect = cellBox(box);
    const drawn = wire.boxes[i];
    if (!drawn || drawn.col !== rect.col || drawn.row !== rect.row || drawn.cols !== rect.cols || drawn.rows !== rect.rows) {
      wrong++;
      continue;
    }
    const error = Math.max(
      Math.abs(rect.col - box.x / CELL_WIDTH),
      Math.abs(rect.row - box.y / CELL_HEIGHT),
      Math.abs(rect.cols - box.width / CELL_WIDTH),
      Math.abs(rect.rows - box.height / CELL_HEIGHT),
    );
    if (error > worst) (worst = error), (worstAt = `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  if (!wrong)
    ok(
      `${label}: the rects`,
      `${expected.boxes.length} boxes at round(x/8), round(y/16), round(w/8), round(h/16); the worst edge is ` +
        `${worst.toFixed(2)} of a cell (${(worst * CELL_WIDTH).toFixed(1)}px across, ${(worst * CELL_HEIGHT).toFixed(1)}px down; ` +
        `${worstAt}), at 1/8 scale not a pixel`,
    );
  else bad(`${label}: the rects`, `${wrong} of ${expected.boxes.length} rects are not their box's rounding`);

  const placed = wire.texts;
  // a run whose rounded start is outside the page's cells is not in the wireframe: the page clipped it (the narrow Sky
  // page overflows its window), and the grid has no cell to put it in
  const across = Math.round(side.width / CELL_WIDTH);
  const down = Math.round(side.height / CELL_HEIGHT);
  const inside = expected.texts.filter((text) => {
    const col = Math.round(text.x / CELL_WIDTH);
    const row = Math.round(text.y / CELL_HEIGHT);
    return row >= 0 && row < down && col >= 0 && col < across;
  });
  const outside = expected.texts.length - inside.length;
  const sameTexts =
    placed.length === inside.length && placed.every((text, i) => text.text === inside[i]!.text);
  if (sameTexts)
    ok(
      `${label}: the texts`,
      `${placed.length} runs, the page's strings in the page's order` +
        (outside ? `; ${outside} outside the page's cells not drawn` : ""),
    );
  else
    bad(
      `${label}: the texts`,
      `${placed.length} of the page's ${inside.length}: ` +
        JSON.stringify(placed.find((text, i) => text.text !== inside[i]?.text)?.text),
    );
  const cut = placed.filter((text) => text.shortened);
  // a shortened run ends in `…`; a run a later one on the same cell covered has no cells left to draw
  const marked = cut.every(
    (text) => text.drawn === "" || (text.drawn.endsWith("…") && wireCells(text.drawn) <= wireCells(text.text)),
  );
  const untouched = placed.filter((text) => !text.shortened).every((text) => text.drawn === text.text);
  if (marked && untouched)
    ok(
      `${label}: the cell a run holds`,
      `${placed.length} runs: ${cut.length} shortened to their cells and marked …` +
        (cut.length
          ? ` (${cut.slice(0, 3).map((text) => JSON.stringify(text.drawn)).join(", ")}${cut.length > 3 ? ", …" : ""})`
          : ""),
    );
  else bad(`${label}: the cell a run holds`, `${cut.filter((text) => !text.drawn.endsWith("…")).length} shortened runs have no …`);
  const wideCopy = expected.texts.every((text) => wireCells(text.text) === cellWidth(text.text));
  if (wideCopy) ok(`${label}: the cells' width`, `the kind's width is text.ts's cellWidth on all ${expected.texts.length} runs`);
  else bad(`${label}: the cells' width`, "the kind's wide-character ranges differ from text.ts's");
  return wire;
}

/** Every run the wireframe draws is one of the frame's text commands (a run with no cells is skipped). */
function drawnRuns(label: string, wire: { texts: { drawn: string; cols: number }[] }, frame: Dump) {
  const texts = frame.commands.filter((command) => command.type === "text").map((command) => command.text ?? "");
  const drawn = wire.texts.filter((run) => run.cols > 0);
  const lost = drawn.filter((run) => !texts.some((text) => text.includes(run.drawn)));
  if (!lost.length) ok(`${label}: the drawn runs`, `${drawn.length} runs are in the frame's text commands`);
  else bad(`${label}: the drawn runs`, `${lost.length} run(s) are not in the frame: ${JSON.stringify(lost[0]!.drawn)}`);
}

/** A command golden: the frame's commands and tables, byte for byte (figure.test.ts's discipline). */
function goldenOf(label: string, s: ScreenSpec, dump: Dump) {
  const at = `./goldens/figure-${label}.json`;
  const want = readFileSync(new URL(at, import.meta.url), "utf8").trim();
  const got = format({ commands: dump.commands, effects: dump.effects });
  if (got === want) {
    ok(`${label}: the golden`, `${at}, every command field identical`);
    return;
  }
  const line = got.split("\n").findIndex((text, i) => text !== want.split("\n")[i]);
  bad(`${label}: the golden`, `${at} differs at line ${line + 1} (${s.kind})`);
}

const screenSpec = spec<ScreenSpec>(names.screen);
const screenLayout = layoutOf(screenSpec);

// (a)-(c) the screen's one side
const screenWire = await checkSide("screen", screenSpec.data, screenSpec.data.page);
if (!screenWire) throw new Error("screen: no frame");
if (screenWire.boxes.length === screenLayout.boxes.length)
  ok("screen: the layout's boxes", `${screenLayout.boxes.length} records, one a page rectangle`);
else bad("screen: the layout's boxes", `${screenLayout.boxes.length} records for the wire's ${screenWire.boxes.length}`);
const screenFrame = await figureDump(screenSpec);
goldenOf(names.screen, screenSpec, screenFrame);
drawnRuns("screen", screenWire, screenFrame);

// (f) the terminal's rows and the pixel frame's, for both specs
for (const [name, s, l] of [[names.screen, screenSpec, screenLayout]] as const) {
  const frame = screenFrame;
  const rows = l.lines.reduce((n, line) => n + (line.height ?? 1), 0) + 2 * PADDING_Y;
  const cols = Math.max(80, l.width + 2 * PADDING_X);
  const out = join(work, `${name}.txt`);
  const run = spawnSync(
    "bun",
    [
      "terminal/solid.ts", "--page", "figure",
      "--spec", new URL(`./specs/${name}.json`, import.meta.url).pathname,
      "--cols", String(cols), "--rows", String(rows), "--dump", out,
    ],
    { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
  );
  if (run.status !== 0) {
    bad(`${name}: the terminal`, `exit ${run.status}: ${run.stderr.trim()}`);
    continue;
  }
  const cells = rowsOfCells(readFileSync(out, "utf8"));
  const pixel = rowsOfFrame(frame).map(normalise).filter(Boolean);
  let differ = -1;
  for (let i = 0; i < cells.length && i < pixel.length; i++)
    if (cells[i] !== pixel[i]) {
      differ = i;
      break;
    }
  if (cells.length !== pixel.length)
    bad(`${name}: the terminal's rows`, `${cells.length} rows, the pixel figure's ${pixel.length}`);
  else if (differ >= 0)
    bad(
      `${name}: the terminal's rows`,
      `row ${differ + 1}: ${JSON.stringify(cells[differ])} is not ${JSON.stringify(pixel[differ])}`,
    );
  else
    ok(
      `${name}: the terminal's rows`,
      `${cells.length} rows, the pixel figure's words; ${l.width} cells of the page, ${cols} columns`,
    );
  // the text half is the same layout: the title first, and no line over the fence's width
  const fence = Math.max(80, l.width + 2 * PADDING_X);
  const text = render(s, { width: fence }).split("\n");
  if (text[0] === s.title && text.every((line) => cellWidth(line) <= fence))
    ok(`${name}: the text half`, `${text.length} lines, the title first, the widest ${Math.max(...text.map(cellWidth))} cells`);
  else bad(`${name}: the text half`, `the first line is ${JSON.stringify(text[0])}`);
}

// (e) the refusals, in their sentences
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  if (problems.some((problem) => problem === sentence || problem.includes(sentence))) ok(`check: ${what}`, sentence);
  else bad(`check: ${what}`, `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const source = "Sample: a captured frame";
refuses(
  "a page this repository does not have",
  { kind: "screen", source, data: { ...clone(screenSpec.data), page: "pieChart" } },
  'A wireframe\'s page is one this repository draws — dialog, list, sensors, sheet, sky, widgets — not "pieChart".',
);
refuses(
  "a page wider than options.width",
  { kind: "screen", source, data: { ...clone(screenSpec.data), width: 900 }, options: { width: 80 } },
  "The widgets page is 900px wide, 113 cells, but options.width is 80: draw it in a narrower figure or raise options.width.",
);
refuses(
  "a frame with no boxes",
  { kind: "screen", source, data: { ...clone(screenSpec.data), boxes: [] } },
  "The widgets page has no rectangles or borders, so its wireframe has no box to draw.",
);
refuses(
  "an empty frame",
  { kind: "screen", source, data: { ...clone(screenSpec.data), boxes: [], texts: [] } },
  "The widgets page's frame is empty: no command drew a box or a text.",
);

// (g) the mutations
// A box rounded to whole pixels instead of cells: its rect is the page's own px numbers, so it is 40 cells into the page
// where the cell grid says 5 — the rect check's numbers, not its words.
const first = screenSpec.data.boxes[1]!;
const pixelRect = { col: Math.round(first.x), row: Math.round(first.y), cols: Math.round(first.width), rows: Math.round(first.height) };
const cell = cellBox(first);
const pixelError = Math.abs(pixelRect.col - cell.col) + Math.abs(pixelRect.cols - cell.cols);
if (pixelError > 0)
  ok(
    "mutation: a box rounded to pixels",
    `the ${Math.round(first.width)}x${Math.round(first.height)} box at ${Math.round(first.x)},${Math.round(first.y)} is ` +
      `col ${cell.col} and ${cell.cols} cells wide on the grid, but col ${pixelRect.col} and ${pixelRect.cols} in pixels: ` +
      `${pixelError} cells out, so the rect check fails`,
  );
else bad("mutation: a box rounded to pixels", `the two roundings agree on ${JSON.stringify(cell)}`);
// A run cut by bytes instead of cells: a wide character is three bytes and two cells, so a byte cut keeps two of the six
// characters and its `…` sits short of the box's edge; the row's cells no longer add up.
const wideRun = "监控摄像头布局";
const wideSide: WireSide = {
  width: 80,
  height: 32,
  boxes: [{ x: 0, y: 0, width: 80, height: 32 }],
  texts: [{ x: 8, y: 8, text: wideRun }],
};
const wideMutation = wireframeOf(wideSide);
const drawn = wideMutation.texts[0]!;
const room = 8;
let bytes = 0;
let kept = "";
for (const ch of wideRun) {
  const size = new TextEncoder().encode(ch).length;
  if (bytes + size > room - 1) break;
  kept += ch;
  bytes += size;
}
const byBytes = `${kept}…`;
if (drawn.shortened && drawn.drawn.endsWith("…") && wireCells(byBytes) < wireCells(drawn.drawn))
  ok(
    "mutation: a run cut by bytes",
    `${JSON.stringify(drawn.drawn)} is ${wireCells(drawn.drawn)} cells; cut by bytes ${JSON.stringify(byBytes)} is ` +
      `${wireCells(byBytes)}, ${wireCells(drawn.drawn) - wireCells(byBytes)} cells short of the box's edge: the row breaks`,
  );
else bad("mutation: a run cut by bytes", `${JSON.stringify(drawn.drawn)} against ${JSON.stringify(byBytes)}`);

if (failed) {
  console.error(`solid/figure-wireframe.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(
  `solid/figure-wireframe.test.ts: ${checks} checks, one kind (${KNOWN_PAGES.length} pages named), ` +
    `${screenSpec.data.boxes.length} boxes and ${screenSpec.data.texts.length} texts`,
);
