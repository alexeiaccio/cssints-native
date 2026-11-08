// `timeline.json`, written from `docs/map.md`: the map's own plan as its figure, so a step added, renamed or
// reordered in the map is a rewrite here and a `cmp` in solid/test.sh. This is the generated one of the three planning
// specs; `nowNextLater.json` and `statusKey.json` are hand-written, and why is below.
//
//   node native/solid/specs/from-map.ts            rewrites timeline.json here in place
//   node native/solid/specs/from-map.ts <dir>      writes it into <dir> (the check's own way: it writes nothing)
//
// The parse, and what it assumes — narrowly, because the map is prose and a parse that guessed more would lie:
//   — the steps are the numbered bold headings of `## Order of work` (`1. **Done: desktop window.**`), and nothing
//     after that section;
//   — a step's label is its heading after a leading `Done:` (or `Done.`), cut at ` in ` (the rest names the module a
//     step is in, not the step), and, when the heading is a bare `Done.`, the line's first `` `code` `` span;
//   — a step's status is `Done` when its heading begins with it, else `Left` (the map's two words for a step);
//   — its note is the first ISO date the step's section records, if it records one. It is a note and not the `date`
//     field: the dates do not run in the map's order (step 4 records 2026-10-31, step 7 a 2026-10-21), so they cannot
//     be a checked axis. The axis is the order itself: one step is four cells of the 32-cell axis.
//
// `nowNextLater.json` is **not** written here. Its cards are the map's `Left:` lists, and those lines are not machine
// readable enough to group honestly: one opens with a bold note of what was *added* later (`Left: **termbox2 is in** …;
// what a click cannot do is hover`), one turns into a note of what came later after a semicolon, and the now/next/later
// split is a judgement about the map's own order of targets. So the board is hand-written, and figure-planning.test.ts
// holds every card's words to the map's (a card that is not a fragment of a `Left:` line fails there).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The map, from this file (native/solid/specs). */
const MAP = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/map.md");

interface Step {
  number: number;
  heading: string;
  line: string;
  body: string[];
}

/** The numbered bold headings of the map's `## Order of work`, each with its section. */
function stepsOf(text: string): Step[] {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.startsWith("## Order of work"));
  if (from < 0) throw new Error("docs/map.md has no '## Order of work' section");
  const to = lines.findIndex((line, i) => i > from && line.startsWith("## "));
  const end = to < 0 ? lines.length : to;
  const steps: Step[] = [];
  for (let i = from; i < end; i++) {
    const heading = /^(\d+)\. \*\*(.+?)\*\*/.exec(lines[i]!);
    if (!heading) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < end && !/^\d+\. \*\*/.test(lines[j]!)) body.push(lines[j++]!);
    steps.push({ number: Number(heading[1]), heading: heading[2]!, line: lines[i]!, body });
  }
  return steps;
}

/** A step's label: the heading's own words, not the module it names or the `Done` that marks it. */
function labelOf(step: Step): string {
  let label = step.heading.replace(/^Done:?\s*/, "");
  label = label.split(" in ")[0] ?? label;
  label = label.replace(/[.:]+$/, "").trim();
  if (label) return label;
  const code = /`([^`]+)`/.exec(step.line);
  return code?.[1] ?? `step ${step.number}`;
}

const text = readFileSync(MAP, "utf8");
const steps = stepsOf(text);
const timeline = {
  kind: "timeline",
  title: "The plan's order, one step a row",
  intent:
    "docs/map.md's steps of work, each a row across one shared axis: the span is the step's place in the map's " +
    "order, not hours.",
  source: "docs/map.md, steps 1-8; a span is the order, a date is a note",
  data: steps.map((step) => {
    const date = /20\d\d-\d\d-\d\d/.exec([step.line, ...step.body].join(" "))?.[0];
    return {
      label: labelOf(step),
      start: step.number - 1,
      end: step.number,
      status: /^Done/.test(step.heading) ? "Done" : "Left",
      ...(date ? { note: date } : {}),
    };
  }),
  options: { start: 0, end: Math.max(1, steps.length), width: 32, unit: " step" },
};

const out = process.argv[2] ? resolve(process.argv[2]) : dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });
const file = resolve(out, "timeline.json");
writeFileSync(file, `${JSON.stringify(timeline, null, 2)}\n`);
console.log(`from-map: ${file} (${timeline.data.length} steps of docs/map.md)`);
