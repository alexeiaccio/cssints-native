// The Solid Widgets page's own frame at the three states examples/widgets/gen.c dumps, as the reference the generated C
// is compared with (dump-check.ts): the page through the host's own loop — `ui_init`, the font, the page's `input`, its
// `motion` (the first-mount entry) and `drag`, 31 frames at rest and one frame an input, exactly
// `main.ts widgets --warm 30 --keys …` — and `ui_dump_json`'s data, the emitter every golden in solid/goldens is stored
// with.
//
//   bun examples/widgets/solid-dump.ts <out dir>     solid-rest.json, solid-switch.json, solid-disclosure.json
//
// The keys are the stored frames' own (`solid/test.sh`): `widgets-initial` is the page at rest, `widgets-switch-on` is
// Tab, Tab, Space (the switch focused and on) and `widgets-disclosure` is that plus four Tabs to Details and Enter (its
// panel open). examples/widgets/states.json is the same three states as the parts' own props: a press on the row (its
// onPress, the focus manager) and a click (its part's `press`, the signal) — a frame is a state, not a key.
import "../../solid/plugin.ts";

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.argv[2] ?? ".");
mkdirSync(out, { recursive: true });

const { ui } = await import("../../solid/src/ffi.ts");
const { createFrame } = await import("../../solid/src/frame.ts");
const { createInput } = await import("../../solid/src/input.ts");
const { El, render } = await import("../../solid/src/renderer.ts");
const { dumpPage, format } = await import("../../solid/src/dump.ts");
const { Widgets, size } = await import("../../solid/app/Widgets.tsx");

const WARM = 31; // `main.ts widgets --warm 30`: 30 rest frames and the one the frame is written on

const font = new URL("../../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname;
if (ui.init(size.width, size.height) || ui.font(font) < 0) throw new Error("ui_init or ui_font failed (thorvg? build/solid)");

interface Page {
  readonly root: InstanceType<typeof El>;
  readonly dispose: () => void;
  step(): void;
  /** A key down and up, and the frame after it, as `main.ts --keys` gives it (`Space` is DOM's " "). */
  tap(name: string): void;
}

/** One state as the page's loop makes it: a fresh page, 31 rest frames, then the state's keys one frame each. */
function capture(keys: readonly string[]): Page {
  const input = createInput();
  const motion = {};
  const drag: { onPointer?: (x: number, y: number, down: boolean) => void } = {};
  const root = new El("root");
  const dispose = render(() => Widgets({ input, motion, drag }), root);
  const frame = createFrame(root, {
    onPointer: (x, y, down) => drag.onPointer?.(x, y, down),
    onPressMiss: () => input.pressMiss(),
    tick: (dt) => motion.tick?.(dt),
  });
  const page: Page = {
    root,
    dispose,
    step: () => frame(-1, -1, false, 1 / 60, false),
    tap(name) {
      input.down(name === "Space" ? " " : name);
      input.up(name === "Space" ? " " : name);
      page.step();
    },
  };
  for (let n = 0; n < WARM; n++) page.step();
  for (const key of keys) page.tap(key);
  return page;
}

function write(name: string, keys: readonly string[]): void {
  const page = capture(keys);
  const dump = dumpPage(page.root);
  writeFileSync(`${out}/solid-${name}.json`, `${format(dump)}\n`);
  console.log(`solid-${name}: ${dump.commands.length} commands`);
  page.dispose();
}

const TABS = ["Tab", "Tab", "Tab", "Tab"];
// the page at rest (widgets-initial)
write("rest", []);
// the switch focused and on (widgets-switch-on): Tab to it, Space
write("switch", ["Tab", "Tab", "Space"]);
// the disclosure's panel open (widgets-disclosure): the switch on, four Tabs to Details, Enter
write("disclosure", ["Tab", "Tab", "Space", ...TABS, "Enter"]);
if (ui.errors()) throw new Error(`${ui.errors()} Clay errors`);
