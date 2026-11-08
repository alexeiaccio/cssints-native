// `solid/specs/screen.json` and `solid/specs/anatomy.json`, written from a page this package draws: the Widgets page at its
// own 360x760, and a component of it with numbered callouts. (The `responsivePair` kind's data was the Sky feed of the web
// app, which is not in this package: the kind is here, its spec is not.) The frames are `solid/dump.ts`'s `capture` — the
// same call the goldens are stored with — and `frameOf` keeps the boxes (`rectangle`/`border`) and the texts (`text`) and
// drops the rest (see `src/figure/kinds/wireframe.ts`), so a wireframe is a cut of what the page drew. The sizes are the
// captured frames' own, so a page that changes size changes the spec.
//
// The anatomy's crop and its four callouts are the author's annotation, not the frame's: the drawing under them is the
// page's (cmp'd), the numbers and their words are checked against it (inside the crop, one per cell, 1-9).
//
//   bun solid/specs/from-page.ts                  # rewrite both specs here
//   bun solid/specs/from-page.ts "$TMPDIR/specs"  # ... or into another directory, for solid/test.sh's cmp
//
// `solid/test.sh` regenerates them and `cmp`s: a page edit changes its wireframe in the same commit, and a size that
// moved is a `cmp` line, not a review note. The specs' `source` records each page and the size it was captured at.
import "../plugin.ts";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FrameDump } from "../src/dump.ts";
import { frameOf } from "../src/figure/kinds/wireframe.ts";
import { check, type AnatomySpec, type ScreenSpec, type WireSide } from "../src/figure/spec.ts";

/** The screen's page: its own size (PAGES.widgets, 360x760) is the capture's. */
export const SCREEN_PAGE = "widgets";
/** The anatomy's page (the same Widgets page), the region of it drawn, and its four callouts: the switch, its label,
 *  the Wi-Fi checkbox and the same control one row down. The crop is 296x120, 37x8 cells. */
export const ANATOMY_PAGE = "widgets";
export const ANATOMY_CROP = { x: 32, y: 56, width: 296, height: 120 } as const;
export const ANATOMY_PARTS = [
  { n: 1, x: 32, y: 72, label: "the button: one tappable panel" },
  { n: 2, x: 128, y: 82, label: "its label, the press count" },
  { n: 3, x: 40, y: 122, label: "a checkbox and its box" },
  { n: 4, x: 40, y: 159, label: "the same control, one row down" },
] as const;

/** One captured frame as a side: its own size and the boxes and texts the wireframe draws. */
const sideOf = (dump: FrameDump): WireSide => ({
  width: dump.size[0],
  height: dump.size[1],
  ...frameOf(dump.commands),
});

/** The two specs, with the frame's own counts in their intent and their source naming the page and the size. */
export function specsOf(screen: FrameDump) {
  const screenSide = sideOf(screen);
  const screenData = { page: SCREEN_PAGE, ...screenSide };
  const screenSpec: ScreenSpec = {
    kind: "screen",
    title: "The Widgets page, as a wireframe",
    intent:
      `The Widgets page's own last frame, cut to the cell grid: its ${screenData.boxes.length} rectangles and borders ` +
      `outlined and its ${screenData.texts.length} text runs in its words. The data is the page's command stream, not a ` +
      `drawing of it.`,
    source: `solid/specs/from-page.ts: solid/dump.ts's capture of the ${SCREEN_PAGE} page at ` +
      `${screenData.width}x${screenData.height}; ${screenData.boxes.length} boxes, ${screenData.texts.length} texts`,
    data: screenData,
  };
  const anatomySpec: AnatomySpec = {
    kind: "anatomy",
    title: "The Widgets switch, part by part",
    intent:
      `The ${SCREEN_PAGE} page's own frame cut to ${ANATOMY_CROP.width}x${ANATOMY_CROP.height}px at ` +
      `${ANATOMY_CROP.x},${ANATOMY_CROP.y} — the button and the two checkbox rows — with ${ANATOMY_PARTS.length} ` +
      `numbered callouts and their legend. The drawing is the page's command stream; the numbers are the annotation.`,
    source: `solid/specs/from-page.ts: solid/dump.ts's capture of the ${ANATOMY_PAGE} page at ` +
      `${screenSide.width}x${screenSide.height}, cropped to ${ANATOMY_CROP.width}x${ANATOMY_CROP.height} at ` +
      `${ANATOMY_CROP.x},${ANATOMY_CROP.y}`,
    data: { page: ANATOMY_PAGE, ...screenSide, crop: ANATOMY_CROP, parts: ANATOMY_PARTS },
  };
  return { screenSpec, anatomySpec };
}

if (import.meta.main) {
  const { capture, PAGES } = await import("../dump.ts");
  const screen = await capture(SCREEN_PAGE);
  const { screenSpec, anatomySpec } = specsOf(screen);
  for (const spec of [screenSpec, anatomySpec]) {
    const problems = check(spec);
    if (problems.length) throw new Error(`${spec.kind} would not draw: ${problems.join(" ")}`);
  }
  if (screen.size[0] !== PAGES[SCREEN_PAGE].width || screen.size[1] !== PAGES[SCREEN_PAGE].height)
    throw new Error(`the ${SCREEN_PAGE} capture is ${screen.size.join("x")}, PAGES says ${PAGES[SCREEN_PAGE].width}x${PAGES[SCREEN_PAGE].height}`);
  const dir = process.argv[2] ?? new URL(".", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  for (const [name, spec] of [
    ["screen.json", screenSpec],
    ["anatomy.json", anatomySpec],
  ] as const) {
    writeFileSync(join(dir, name), `${JSON.stringify(spec, null, 2)}\n`);
    console.log(`from-page: ${join(dir, name)}`);
  }
  console.log(
    `from-page: ${screenSpec.data.boxes.length} boxes and ${screenSpec.data.texts.length} texts of the ${SCREEN_PAGE} page; ` +
      `${anatomySpec.data.parts.length} callouts on a ${ANATOMY_CROP.width}x${ANATOMY_CROP.height} crop of it`,
  );
}
