// The inline-styles page against the same page with its styles in a separate module: the same Clay tree drawn twice,
// compared pixel for pixel. What that covers is the whole vocabulary the page uses: tokens and a global theme, fonts,
// composed styles (panel from card, chipOn from chip), nested states (hover, active, focus) and JSX using a style from
// the same file. Then the frame stored for the desktop.
import "./plugin.ts";

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { El, render } = await import("./src/renderer.ts");
const { InlineDemo } = await import("./app/InlineDemo.tsx");
const { InlineDemoSplit } = await import("./app/InlineDemoSplit.tsx");

const W = 360;
const H = 440;
ui.init(W, H);
ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);

const dir = new URL("./frames/", import.meta.url).pathname;
const tmp = join(tmpdir(), "cssints-native-inline");
mkdirSync(tmp, { recursive: true });

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) failed++, console.error(`FAIL ${what}: ${a}, wanted ${b}`);
};

// the page as the window runs it, in the given theme, with the pointer over the button and the button pressed and
// focused, so the hover, active and focus looks are all in the frame
function draw(Page: (props: { focus?: boolean }) => unknown, theme?: string) {
  const root = new El("root");
  const frame = createFrame(root, { theme });
  const dispose = render(() => Page({ focus: true }), root);
  frame(-1, -1, false, 1 / 60);
  const [x, y, w, h] = ui.bounds(Buffer.from("press"))!;
  frame(x! + w! / 2, y! + h! / 2, true, 1 / 60);
  dispose();
}

// the two pages, same tree and same values: the pixels must be the same
for (const [what, theme] of [["dark", undefined], ["light", "light"]] as const) {
  draw(InlineDemo, theme);
  ui.savePng(`${tmp}inline-${what}.png`);
  draw(InlineDemoSplit, theme);
  check(`${what}: the inline page and the split page are the same frame`, ui.diffPng(`${tmp}inline-${what}.png`, `${tmp}inline-${what}.actual.png`), 0);
}

// the frame the desktop keeps: the inline page, hover and pressed and focused
draw(InlineDemo);
if (process.argv.includes("--write")) ui.savePng(`${dir}inline-demo.png`);
else check("the stored frame", ui.diffPng(`${dir}inline-demo.png`, `${dir}inline-demo.png.actual.png`), 0);

if (failed) process.exit(1);
console.log("solid/inline.test.ts: the inline-styles page and the split one are identical (dark and light), and the stored frame matches");
process.exit(0);
