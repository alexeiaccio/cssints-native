// The Solid host, the counterpart of desktop/host.c. Run with Bun:
//
//   bun solid/main.ts [sensors|widgets|dialog|form|list|sky|notify|sheet]  a window; the mouse or a finger is the pointer
//                                        (one pointer: SDL's touch events go through the same state), `t` flips the
//                                        theme; on widgets Tab, Shift+Tab, Space and Enter drive the widgets; on dialog
//                                        Enter opens the settings dialog and Space opens the menu; on form Tab reaches the
//                                        text field, typing fills it, Enter submits, Escape blurs (and `t` flips the
//                                        theme again once no field has focus); on list Tab reaches the list, Up/Down,
//                                        PageUp/PageDown and Home/End move the selection and the wheel scrolls it; on
//                                        sky Tab reaches the tablist then the feed, the arrows switch feeds, `n` opens
//                                        the notifications (Escape back), and on the feed Up/Down, PageUp/PageDown and
//                                        Home/End scroll it; notify is that page started on its notifications screen
//   bun solid/main.ts figure --spec solid/specs/bars.json   the Figure page: one glyph-kit spec (solid/specs/*.json),
//                                        declared as Clay boxes and texts — a bar's fill is a box whose width is its value.
//                                        An invalid spec fails with its sentences before a frame (exit 1)
//   bun solid/main.ts --png out.png      one frame headless, written to out.png
//   bun solid/main.ts --expect ref.png   the same frame compared with ref.png pixel for pixel; exit 1 and write
//                                        ref.png.actual.png on a difference
//   --click X Y                          headless: a press and a release at X,Y before the frame that is written
//                                        (frame 0 lays out, pressed in 1, released in 2, frame 3 is written)
//   --click2 X Y                         headless: a second press and release, after the wheel, the keys and the settle, for a
//                                        row that only shows once a page has scrolled (the Sky thread's "Show N more replies")
//   --settle2 N                          headless, with --click2: N more frames at rest after it, for the motion it starts
//   --touch FX FY                        headless: the same click as a finger's, at the window's normalised FX,FY
//                                        (0..1, so 0.5,0.5 is its middle): the point goes through ui_touch_map, the same
//                                        mapping the window poll gives SDL's finger events, and the frames carry the
//                                        touch flag a page reads (a touch drag starts at once; a tap still clicks)
//   --move X Y [N]                       headless, after --keys and --settle: the pointer to X,Y, N frames (default 3),
//                                        and no press — a hover a frame or two into its fade, at a page that is at rest
//   --warm N                             headless: N frames at rest before the click and the wheel, for a page whose
//                                        mount animation (the Sky cards arriving, the four plain pages' entry) has to be
//                                        over first: 30 frames is past both
//   --drag-feed X,Y,DY,DY,...            headless, after --warm: a pointer drag on the Sky feed: a press at X,Y, then
//                                        one frame a pointer moved by that many px in y (the button held), then the
//                                        release at the last point; --settle runs the fling after it
//   --keys Tab,Tab,Space                 headless: a frame, then each key pressed and released with a frame after it
//                                        (names as the focus manager and the parts take them: Shift+Tab, Enter, ArrowLeft,
//                                        Space for " "); the last frame is written. A step `text:Ada` is typed text
//                                        (`Input.textInput`), not a key: --keys Tab,text:Ada,Shift+ArrowLeft
//   --wheel N                            headless, before --keys: the pointer onto the element `--wheel-over` names (the
//                                        list's viewport by default), then N wheel notches down, a frame each (one
//                                        notch is 10px; a run of notches a frame apart is a flick and flings)
//   --wheel-x N                          headless, with --wheel: the same notches along the horizontal axis instead (N to
//                                        the right: the wide List's rows)
//   --wheel-over ID                      the element the wheel's pointer goes onto (default "list")
//   --wheel-rest                         headless, with --wheel: a frame of rest between notches, so a long run is the
//                                        notches' own 10px each (the List's stored frames)
//   --settle N                           headless: N more frames at 1/60 after the wheel and the keys, for a page whose
//                                        motion has to come to rest (the Sky feed's spring and fling, the Dialog's menu
//                                        slide and panel drop)
//   --idle N                             headless, after everything else: N frames with no input, printing how many of
//                                        them drew (a page at rest draws none: "idle: draws 0 of 60")
//   --idle-keys K                        headless with --idle: a Tab pressed every K idle frames, which must draw
//   --bench N                            headless: N more frames, the ms a frame by phase
//   --count N                            the List's rows (default 30): 1,000 is the window's own test page
//   --wide                               the List's wide layout: 900px rows in the same 280px viewport, a horizontal bar,
//                                        and a second column past the viewport's edge (the horizontal axis of the scroll
//                                        machine: --wheel-x scrolls it, and a shift+vertical wheel in the window does too).
//                                        On the Sky page it is the page's own wide form: 720x760, where a card's thread opens
//                                        as a 360px column beside the feed instead of a float over it (the page reads the
//                                        window's width, so the flag only sizes the window)
//   --posts N                            the Sky's Discover feed: N synthetic posts instead of its three fixtures
//   --story ID                           the storybook page: the story to open (default the first), `widgets--switch`
//   --arg NAME=VALUE                     the storybook page: an arg of the opened story as a control writes it, applied at
//                                        boot and typed by the story's control (`--arg on=true` a boolean, `--arg volume=70` a
//                                        number, `--arg speed=16x` an option). Repeatable: --arg on=true --arg label=Wi-Fi
//   --density N                          the raster's pixel density (the window's, 2 on a Retina screen): the same layout
//                                        in N times the pixels; the frame written is that much larger (default 1)
//   --raster thorvg|thorvg-gpu           the ThorVG software canvas (the default) or its WebGPU canvas, the frame read
//                                        back; the latter needs a libui.dylib from desktop/build-thorvg-gpu.sh solid
//   --frames N                           window: close after N frames (a smoke test)
//   --reduced-motion                     no travel and no waiting: a retarget lands on its target at once and a node
//                                        that leaves unmounts on the frame it closes (also REDUCED_MOTION=1)
//   THEME=light                          the light theme
import "./plugin.ts";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Motion } from "./src/entry.ts";
import type { Drag } from "./app/Widgets.tsx";

const page = process.argv[2]?.startsWith("--") ? "sensors" : (process.argv[2] ?? "sensors");
if (
  page !== "sensors" &&
  page !== "widgets" &&
  page !== "dialog" &&
  page !== "form" &&
  page !== "list" &&
  page !== "sheet" &&
  page !== "figure" &&
  page !== "storybook" &&
  page !== "dev"
) {
  console.error(`unknown page "${page}": sensors, widgets, dialog, form, list, sky, notify, sheet, figure or dev`);
  process.exit(1);
}
const arg = (name: string, n = 1) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv.slice(i + 1, i + 1 + n);
};
const png = arg("--png")?.[0];
const expect = arg("--expect")?.[0];
// headless: a scene, `solid/scenes/*.json` — a typed event log with times that names its own page, size, theme and
// reduced-motion flag (`solid/src/scene.ts`; the format and the steps are in native/README.md). It runs the same headless
// loop the flags above run, so `--png`/`--expect` give it a frame, and it exits before any of the page's setup below.
const sceneFile = arg("--scene")?.[0];
if (sceneFile) {
  const { runSceneFile } = await import("./src/scene.ts");
  process.exit(await runSceneFile(sceneFile, { png, expect }));
}
const click = arg("--click", 2)?.map(Number);
// headless: a second click, after the wheel, the keys and the settle — and the frames at rest after it
const click2 = arg("--click2", 2)?.map(Number);
// headless: a finger's click, at a point normalised to the window (ui_touch_map turns it into the pointer's pixels)
const touch = arg("--touch", 2)?.map(Number);
// headless: a hover: the pointer to X,Y after the settle, N frames there (no press)
const move = arg("--move", 3)?.map(Number);
// headless: frames at rest before the input, so a page's mount animation is over (the Sky cards' entry)
const warm = Number(arg("--warm")?.[0] ?? 0);
// headless: a drag on the widgets slider: two fractions of the rail (press at the first, held, then move to the second)
const drag = arg("--drag", 2)?.map(Number);
// headless: a drag on the Sky feed: the press point, then a dy a frame, then the release at the last point
const dragFeed = arg("--drag-feed")?.[0]?.split(",").map(Number);
const keys = arg("--keys")?.[0]?.split(",");
// headless: wheel notches down over the element --wheel-over names, a frame each
const wheel = Number(arg("--wheel")?.[0] ?? 0);
// headless: the same notches along the horizontal axis (positive is to the right, the wide List's rows)
const wheelX = Number(arg("--wheel-x")?.[0] ?? 0);
const wheelOver = arg("--wheel-over")?.[0] ?? "list";
// headless: a frame of rest between wheel notches, so a long scripted run is the notches' own 10px each and not a flick
const wheelRest = process.argv.includes("--wheel-rest");
const settle = Number(arg("--settle")?.[0] ?? 0);
const settle2 = Number(arg("--settle2")?.[0] ?? 0);
const bench = Number(arg("--bench")?.[0] ?? 0);
// the pages' data: the List's rows, and a synthetic Discover feed for the Sky (the window's own test pages)
const count = Number(arg("--count")?.[0] ?? 30);
const posts = Number(arg("--posts")?.[0] ?? 0);
// headless: the List's wide layout (900px rows in the same 280px viewport, a horizontal bar and a second column)
const wide = process.argv.includes("--wide");
// headless: frames with no input after everything else, and how many of them drew (all of them only for the keys)
const idle = Number(arg("--idle")?.[0] ?? 0);
const idleKeys = Number(arg("--idle-keys")?.[0] ?? 0);
// the raster: ThorVG's software canvas (the default) or its WebGPU one, when the dylib was built for it
const gpu = arg("--raster")?.[0] === "thorvg-gpu";
const maxFrames = Number(arg("--frames")?.[0] ?? Infinity);
// the raster's pixel density: headless is 1, a Retina window is 2
const density = Number(arg("--density")?.[0] ?? 1);
// reduced motion is the platform's ask, not a page's: one flag, read here and by the window alike
const reducedMotion = process.argv.includes("--reduced-motion") || process.env.REDUCED_MOTION === "1";
// the storybook's args: `--arg name=value`, repeatable, typed by the story's own controls in app/Storybook.tsx
const storyArgs: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== "--arg") continue;
  const [name, ...rest] = (process.argv[i + 1] ?? "").split("=");
  if (name !== undefined && name !== "" && rest.length > 0) storyArgs[name] = rest.join("=");
}
let theme = process.env.THEME === "light" ? "light" : undefined;
// the Figure page's spec: a file, read and checked before the window or a frame — an invalid one exits with every
// sentence it has, so a figure is never drawn from data the kit's own rules refuse
const specPath = arg("--spec")?.[0];
let figureSpec: import("./src/figure/spec.ts").Spec | undefined;
if (page === "figure") {
  if (!specPath) {
    console.error("figure: --spec <file.json> (solid/specs/bars.json, funnel.json, compare.json, pipeline.json)");
    process.exit(2);
  }
  const { parse } = await import("./src/figure/spec.ts");
  const { spec, problems } = parse(readFileSync(specPath, "utf8"), { dir: dirname(specPath) });
  if (!spec) {
    for (const problem of problems) console.error(`figure: ${problem}`);
    process.exit(1);
  }
  figureSpec = spec;
}

const { ui } = await import("./src/ffi.ts");
const { createFrame, createDrawer } = await import("./src/frame.ts");
const { createInput, selectionName } = await import("./src/input.ts");
const { El, render } = await import("./src/renderer.ts");
const { setReducedMotion } = await import("./src/motion.ts");
if (reducedMotion) setReducedMotion(true);
const { Sensors } = await import("./app/Sensors.tsx");
const { Widgets, size } = await import("./app/Widgets.tsx");
const { Dialog, size: dialogSize } = await import("./app/Dialog.tsx");
const { Field, size: fieldSize } = await import("./app/Field.tsx");
const { List, size: listSize } = await import("./app/List.tsx");
const { Sheet, size: sheetSize } = await import("./app/Sheet.tsx");
const { Figure, size: figureSize } = await import("./app/Figure.tsx");
const { Dev, size: devSize, stats: devStats } = await import("./app/Dev.tsx");
// the storybook is imported only for its own page: it pulls the story files and @cssints/stories, and every other page
// must not compile them (two token sets of one namespace stop the build, and a watcher of `widgets` would rebuild them)
const storybook = page === "storybook" ? await import("./app/Storybook.tsx") : undefined;

// the sheet is the one page wider than 360: the oracle draws a page, not a window group. The Figure page's size is its
// layout's, from the spec: cells times the cell, and the padding
const W =
  page === "sheet"
    ? sheetSize.width
    : page === "figure"
      ? figureSize(figureSpec!).width
      : page === "dev"
        ? devSize.width
        : page === "storybook"
          ? (storybook?.size.width ?? 720)
          : 360;
const H =
  page === "widgets"
    ? size.height
    : page === "dialog"
      ? dialogSize.height
      : page === "form"
        ? fieldSize.height
        : page === "list"
          ? listSize.height
          : page === "sheet"
              ? sheetSize.height
              : page === "figure"
                ? figureSize(figureSpec!).height
                : page === "dev"
                  ? devSize.height
                  : page === "storybook"
                    ? (storybook?.size.height ?? 560)
                    : 360;

if (
  (gpu ? ui.initGpu(W, H) : ui.init(W, H)) ||
  (density !== 1 && !ui.density(density)) ||
  ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname) < 0
) {
  console.error("ui_init or ui_font failed (is thorvg installed, and build/solid/libui.dylib built?)");
  process.exit(1);
}
const root = new El("root");
const input = createInput();
// `t` is the page's shortcut only while no text field has focus: a letter typed into one is a character, not a key
input.fallback = (name) => (name === "t" && !input.editing() ? ((theme = theme ? undefined : "light"), true) : false);
const dragState: Drag = {};
// the page's frame hook: the pages put their wheel handler and their tick on it, the host calls them
const motion: Motion = {};
const dispose = render(
  page === "widgets"
    ? () => Widgets({ input, drag: dragState, motion })
    : page === "dialog"
      ? () => Dialog({ input, motion })
      : page === "form"
        ? () => Field({ input, motion })
        : page === "list"
          ? () => List({ input, motion, count, wide })
          : page === "sheet"
              ? () => Sheet()
              : page === "figure"
                ? () => Figure({ spec: figureSpec!, motion })
                : page === "storybook"
                  ? () =>
                      storybook!.Storybook({
                        input,
                        motion,
                        start: arg("--story")?.[0],
                        args: storyArgs,
                      })
                  : page === "dev"
                  ? () => Dev({ input, motion, drag: dragState, theme: () => theme, tune: arg("--tune")?.[0] })
                  : () => Sensors({ motion }),
  root,
);
// the dev page's panel reads the frames' phases (solid/app/Dev.tsx): its own array, so what the panel prints is what the
// frame pushed
const stats: [number, number, number, number][] = page === "dev" ? devStats : [];
const frame = createFrame(root, {
  get theme() {
    return theme;
  },
  // the pointer goes to both hooks: the Widgets slider's drag and the page's own (the Sky feed, the List's viewport)
  onPointer: (x, y, down, touch) => {
    dragState.onPointer?.(x, y, down);
    motion.onPointer?.(x, y, down, touch);
  },
  onPressMiss: () => input.pressMiss(),
  onWheel: (dx, dy) => motion.onWheel?.(dx, dy),
  tick: (dt) => motion.tick?.(dt),
  stats,
});
// the loop's decision: the frame is declared and laid out every iteration, but drawn only when its hash changed or a
// discrete input came in (keys, text, a press or release, the wheel); a pointer move draws through the hash only
const draw = createDrawer(frame, stats);
// the wheel the host took since the last frame goes to the page before the frame is declared; a page that keeps Clay's
// own scrolling (the List) has no onWheel, so this is only a drain
const wheelOut = new Float32Array(2);
const pumpWheel = () => {
  let had = false;
  while (ui.wheelPop(wheelOut)) had = true, motion.onWheel?.(wheelOut[0]!, wheelOut[1]!);
  return had;
};

const headless = png || expect || idle > 0 || touch !== undefined;
if (headless) {
  // every headless frame is the loop's: declared and laid out, drawn only when the hash changed or the input was a
  // discrete one. The buffer keeps the last drawn pixels, so a skipped frame is the frame it would have drawn.
  const step = (x: number, y: number, down: boolean, input = false, touch = false) =>
    draw(x, y, down, 1 / 60, input, touch);
  // where the last frame left the pointer: a settle frame keeps it there, so a hover is the frame's, not the settle's
  let settleAt: [number, number] = [-1, -1];
  // frames at rest before any input, for a page whose mount animation has to be over (the Sky cards' entry)
  for (let n = 0; n < warm; n++) step(-1, -1, false);
  if (drag) {
    // a drag on the widgets slider: frame 0 lays out, 1 puts the pointer on the rail, 2 presses at the first fraction,
    // then the pointer moves to the second with the button held and the last frame (still held) is written
    step(-1, -1, false);
    const [left, top, width, height] = ui.bounds(Buffer.from("volume-rail"))!;
    const at = (f: number): [number, number] => [left! + width! * f, top! + height! / 2];
    const [ax, ay] = at(drag[0]!);
    const [bx, by] = at(drag[1]!);
    step(ax, ay, false);
    step(ax, ay, true, true);
    step(bx, by, true);
    step(bx, by, true);
  } else {
    // as host.c: a scripted click is frames 0 to 2 at the point, pressed in frame 1, and frame 3 is written. A finger's
    // click (`--touch`) is the same script at the point ui_touch_map gives for the normalised one, its frames marked as
    // a finger's: the mapping and the flag are the window's path, exercised without a touchscreen.
    const finger = touch ? ui.touchMap(touch[0]!, touch[1]!) : undefined;
    const [cx, cy] = finger ? [finger[0]!, finger[1]!] : [click?.[0] ?? -1, click?.[1] ?? -1];
    const pressed = click !== undefined || finger !== undefined;
    for (let n = 0; n < (pressed ? 4 : 1); n++)
      step(cx, cy, n === 1, n === 1 || n === 2, finger !== undefined);
    if (pressed) settleAt = [cx, cy];
  }
  if (dragFeed) {
    // a pointer drag on the Sky feed: frame 0 lays out, 1 puts the pointer at the press point, 2 presses, then a frame a
    // dy with the button held, and the release at the last point (the --settle frames after it are the fling's)
    const [x, top, ...dys] = dragFeed;
    let y = top!;
    step(x!, y, false);
    step(x!, y, true, true);
    for (const dy of dys) step(x!, (y += dy), true);
    step(x!, y, false, true);
    settleAt = [x!, y];
  }
  // the wheel: a page's own track gets the delta before the frame; Clay scrolls the container under the pointer only for a
  // page that keeps Clay's scrolling, so the pointer goes onto the viewport for a frame first. `--wheel-rest` puts a frame
  // of rest between notches: a run of notches 60Hz apart is a flick and flings (the Sky feed's and the List's), and a rest
  // frame keeps a scripted run at its notches' own 10px each — the List's stored frames are that run
  if (wheel || wheelX) {
    const [left, top, width, height] = ui.bounds(Buffer.from(wheelOver)) ?? [W / 2, H / 2, 0, 0];
    const [px, py] = [left + width / 2, top + height / 2];
    step(px, py, false);
    // a notch down is (0, -1); a notch to the right is (-1, 0), the same sign rule: the machine's offset is positive down or
    // right, and SDL's delta is positive away from the user or to the right
    const n = wheel || wheelX;
    for (let i = 0; i < n; i++) {
      if (wheel) ui.wheel(0, -1);
      else ui.wheel(-1, 0);
      pumpWheel();
      step(px, py, false, true);
      if (wheelRest) step(px, py, false);
    }
    settleAt = [px, py];
  }
  for (const key of keys ?? []) {
    // `text:Ada` is typed text, not a key: the same call SDL's TEXT_INPUT events make in the window
    if (key.startsWith("text:")) input.textInput(key.slice(5));
    else {
      const name = key === "Space" ? " " : key;
      input.down(name);
      input.up(name);
    }
    step(-1, -1, false, true);
  }
  // the motion at rest: a page with a track needs frames after the input, not one
  for (let n = 0; n < settle; n++) step(settleAt[0], settleAt[1], false);
  // a second click, now that a scroll has brought its row into view (the Sky thread's more row), then its own settle
  if (click2) {
    for (let n = 0; n < 4; n++) step(click2[0]!, click2[1]!, n === 1, n === 1 || n === 2);
    for (let n = 0; n < settle2; n++) step(click2[0]!, click2[1]!, false);
    settleAt = [click2[0]!, click2[1]!];
  }
  // a hover, at a page that is at rest: the pointer moves there and N frames run, no press (a mid-fade frame is what a
  // stored one is for; the last of the N is written)
  if (move) for (let n = 0; n < (move[2] ?? 3); n++) step(move[0]!, move[1]!, false);
  // the page at rest: frames with nothing in, and how many of them the hash made draw. A key every `--idle-keys` frames
  // is a discrete input and draws on its own frame.
  if (idle) {
    const before = ui.draws();
    const started = performance.now();
    let pressed = 0;
    for (let n = 0; n < idle; n++) {
      const key = idleKeys > 0 && (n + 1) % idleKeys === 0;
      if (key) pressed++, input.down("Tab"), input.up("Tab");
      step(settleAt[0], settleAt[1], false, key);
    }
    const drew = ui.draws() - before;
    const ms = performance.now() - started;
    console.log(
      `idle: draws ${drew} of ${idle}${pressed ? `, ${pressed} of them the keys` : ""} in ${ms.toFixed(1)} ms ` +
        `(${(ms / idle).toFixed(2)} ms a frame: poll, declare, lay out, hash)`,
    );
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
        if (flips) units?.props.onClick(); // the signal changes every frame: Solid updates texts, Clay measures
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
// the poll's out[6]: x, y, down, quit, the last key's character, and whether the last pointer event was a finger
const pointer = new Float32Array([-1, -1, 0, 0, 0, 0]);
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
// the button of the last iteration: a press or release is a discrete input, a pointer's move is not
let wasDown = false;
let drew = 0;
let frames = 0;
const start = performance.now();
for (let n = 0; n < maxFrames; n++) {
  ui.windowPoll(pointer);
  if (pointer[3]) break;
  const [x, y, down, finger] = [pointer[0]!, pointer[1]!, pointer[2] !== 0, pointer[5] !== 0];
  let wheeled = pumpWheel();
  let text = false;
  while ((got = ui.textPop(typed)) > 0) (text = true), input.textInput(decoder.decode(typed.subarray(0, got)));
  let key = false;
  while (ui.keyPop(event)) {
    const [isDown, code, mod, repeat] = [event[0] !== 0, event[1]!, event[2]!, event[3] !== 0];
    key = true;
    const chord = isDown && mod & CTRL_GUI ? CHORD[code as keyof typeof CHORD] : undefined;
    if (chord !== undefined) {
      const out = input.clipboard(chord, chord === "paste" ? decoder.decode(clip.subarray(0, ui.clipboardGet(clip))) : "");
      if (out != null) ui.clipboardSet(out);
      continue;
    }
    const name = selectionName(code, mod);
    if (name) (isDown ? input.down(name, repeat) : input.up(name));
  }
  // SDL starts and stops the platform's text input with the field's focus (an IME needs it; so does TEXT_INPUT)
  if (input.editing() !== textOn) ui.setTextInput((textOn = input.editing()));
  const now = performance.now();
  // declare and lay out every iteration (a page's tick reads and writes there, so a timer or a track animates); draw and
  // present only when the hash changed or a key, typed text, a wheel notch or the button came in. A pointer move goes
  // through the hash: it draws when it changes a hover, and not once the hover has settled.
  const drewNow = draw(x, y, down, (now - last) / 1000, wheeled || text || key || down !== wasDown, finger);
  last = now;
  wasDown = down;
  if (drewNow) {
    drew++;
    ui.windowPresent();
  } else await Bun.sleep(16); // nothing to show: one tick's rest, and no wait before the frame an input caused
  frames++;
}
if (maxFrames !== Infinity) {
  const ms = performance.now() - start;
  console.log(`window: ${frames} frames, ${drew} draw${drew === 1 ? "" : "s"}, ${ui.presents()} presents, ${ms.toFixed(0)} ms`);
}
dispose();
process.exit(0);
