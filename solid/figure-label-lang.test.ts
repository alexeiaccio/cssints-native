// The two spec fields the README's table used to leave out: `label`, a screen reader's name for the whole figure, and
// `lang`, the document's language. The checks, in the order the fields travel:
//
//   (a) the defaults: no label is the title (and "A figure" when there is no title either), no lang is `en`, and a spec
//       that sets them carries them through `layoutOf`;
//   (b) the refusals, in their sentences: an empty label, a newline, over 200 characters, and a malformed tag;
//   (c) the standalone SVG: `role="img"`, the label in `aria-label` and a `<title>`, the spec's `lang`, and the label's
//       `&` escaped;
//   (d) the HTML page and the deck (the PDF's own page): `<html lang>`, and the figure's `role`/`aria-label`;
//   (e) the desktop frame: one a11y node for a labelled spec, and none for an unlabelled one;
//   (f) the text half is unchanged by a label (it is not drawn), and a spec read from a file carries its label through
//       `parse` to its SVG.
//
// The specs are this file's own: the package ships the type and no data, so a test writes what it needs.
//
//   bun solid/figure-label-lang.test.ts      (the frame needs `sh solid/native/build.sh` first)
import "./plugin.ts";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { capture, nodes } = await import("./dump.ts");
const { layoutOf } = await import("./src/figure/kinds.ts");
const { deck } = await import("./src/figure/export/deck.ts");
const { html } = await import("./src/figure/export/html.ts");
const { escapeXml, svg } = await import("./src/figure/export/svg.ts");
const { check, parse } = await import("./src/figure/spec.ts");
const { render } = await import("./src/figure/text.ts");

import type { Spec } from "./src/figure/spec.ts";

let failed = 0;
let checks = 0;
const ok = (what: string, extra = "") => (checks++, console.log(`ok   ${what}${extra ? ` — ${extra}` : ""}`));
const bad = (what: string, why: string) => (checks++, failed++, console.error(`FAIL ${what}: ${why}`));
const yes = (okay: boolean, what: string, good: string, why: string) => (okay ? ok(what, good) : bad(what, why));
const refuses = (what: string, input: unknown, sentence: string) => {
  const problems = check(input);
  yes(
    problems.includes(sentence),
    `check: ${what}`,
    sentence,
    `no refusal with ${JSON.stringify(sentence)}: ${JSON.stringify(problems)}`,
  );
};

const source = "README.md, the bench numbers";
/** A valid spec with numbers (so it needs `source`), and a title the label may fall back to. */
const base = (): Spec => ({
  kind: "barChart",
  title: "Build times, by target",
  source,
  data: [
    { label: "desktop", value: 3, text: "0.30 ms" },
    { label: "terminal", value: 1, text: "0.077 ms" },
  ],
  options: { width: 20, max: 3 },
});
const named: Spec = { ...base(), label: "Time & targets", lang: "pt-BR" };

// (a) the defaults
const plain = base();
yes(
  layoutOf(plain).label === plain.title,
  "no label: the title",
  JSON.stringify(layoutOf(plain).label),
  "the label is not the title",
);
const untitled: Spec = { ...base() };
delete (untitled as { title?: string }).title;
yes(
  layoutOf(untitled).label === "A figure",
  "no label or title: A figure",
  '"A figure"',
  `the label is ${JSON.stringify(layoutOf(untitled).label)}`,
);
yes(layoutOf(plain).lang === "en", "no lang: en", '"en"', `the lang is ${JSON.stringify(layoutOf(plain).lang)}`);
yes(
  layoutOf(named).label === named.label && layoutOf(named).lang === named.lang,
  "the layout carries both",
  `${JSON.stringify(layoutOf(named).label)}, ${JSON.stringify(layoutOf(named).lang)}`,
  "the layout did not carry the spec's label and lang",
);

// (b) the refusals, in their sentences
refuses("an empty label", { ...base(), label: "   " }, "A figure's label is one line of text: it is empty.");
refuses(
  "a label with a newline",
  { ...base(), label: "one line\nand another" },
  "A figure's label is one line of text: it has a newline in it.",
);
refuses(
  "a label over 200 characters",
  { ...base(), label: "x".repeat(201) },
  "A figure's label is one line of text: it is 201 characters, over the 200 a screen reader reads.",
);
refuses(
  "a malformed lang",
  { ...base(), lang: "Russian" },
  'A figure\'s lang is a language tag like "pt-BR", not "Russian".',
);
yes(
  check({ ...base(), label: "A bar chart, named", lang: "pt-BR" }).length === 0,
  "a valid label and lang",
  "no problems",
  JSON.stringify(check({ ...base(), label: "A bar chart, named", lang: "pt-BR" })),
);

// (c) the standalone SVG: the root's three attributes and the title
const xml = svg(named);
const root = xml.slice(0, xml.indexOf(">") + 1);
for (const attribute of ['role="img"', `aria-label="${escapeXml(named.label!)}"`, `lang="${named.lang}"`])
  yes(root.includes(attribute), `the SVG root has ${attribute}`, "", `${JSON.stringify(root)} has no ${attribute}`);
yes(
  xml.includes(`<title>${escapeXml(named.label!)}</title>`),
  "the SVG's <title> is the label",
  escapeXml(named.label!),
  "the <title> is not the label",
);
yes(
  !root.includes(`aria-label="${named.label}"`) && root.includes("Time &amp; targets"),
  "the SVG escapes the label's &",
  "Time &amp; targets",
  `the label was not escaped: ${JSON.stringify(root)}`,
);

// (d) the HTML page and the deck (the PDF is that deck printed)
const page = html(named);
yes(page.includes(`<html lang="${named.lang}">`), "the HTML page's lang", named.lang!, "the page's <html> has not the spec's lang");
yes(
  page.includes(`<figure role="img" aria-label="${escapeXml(named.label!)}">`),
  "the HTML figure's name",
  escapeXml(named.label!),
  "the figure has no role/aria-label",
);
const slides = deck([named, plain]);
yes(
  slides.includes(`<html lang="${named.lang}">`),
  "the deck's lang is its first slide's",
  named.lang!,
  "the deck's <html> has not the first spec's lang",
);
yes(
  slides.includes(`<figure role="img" aria-label="${escapeXml(named.label!)}">`) &&
    slides.includes(`<figure role="img" aria-label="${escapeXml(plain.title!)}">`),
  "each slide's figure is named",
  `${escapeXml(named.label!)}; ${escapeXml(plain.title!)}`,
  "a slide's figure has no role/aria-label",
);

// (e) the desktop frame: an a11y node for a labelled spec, none without
const labelled = await capture("figure", undefined, { spec: named, warm: 2 });
const one = labelled.a11y.children[0];
yes(
  nodes(labelled.a11y) === 1 && one?.role === "img" && one?.name === named.label,
  "a labelled frame has one a11y node",
  `img ${JSON.stringify(named.label)}`,
  `${nodes(labelled.a11y)} nodes: ${JSON.stringify(labelled.a11y.children)}`,
);
const unlabelled = await capture("figure", undefined, { spec: plain, warm: 2 });
yes(nodes(unlabelled.a11y) === 0, "an unlabelled frame has none", "0 nodes", `${nodes(unlabelled.a11y)} nodes`);

// (f) the text half, and a spec read from a file
yes(render(named) === render(plain), "the text half is unchanged by a label", "the same characters", "the label changed the text");
const dir = mkdtempSync(join(tmpdir(), "cssints-label-"));
const file = join(dir, "named.json");
writeFileSync(file, JSON.stringify(named));
const parsed = parse(JSON.stringify(named), { dir });
yes(parsed.spec?.label === named.label, "a spec read from a file keeps its label", JSON.stringify(named.label), JSON.stringify(parsed.problems));
if (parsed.spec) {
  const readXml = svg(parsed.spec);
  yes(
    readXml.includes(`aria-label="${escapeXml(named.label!)}"`),
    "and its label reaches the SVG",
    named.label!,
    "the SVG's aria-label is not the file's label",
  );
}

console.log(`\nfigure-label-lang: ${checks} checks, ${failed} failed`);
if (failed) process.exit(1);
