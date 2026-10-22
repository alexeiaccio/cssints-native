// The Solid host, the counterpart of desktop/host.c. Run with Bun:
//
//   bun solid/main.ts [sensors|widgets|dialog|form|list|sky]  a window; the mouse is the pointer, `t` flips the theme;
//                                        on widgets Tab, Shift+Tab, Space and Enter drive the widgets; on dialog Enter
//                                        opens the settings dialog and Space opens the menu; on form Tab reaches the
//                                        text field, typing fills it, Enter submits, Escape blurs (and `t` flips the
//                                        theme again once no field has focus); on list Tab reaches the list, Up/Down,
//                                        PageUp/PageDown and Home/End move the selection and the wheel scrolls it; on
//                                        sky Tab reaches the tablist then the feed, the arrows switch feeds, and on the
//                                        feed Up/Down, PageUp/PageDown and Home/End scroll it
//   bun solid/main.ts --png out.png      one frame headless, written to out.png
//   bun solid/main.ts --expect ref.png   the same frame compared with ref.png pixel for pixel; exit 1 and write
//                                        ref.png.actual.png on a difference
//   --click X Y                          headless: a press and a release at X,Y before the frame that is written
//                                        (frame 0 lays out, pressed in 1, released in 2, frame 3 is written)
//   --keys Tab,Tab,Space                 headless: a frame, then each key pressed and released with a frame after it
//                                        (names as the focus manager and the parts take them: Shift+Tab, Enter, ArrowLeft,
//                                        Space for " "); the last frame is written. A step `text:Ada` is typed text
//                                        (`Input.textInput`), not a key: --keys Tab,text:Ada,Shift+ArrowLeft
//   --wheel N                            headless, before --keys: the pointer onto the element `--wheel-over` names (the
//                                        list's viewport by default), then N wheel notches down, a frame each (one
//                                        notch is 10px of Clay's scroll)
//   --wheel-over ID                      the element the wheel's pointer goes onto (default "list")
//   --bench N                            headless: N more frames, the ms a frame by phase
//   --raster thorvg|thorvg-gpu           the ThorVG software canvas (the default) or its WebGPU canvas, the frame read
//                                        back; the latter needs a libui.dylib from desktop/build-thorvg-gpu.sh solid
//   --frames N                           window: close after N frames (a smoke test)
//   THEME=light                          the light theme
import "./plugin.ts";
import type { Drag } from "./app/Widgets.tsx";

const page = process.argv[2]?.startsWith("--") ? "sensors" : (process.argv[2] ?? "sensors");
if (page !== "sensors" && page !== "widgets" && page !== "dialog" && page !== "form" && page !== "list" && page !== "sky") {
  console.error(`unknown page "${page}": sensors, widgets, dialog, form, list or sky`);
  process.exit(1);
}
const arg = (name: string, n = 1) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv.slice(i + 1, i + 1 + n);
};
const png = arg("--png")?.[0];
const expect = arg("--expect")?.[0];
const click = arg("--click", 2)?.map(Number);
// headless: a drag on the widgets slider: two fractions of the rail (press at the first, held, then move to the second)
const drag = arg("--drag", 2)?.map(Number);
const keys = arg("--keys")?.[0]?.split(",");
// headless: wheel notches down over the element --wheel-over names, a frame each
const wheel = Number(arg("--wheel")?.[0] ?? 0);
const wheelOver = arg("--wheel-over")?.[0] ?? "list";
const bench = Number(arg("--bench")?.[0] ?? 0);
// the raster: ThorVG's software canvas (the default) or its WebGPU one, when the dylib was built for it
const gpu = arg("--raster")?.[0] === "thorvg-gpu";
const maxFrames = Number(arg("--frames")?.[0] ?? Infinity);
let theme = process.env.THEME === "light" ? "light" : undefined;

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput, selectionName } = await import("./src/input.ts");
const { El, render } = await import("./src/renderer.ts");
const { Sensors } = await import("./app/Sensors.tsx");
const { Widgets, size } = await import("./app/Widgets.tsx");
const { Dialog, size: dialogSize } = await import("./app/Dialog.tsx");
const { Field, size: fieldSize } = await import("./app/Field.tsx");
const { List, size: listSize } = await import("./app/List.tsx");
const { Sky, size: skySize } = await import("./app/Sky.tsx");

const W = 360;
const H =
  page === "widgets"
    ? size.height
    : page === "dialog"
      ? dialogSize.height
      : page === "form"
        ? fieldSize.height
        : page === "list"
          ? listSize.height
          : page === "sky"
            ? skySize.height
            : 360;

if ((gpu ? ui.initGpu(W, H) : ui.init(W, H)) || ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname) < 0) {
  console.error("ui_init or ui_font failed (is thorvg installed, and build/solid/libui.dylib built?)");
  process.exit(1);
}
const root = new El("root");
const input = createInput();
// `t` is the page's shortcut only while no text field has focus: a letter typed into one is a character, not a key
input.fallback = (name) => (name === "t" && !input.editing() ? ((theme = theme ? undefined : "light"), true) : false);
const dragState: Drag = {};
const dispose = render(
  page === "widgets"
    ? () => Widgets({ input, drag: dragState })
    : page === "dialog"
      ? () => Dialog({ input })
      : page === "form"
        ? () => Field({ input })
        : page === "list"
          ? () => List({ input })
          : page === "sky"
            ? () => Sky({ input })
            : Sensors,
  root,
);
const stats: [number, number, number, number][] = [];
const frame = createFrame(root, {
  get theme() {
    return theme;
  },
  onPointer: (x, y, down) => dragState.onPointer?.(x, y, down),
  onPressMiss: () => input.pressMiss(),
  stats,
});

const headless = png || expect;
if (headless) {
  if (drag) {
    // a drag on the widgets slider: frame 0 lays out, 1 puts the pointer on the rail, 2 presses at the first fraction,
    // then the pointer moves to the second with the button held and the last frame (still held) is written
    frame(-1, -1, false, 1 / 60);
    const [left, top, width, height] = ui.bounds(Buffer.from("volume-rail"))!;
    const at = (f: number): [number, number] => [left! + width! * f, top! + height! / 2];
    const [ax, ay] = at(drag[0]!);
    const [bx, by] = at(drag[1]!);
    frame(ax, ay, false, 1 / 60);
    frame(ax, ay, true, 1 / 60);
    frame(bx, by, true, 1 / 60);
    frame(bx, by, true, 1 / 60);
  } else {
    // as host.c: a scripted click is frames 0 to 2 at the point, pressed in frame 1, and frame 3 is written
    for (let n = 0; n < (click ? 4 : 1); n++) frame(click?.[0] ?? -1, click?.[1] ?? -1, n === 1, 1 / 60);
  }
  // the wheel: Clay scrolls the container under the pointer, so the pointer goes onto the viewport for a frame first
  if (wheel) {
    const [left, top, width, height] = ui.bounds(Buffer.from(wheelOver)) ?? [W / 2, H / 2, 0, 0];
    const [px, py] = [left + width / 2, top + height / 2];
    frame(px, py, false, 1 / 60);
    for (let n = 0; n < wheel; n++) {
      ui.wheel(0, -1); // one notch down
      frame(px, py, false, 1 / 60);
    }
  }
  for (const key of keys ?? []) {
    // `text:Ada` is typed text, not a key: the same call SDL's TEXT_INPUT events make in the window
    if (key.startsWith("text:")) input.textInput(key.slice(5));
    else {
      const name = key === "Space" ? " " : key;
      input.down(name);
      input.up(name);
    }
    frame(-1, -1, false, 1 / 60);
  }
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
const pointer = new Float32Array([-1, -1, 0, 0, 0]);
const event = new Int32Array(4);
const typed = new Uint8Array(256);
let got = 0;
const clip = new Uint8Array(4096);
const decoder = new TextDecoder();
// SDL's text input runs only while a text field has focus; these are the chords it takes (Cmd or Ctrl + C/X/V)
const CHORD = { 99: "copy", 120: "cut", 118: "paste" } as const;
const CTRL_GUI = 0x40 | 0x80 | 0x400 | 0x800;
let textOn = false;
let last = performance.now();
for (let n = 0; n < maxFrames; n++) {
  ui.windowPoll(pointer);
  if (pointer[3]) break;
  while ((got = ui.textPop(typed)) > 0) input.textInput(decoder.decode(typed.subarray(0, got)));
  while (ui.keyPop(event)) {
    const [down, code, mod, repeat] = [event[0] !== 0, event[1]!, event[2]!, event[3] !== 0];
    const chord = down && mod & CTRL_GUI ? CHORD[code as keyof typeof CHORD] : undefined;
    if (chord !== undefined) {
      const out = input.clipboard(chord, chord === "paste" ? decoder.decode(clip.subarray(0, ui.clipboardGet(clip))) : "");
      if (out != null) ui.clipboardSet(out);
      continue;
    }
    const name = selectionName(code, mod);
    if (name) (down ? input.down(name, repeat) : input.up(name));
  }
  // SDL starts and stops the platform's text input with the field's focus (an IME needs it; so does TEXT_INPUT)
  if (input.editing() !== textOn) ui.setTextInput((textOn = input.editing()));
  const now = performance.now();
  frame(pointer[0]!, pointer[1]!, pointer[2] !== 0, (now - last) / 1000);
  last = now;
  ui.windowPresent();
  await Bun.sleep(16);
}
dispose();
process.exit(0);
