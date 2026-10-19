// The Solid host, the counterpart of desktop/host.c. Run with Bun:
//
//   bun solid/main.ts                    a window; the mouse is the pointer, `t` flips the theme
//   bun solid/main.ts --png out.png      one frame headless, written to out.png
//   bun solid/main.ts --expect ref.png   the same frame compared with ref.png pixel for pixel; exit 1 and write
//                                        ref.png.actual.png on a difference
//   --click X Y                          headless: a press and a release at X,Y before the frame that is written
//                                        (frame 0 lays out, pressed in 1, released in 2, frame 3 is written)
//   --bench N                            headless: N more frames, the ms a frame by phase
//   --frames N                           window: close after N frames (a smoke test)
//   THEME=light                          the light theme
import "./plugin.ts";

const W = 360;
const H = 360;
const arg = (name: string, n = 1) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv.slice(i + 1, i + 1 + n);
};
const png = arg("--png")?.[0];
const expect = arg("--expect")?.[0];
const click = arg("--click", 2)?.map(Number);
const bench = Number(arg("--bench")?.[0] ?? 0);
const maxFrames = Number(arg("--frames")?.[0] ?? Infinity);
let theme = process.env.THEME === "light" ? "light" : undefined;

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { El, render } = await import("./src/renderer.ts");
const { Sensors } = await import("./app/Sensors.tsx");

if (ui.init(W, H) || ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname) < 0) {
  console.error("ui_init or ui_font failed (is thorvg installed, and build/solid/libui.dylib built?)");
  process.exit(1);
}
const root = new El("root");
const dispose = render(Sensors, root);
const stats: [number, number, number, number][] = [];
const frame = createFrame(root, {
  get theme() {
    return theme;
  },
  stats,
});

const headless = png || expect;
if (headless) {
  // as host.c: a scripted click is frames 0 to 2 at the point, pressed in frame 1, and frame 3 is written
  for (let n = 0; n < (click ? 4 : 1); n++) frame(click?.[0] ?? -1, click?.[1] ?? -1, n === 1, 1 / 60);
  let status = ui.errors() ? 1 : 0;
  if (png) ui.savePng(png);
  if (expect) {
    const n = ui.diffPng(expect, `${expect}.actual.png`);
    if (n) {
      console.error(`${expect}: ${n} pixels differ (-1: missing or another size); this frame is ${expect}.actual.png`);
      status = 1;
    } else console.log(`${expect}: identical`);
  }
  if (bench) {
    const px = click?.[0] ?? -1;
    const py = click?.[1] ?? -1;
    const units = (function find(n: any): any {
      return n.props?.id === "Units" ? n : n.children?.map(find).find(Boolean);
    })(root);
    for (const flips of [false, true]) {
      stats.length = 0;
      for (let n = 0; n < bench; n++) {
        if (flips) units.props.onClick(); // the signal changes every frame: Solid updates texts, Clay measures
        frame(px, py, false, 1 / 60);
      }
      const ms = [0, 1, 2, 3].map((i) => (stats.reduce((sum, s) => sum + s[i]!, 0) / bench / 1e6).toFixed(3));
      console.log(
        `solid, ${flips ? "state changes every frame" : "state still"}: ${bench} frames, ms a frame: ` +
          `events+flush ${ms[0]}, declare ${ms[1]} (JS walk + FFI + Clay's declaration and text measure), layout ${ms[2]}, draw ${ms[3]}`,
      );
    }
  }
  dispose();
  process.exit(status);
}

const scale = ui.windowOpen("cssints-native (solid)");
if (!scale) {
  console.error("window: SDL could not open one");
  process.exit(1);
}
console.log(`window: pixel density ${scale}`);
const input = new Float32Array([-1, -1, 0, 0, 0]);
let last = performance.now();
for (let n = 0; n < maxFrames; n++) {
  ui.windowPoll(input);
  if (input[3]) break;
  if (input[4] === "t".charCodeAt(0)) theme = theme ? undefined : "light";
  const now = performance.now();
  frame(input[0]!, input[1]!, input[2] !== 0, (now - last) / 1000);
  last = now;
  ui.windowPresent();
  await Bun.sleep(16);
}
dispose();
process.exit(0);
