// The Solid List page's own frame at the two states examples/list/gen.c dumps, as the reference the generated C is
// compared with (dump-check.ts): the page through the host's own loop — `ui_init`, the font, the page's `input` and
// `motion`, a frame a 1/60s — and `ui_dump_json`'s data, the emitter every golden in solid/goldens is stored with.
//
//   bun examples/list/solid-dump.ts <out dir>     solid-rest.json, solid-scrolled.json
//
// The page owns its viewport's offset (`solid/src/vscroll.ts`), and the wheel is the host's to deliver to the page's
// `motion.onWheel` — `main.ts --wheel`'s line, which `solid/dump.ts`'s `capture` has no field for. So this is the loop
// itself: 31 frames at rest (the page at rest is the stored frame), then a notch down and 90 frames of settle — the
// offset the page's own test settles on, exactly 10px, with the scrollbar faded out (600ms + its 0.15s fade) — and one
// frame at each state. The rest frame is `solid/goldens/list.json` byte for byte (test.sh compares the two); the scrolled
// one is the same page 10px down, which no stored frame is (`frames/list-wheel.png` is 32 notches).
import "../../solid/plugin.ts";

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Motion } from "../../solid/src/entry.ts";
import type { Input } from "../../solid/src/input.ts";

const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });

const { ui } = await import("../../solid/src/ffi.ts");
const { createFrame } = await import("../../solid/src/frame.ts");
const { createInput } = await import("../../solid/src/input.ts");
const { El, render } = await import("../../solid/src/renderer.ts");
const { dumpPage, format } = await import("../../solid/src/dump.ts");
const { List } = await import("../../solid/app/List.tsx");

const WIDTH = 360;
const HEIGHT = 400;
const WARM = 31; // the page at rest: 30 rest frames and the one the frame is written on (solid/dump.ts's PAGES.list)
const SETTLE = 90; // frames after the notch: the track settles at exactly 10 and the scrollbar has faded out

const font = new URL("../../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname;
if (ui.init(WIDTH, HEIGHT) || ui.font(font) < 0) throw new Error("ui_init or ui_font failed (thorvg? build/solid)");

const input: Input = createInput();
const motion: Motion = {};
const root = new El("root");
const dispose = render(() => List({ input, motion }), root);
// the hooks `main.ts` and `solid/dump.ts` wire, and nothing else: the page's own tick, its wheel and its pointer
const frame = createFrame(root, {
  onPointer: (x, y, down, touch) => motion.onPointer?.(x, y, down, touch),
  onWheel: (dx, dy) => motion.onWheel?.(dx, dy),
  tick: (dt) => motion.tick?.(dt),
});
/** One frame at 1/60s with nothing in it, as `capture` makes them. */
const step = (px = -1, py = -1) => frame(px, py, false, 1 / 60, false);

const write = (name: string) => {
  const dump = dumpPage(root);
  writeFileSync(`${out}/solid-${name}.json`, `${format(dump)}\n`);
  console.log(`solid-${name}: ${dump.commands.length} commands`);
};

for (let n = 0; n < WARM; n++) step();
write("rest");
// one notch down, as `main.ts --wheel 1` gives it: the pointer onto the viewport for a frame (the page's wheel is gated on
// `ui.over`, Clay's own rule), then SDL's delta (negative is down) into the page's own hook, then the frames it settles on
const [left, top, width, height] = ui.bounds(Buffer.from("list")) ?? [0, 0, 0, 0];
const [px, py] = [left + width / 2, top + height / 2];
step(px, py);
motion.onWheel?.(0, -1);
for (let n = 0; n < SETTLE; n++) step(px, py);
write("scrolled");
if (ui.errors()) throw new Error(`${ui.errors()} Clay errors`);
dispose();
