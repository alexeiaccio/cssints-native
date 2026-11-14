// A figure as an outline, and one node of it as a PNG: `--describe` and `--capture`, the two an agent needs to read a
// figure and point at a part of it. The test is the idea's honesty:
//
//   (a) the outline names the figure (kind, title, size) and has an id once — no repeats, every rect inside the frame;
//   (b) it is the layout that draws: one node an item, the item's own words, and no spacer (a cell between two columns is
//       not a thing in the figure);
//   (c) it is smaller than the command golden, and the number is printed;
//   (d) `--capture` of a node is that node's pixels: the same size as the outline says, and the frame's own crop, pixel
//       for pixel;
//   (e) an id that is not in the outline, and a page that is not the figure, fail with their sentence.
//
//   bun solid/figure-outline.test.ts
import "./plugin.ts";

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Outline, OutlineNode } from "./src/figure/outline.ts";
import { layoutOf, sizeOf, type Item, type Spec } from "./src/figure/kinds.ts";
import { diffImages, type Raster } from "./src/diff.ts";
import { parse } from "./src/figure/spec.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "cssints-figure-outline-"));
let checks = 0;
let failed = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const spec = (name: string): Spec => {
  const parsed = parse(readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!parsed.spec) throw new Error(`solid/specs/${name}.json: ${parsed.problems.join(" ")}`);
  return parsed.spec;
};

const run = (args: string[]) => spawnSync("bun", ["solid/main.ts", ...args], { cwd: ROOT, encoding: "utf8" });

/** The outline of a spec, through the CLI, and its bytes. */
const describe = (name: string): { outline: Outline; bytes: number } => {
  const result = run(["figure", "--spec", `solid/specs/${name}.json`, "--describe"]);
  if (result.status !== 0) throw new Error(`${name}: --describe exited ${result.status}: ${result.stderr}`);
  return { outline: JSON.parse(result.stdout) as Outline, bytes: result.stdout.length };
};

/** The item of a layout that draws at `id`, whichever side of a bar or a spark it is. */
const drawers = (l: ReturnType<typeof layoutOf>): Item[] =>
  l.lines.flatMap((line) => line.items).filter((item) => item.kind !== "space");

const inside = (node: OutlineNode, width: number, height: number) => {
  const [x, y, w, h] = node.rect;
  return w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= width && y + h <= height;
};

// ---- (a)-(c): the outline of three figures ---------------------------------------------------------------------------

for (const name of ["table", "bars", "palette"] as const) {
  const s = spec(name);
  const layout = layoutOf(s);
  const { outline, bytes } = describe(name);
  const size = sizeOf(s);

  if (outline.kind === s.kind && outline.title === s.title && outline.size[0] === size.width && outline.size[1] === size.height)
    ok(`${name}: names the figure`, `${s.kind}, "${s.title}", ${size.width}x${size.height}`);
  else bad(`${name}: names the figure`, `${outline.kind} "${outline.title}" ${JSON.stringify(outline.size)}`);

  const ids = outline.nodes.map((node) => node.id);
  const repeats = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (!repeats.length) ok(`${name}: an id once`, `${ids.length} nodes, no id twice`);
  else bad(`${name}: an id once`, `${[...new Set(repeats)].join(", ")}`);

  const outside = outline.nodes.filter((node) => !inside(node, size.width, size.height));
  if (!outside.length) ok(`${name}: every rect in the frame`, `all ${outline.nodes.length} inside ${size.width}x${size.height}`);
  else bad(`${name}: every rect in the frame`, JSON.stringify(outside.slice(0, 3)));

  // every item that draws is in the outline, with the item's own words; every spacer is not
  const missing = drawers(layout).filter((item) => !ids.includes(item.id));
  const wanted = drawers(layout).filter((item) => "text" in item && item.kind !== "bar" && item.kind !== "spark");
  const wrongText = wanted.filter((item) => {
    const node = outline.nodes.find((one) => one.id === item.id);
    return !node || node.text !== (item as { text: string }).text;
  });
  const spacers = layout.lines.flatMap((line) => line.items).filter((item) => item.kind === "space");
  const straySpacers = spacers.filter((item) => ids.includes(item.id));
  if (!missing.length && !wrongText.length && !straySpacers.length)
    ok(
      `${name}: the layout that draws`,
      `${wanted.length} texts of ${drawers(layout).length} items, their own words; ${spacers.length} spacers left out`,
    );
  else
    bad(
      `${name}: the layout that draws`,
      `${missing.length} items missing, ${wrongText.length} with another text, ${straySpacers.length} spacers in`,
    );

  // the compactness number, against the command golden the figure already has (two are stored without one)
  const goldenAt = new URL(`./goldens/figure-${name}.json`, import.meta.url);
  if (existsSync(goldenAt)) {
    const golden = statSync(goldenAt).size;
    if (bytes < golden) ok(`${name}: smaller than the golden`, `${outline.nodes.length} nodes, ${bytes} B against ${golden} B`);
    else bad(`${name}: smaller than the golden`, `${bytes} B, the golden's ${golden} B`);
  } else ok(`${name}: smaller than the golden`, `${bytes} B, no golden to hold it against`);
}

// ---- (d): a node's pixels are the frame's own crop --------------------------------------------------------------------

{
  const s = spec("table");
  const { outline } = describe("table");
  const node = outline.nodes.find((one) => one.text !== undefined)!;
  const frame = join(work, "table.png");
  const nodePng = join(work, "node.png");
  const result = run([
    "figure", "--spec", "solid/specs/table.json",
    "--png", frame, "--capture", node.id, nodePng,
  ]);
  if (result.status !== 0) bad("capture: the run", `exit ${result.status}: ${result.stderr.trim()}`);
  else {
    const { width, height, pixels } = (await import("./src/ffi.ts")).ui.png(frame) as Raster;
    const part = (await import("./src/ffi.ts")).ui.png(nodePng) as Raster;
    const [x, y, w, h] = node.rect;
    const crop: Raster = { width: w, height: h, pixels: new Uint8Array(w * h * 4) };
    for (let row = 0; row < h; row++)
      crop.pixels.set(pixels.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
    const diff = diffImages(crop, part);
    if (part.width === w && part.height === h && diff?.changed === 0)
      ok("capture: the node's pixels", `"${node.text}" — ${w}x${h} at ${x},${y}, the frame's crop, 0 pixels differ`);
    else bad("capture: the node's pixels", `${part.width}x${part.height}, ${diff ? `${diff.changed} pixels differ` : "another size"}`);
  }
}

// ---- (e): the refusals ------------------------------------------------------------------------------------------------

{
  const stray = run(["figure", "--spec", "solid/specs/table.json", "--capture", "no-such-node", join(work, "x.png")]);
  const sentence = /no element "no-such-node" in the outline \((\d+) nodes/.exec(stray.stderr);
  if (stray.status === 1 && sentence)
    ok("an id the outline does not have", `${sentence[1]} nodes named, exit 1, no file`);
  else bad("an id the outline does not have", `exit ${stray.status}: ${stray.stderr.trim()}`);

  const page = run(["widgets", "--describe"]);
  const why = "the figure's: bun solid/main.ts figure --spec <file.json>";
  if (page.status === 2 && page.stderr.includes(why)) ok("a page that is not the figure", why);
  else bad("a page that is not the figure", `exit ${page.status}: ${page.stderr.trim()}`);
}

console.log(`\nsolid/figure-outline.test.ts: ${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
