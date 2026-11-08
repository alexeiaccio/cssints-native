// The two fields the kit's spec had and ours did not: `data: "@path"` (a file beside the spec) and `sample: true` (the
// SAMPLE DATA stamp). The test is the pair's honesty:
//
//   (a) a spec whose data is a file parses to the data the file holds, and its frame is the same frame the same spec draws
//       with that data inlined — byte for byte, so moving the data out of funnel.json, compare.json and journey-map.json
//       moved no cell;
//   (b) a path's refusals, each in its sentence: no base directory, a missing file, a path that climbs out, an absolute
//       path, and a file that is not JSON;
//   (c) `sample: true` draws the SAMPLE DATA band in the layout's first line, the SVG's first row and the HTML export, and
//       a spec without it draws no band; `sample` that is not `true` is refused;
//   (d) the four kit examples carry `sample: true` (their data is not this repository's) and our own specs do not.
//
//   bun solid/figure-file-sample.test.ts
import "./plugin.ts";

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Spec } from "./src/figure/spec.ts";

const { capture } = await import("./dump.ts");
const { layoutOf } = await import("./src/figure/kinds.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { html } = await import("./src/figure/export/html.ts");
const { svg } = await import("./src/figure/export/svg.ts");
const { format } = await import("./src/format.ts");

const SPECS = new URL("./specs/", import.meta.url).pathname;
/** The three whose data moved out of the spec: the kit's own examples, adapted. */
const MOVED = ["funnel", "compare", "journey-map"] as const;

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));

const source = (name: string) => readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8");
const spec = (name: string): Spec => {
  const parsed = parse(source(name), { dir: SPECS });
  if (!parsed.spec) throw new Error(`solid/specs/${name}.json: ${parsed.problems.join(" ")}`);
  return parsed.spec;
};

/** One spec's frame, the same capture the goldens store. */
const frameOf = async (s: Spec): Promise<string> => {
  const dump = await capture("figure", undefined, { spec: s, warm: 2 });
  return format({ commands: dump.commands, effects: dump.effects });
};

// (a) the file and the inline data are one spec: the same data, the same commands
for (const name of MOVED) {
  const text = source(name);
  const fromFile = parse(text, { dir: SPECS }).spec;
  if (!fromFile) {
    bad(`${name}: @data`, parse(text, { dir: SPECS }).problems.join(" "));
    continue;
  }
  const raw = JSON.parse(text) as { data: string };
  const data = JSON.parse(readFileSync(new URL(`./specs/${raw.data.slice(1)}`, import.meta.url), "utf8"));
  const inline = parse(JSON.stringify({ ...raw, data })).spec;
  if (!inline) {
    bad(`${name}: inline`, "the inlined spec is refused");
    continue;
  }
  const sameData = JSON.stringify(fromFile.data) === JSON.stringify(inline.data);
  if (sameData) ok(`${name}: @data parses to the file's data`, `${raw.data}, ${JSON.stringify(data).length} bytes`);
  else bad(`${name}: @data`, "the parsed data is not the file's JSON");
  const [a, b] = [await frameOf(fromFile), await frameOf(inline)];
  if (a === b)
    ok(`${name}: the frame`, `${a.split("\n").length - 1} commands, the @data spec and the inline one byte-identical`);
  else bad(`${name}: the frame`, "the @data spec's frame is not the inline spec's");
}

// the current signature still takes inline data with no path
{
  const inline = parse(JSON.stringify({ kind: "barChart", source: "Sample", data: [{ label: "a", value: 1 }] }));
  if (inline.spec?.data) ok("inline data", "parse(text) with no options still takes the rows it is given");
  else bad("inline data", JSON.stringify(inline.problems));
}

// (b) the path's refusals, each in its sentence
const refuses = (what: string, text: string, sentence: string, dir?: string) => {
  const problems = parse(text, dir === undefined ? {} : { dir }).problems;
  if (problems.some((problem) => problem.includes(sentence))) ok(`refused: ${what}`, sentence);
  else bad(`refused: ${what}`, `no ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`);
};
const flow = (data: unknown) => JSON.stringify({ kind: "flow", source: "Sample", data });
refuses(
  "no path",
  source("funnel"),
  'A spec whose data is "@…" needs the file it sits in: parse() was given no path.',
);
refuses(
  "a missing file",
  flow("@data/none.json"),
  'data "@data/none.json" names no file beside the spec.',
  SPECS,
);
refuses(
  "a path that climbs out",
  flow("@../funnel.json"),
  'data "@../funnel.json" leaves the spec\'s directory: a data path goes no higher.',
  SPECS,
);
refuses(
  "an absolute path",
  flow("@/tmp/funnel.json"),
  'data "@/tmp/funnel.json" is absolute: write the path relative to the spec\'s own directory.',
  SPECS,
);
{
  const work = mkdtempSync(join(tmpdir(), "cssints-figure-file-"));
  writeFileSync(join(work, "bad.json"), "{ this is not JSON");
  writeFileSync(join(work, "spec.json"), flow("@bad.json"));
  const problems = parse(readFileSync(join(work, "spec.json"), "utf8"), { dir: work }).problems;
  const sentence = 'data "@bad.json" is not JSON:';
  if (problems.some((problem) => problem.startsWith(sentence))) ok("refused: a file that is not JSON", problems[0]!);
  else bad("refused: a file that is not JSON", JSON.stringify(problems));
}

// (c) the stamp: the layout's first line, the SVG's first row, the export, and nothing when the data is ours
{
  const sample = spec("funnel");
  const layout = layoutOf(sample);
  const first = layout.lines[0]?.items[0];
  const band =
    first?.kind === "text" &&
    first.textId === "fig-sample" &&
    first.paint === "muted" &&
    first.text.startsWith("+") &&
    first.text.endsWith("+") &&
    first.text.includes(" SAMPLE DATA ") &&
    first.cells === layout.width;
  if (band && first && first.kind === "text")
    ok("the stamp in the layout", `line 1 is "${first.text}" (${first.cells} cells, the figure's width, muted)`);
  else bad("the stamp in the layout", JSON.stringify(first));

  const xml = svg(sample);
  const row = /<text[^>]*>([^<]*)<\/text>/.exec(xml)?.[1] ?? "";
  if (row.includes("SAMPLE DATA")) ok("the stamp in the SVG", `the first <text> is ${JSON.stringify(row)}`);
  else bad("the stamp in the SVG", `the first <text> is ${JSON.stringify(row)}`);

  const page = html(sample);
  if (page.includes("SAMPLE DATA") && page.includes(svg(sample)))
    ok("the stamp in the export", "the page carries the stamp, and the SVG inline and verbatim");
  else bad("the stamp in the export", `stamp ${page.includes("SAMPLE DATA")}, the SVG verbatim ${page.includes(svg(sample))}`);

  const ours = layoutOf(spec("bars"));
  const noStamp = ours.lines.every((line) => line.items.every((item) => !("textId" in item) || item.textId !== "fig-sample"));
  const titleFirst = ours.lines[0]?.items[0];
  if (noStamp && titleFirst?.kind === "text" && titleFirst.textId === "fig-title")
    ok("no stamp on our own data", `bars' first line is its title, "${titleFirst.text}"`);
  else bad("no stamp on our own data", JSON.stringify(titleFirst));

  const yes = check({ kind: "barChart", source: "Sample", sample: "yes", data: [{ label: "a", value: 1 }] });
  const sentence = "sample is true when the data is not the author's, and absent when it is";
  if (yes.some((problem) => problem.startsWith(sentence))) ok('refused: sample: "yes"', yes[0]!);
  else bad('refused: sample: "yes"', JSON.stringify(yes));
}

// (d) the kit's four examples are samples; ours are this repository's
{
  const kit = ["funnel", "compare", "journey-map", "pipeline"] as const;
  const wrong = kit.filter((name) => spec(name).sample !== true);
  const ours = ["bars", "palette", "cohort", "tree", "table"] as const;
  const marked = ours.filter((name) => spec(name).sample !== undefined);
  if (!wrong.length && !marked.length)
    ok("the kit's examples are samples", `${kit.join(", ")}: sample true; ${ours.join(", ")}: absent`);
  else bad("the kit's examples are samples", `unmarked ${wrong.join(", ") || "none"}; ours marked ${marked.join(", ") || "none"}`);
}

if (failed) {
  console.error(`solid/figure-file-sample.test.ts: ${failed} failure(s) of ${checks} checks`);
  process.exit(1);
}
console.log(`solid/figure-file-sample.test.ts: ${checks} checks; @file's frames are the inline data's, byte for byte`);
