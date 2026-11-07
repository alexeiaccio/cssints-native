// A page's last frame as JSON: the command-stream golden of Rune's item 5. It renders a page exactly as `main.ts`'s
// headless path does for its stored pixel frame — Bun's plugin (JSX, then cssints), the page's own size, its input and
// its motion hook — runs it to rest, and dumps the frame (`src/dump.ts`: `ui_dump_json` and the a11y snapshot).
//
//   bun solid/dump.ts sensors                     # the JSON to stdout, the counts to stderr
//   bun solid/dump.ts sky --out /tmp/sky.json     # ... or to a file
//   bun solid/dump.ts widgets --update            # re-store solid/goldens/widgets.json
//   bun solid/dump.ts figure --spec solid/specs/palette.json --commands --out solid/goldens/figure-palette.json
//
// `solid/dump.test.ts` compares every stored golden field by field (and says which command and which field a miss is).
// Only `./plugin.ts` is imported statically: a static import is resolved before the plugin registers, and Bun would then
// load solid-js's server build, where signals never update (the reason `main.ts` is shaped the same way).
import "./plugin.ts";

import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Drag } from "./app/Widgets.tsx";
import type { Loader } from "./app/Sky.tsx";
import type { A11yNode } from "./a11y.ts";
import type { Motion } from "./src/entry.ts";
import type { Input } from "./src/input.ts";
import type { El } from "./src/renderer.ts";
import type { PageDump } from "./src/dump.ts";
import { sizeOf } from "./src/figure/kinds.ts";
import { parse, type Spec } from "./src/figure/spec.ts";

/** One page of the table: its layout's size, the frames it runs to rest, and the keys it takes before them. */
interface Page {
  width: number;
  height: number;
  /** Frames at rest (a mount animation has to be over before the frame is dumped). */
  warm: number;
  /** Scripted keys, a frame after each, as `main.ts --keys` takes them. */
  keys?: readonly string[];
  /** Frames at rest after the keys, for a page whose motion has to be caught on the way (`main.ts --settle`). */
  settle?: number;
  /** The Figure page's spec, a file in solid/specs: its layout is the page's size. */
  figure?: string;
}

/** The pages a golden covers, with the frames at rest their stored pixel frame is taken at: `--warm 30` is 30 rest
 *  frames and the one the frame is written on (31) on the plain pages; the Sky's `--settle 40` is one and forty. The
 *  Dialog is its menu two frames after it opens (`--keys Tab,Tab,Enter --settle 2`, the `dialog-menu-mid` frame): the
 *  one frame that has every table beside the commands — a group mid-fade and mid-lean, a shadow mid-blur, the menu's
 *  glass and its floats. Their sizes are the pages' own (`size` in each app). */
export const PAGES = {
  sensors: { width: 360, height: 360, warm: 31 },
  widgets: { width: 360, height: 760, warm: 31 },
  list: { width: 360, height: 400, warm: 31 },
  sky: { width: 360, height: 760, warm: 41 },
  dialog: { width: 360, height: 480, warm: 1, keys: ["Tab", "Tab", "Enter"], settle: 2 },
  // the text sheet is static: one frame is the page (and the oracle's rows at their own boxes)
  sheet: { width: 440, height: 564, warm: 1 },
  // the figure's size is its layout's (the spec's cells times the cell), so these are placeholders `capture` replaces
  figure: { width: 0, height: 0, warm: 1, figure: "bars.json" },} satisfies Record<string, Page>;

export type PageName = keyof typeof PAGES;

/** The pages, imported once per process (the plugin compiles them on the way in). */
const apps: Record<string, unknown> = {};
const EXPORT = {
  sensors: "Sensors",
  widgets: "Widgets",
  list: "List",
  sky: "Sky",
  dialog: "Dialog",
  sheet: "Sheet",
  figure: "Figure",
} as const;
async function app(name: PageName): Promise<unknown> {
  if (!apps.Sensors) {
    const [sensors, widgets, list, sky, dialog, sheet, figure] = await Promise.all([
      import("./app/Sensors.tsx"),
      import("./app/Widgets.tsx"),
      import("./app/List.tsx"),
      import("./app/Sky.tsx"),
      import("./app/Dialog.tsx"),
      import("./app/Sheet.tsx"),
      import("./app/Figure.tsx"),
    ]);
    apps.Sensors = sensors.Sensors;
    apps.Widgets = widgets.Widgets;
    apps.List = list.List;
    apps.Sky = sky.Sky;
    apps.Dialog = dialog.Dialog;
    apps.Sheet = sheet.Sheet;
    apps.Figure = figure.Figure;
  }
  return apps[EXPORT[name]];
}

// what a second capture in one process needs: ui_init again is a fresh Clay arena and a fresh canvas; the font and the
// engine are the process's, so they are loaded once
let started = false;

type Hooks = { input: Input; motion: Motion; drag: Drag; theme?: string; load?: Loader };

/** A run other than a page's stored one: the same page taken to rest somewhere else (the state a static C page is). */
export interface Rest {
  readonly warm?: number;
  readonly keys?: readonly string[];
  readonly settle?: number;
  /** A page's own size, when it is not its stored one: a responsive pair captures one page at two widths. */
  readonly width?: number;
  readonly height?: number;
  /** The Figure page's spec, when it is not the stored one (`PAGES.figure` reads bars.json). */
  readonly spec?: Spec;
  /** A press and a release on this element's centre, after the warm frames, as `main.ts --click`: four frames, the second
   *  pressed. What opens the Sky page's thread on a capture. */
  readonly clickOn?: string;
  /** A page's loader (the Sky page's `load`): a screen already at hand answers on the frame it is asked, so a capture
   *  never waits for a promise and never makes a request. */
  readonly load?: Loader;
}

/** A spec file of solid/specs, checked: a figure whose spec is refused cannot be captured. */
function readSpec(name: string): Spec {
  const { spec, problems } = parse(readFileSync(new URL(`./specs/${name}`, import.meta.url), "utf8"), {
    dir: new URL("./specs/", import.meta.url).pathname,
  });
  if (!spec) throw new Error(`solid/specs/${name}: ${problems.join(" ")}`);
  return spec;
}

/** A spec file by path, for `--spec` (a golden of one of the figure's other specs): refused with its sentences. */
function readSpecFile(path: string | undefined): Spec {
  if (!path) throw new Error("--spec needs a file: solid/specs/palette.json");
  const { spec, problems } = parse(readFileSync(path, "utf8"), { dir: dirname(path) });
  if (!spec) throw new Error(`${path}: ${problems.join(" ")}`);
  return spec;
}

/**
 * Renders one page headless and returns its last frame as data. The page is the same component, size and state as its
 * stored pixel frame; only the raster is skipped (`main.ts` draws when the hash moves, this never draws), which changes
 * no command, no table and no box.
 */
export async function capture(name: PageName, theme?: string, rest: Rest = {}): Promise<PageDump> {
  const component = await app(name);
  const { ui } = await import("./src/ffi.ts");
  const { createFrame } = await import("./src/frame.ts");
  const { createInput } = await import("./src/input.ts");
  const { El, render } = await import("./src/renderer.ts");
  const { dumpPage } = await import("./src/dump.ts");
  const stored = PAGES[name] as Page;
  const { warm, keys, settle = 0 } = { ...stored, ...rest };
  // the Figure page's size is its spec's layout, not a number in the table: the placeholder is replaced here so a caller
  // may pass another spec (figure.test.ts does, for all four)
  const spec = rest.spec ?? (stored.figure ? readSpec(stored.figure) : undefined);
  const size = spec ? sizeOf(spec) : { width: rest.width ?? stored.width, height: rest.height ?? stored.height };
  const { width, height } = size;
  if (!started) {
    const font = new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname;
    if (ui.init(width, height) || ui.font(font) < 0) throw new Error("ui_init or ui_font failed (thorvg? build/solid)");
    started = true;
  } else if (ui.init(width, height)) throw new Error(`ui_init(${width}, ${height}) failed`);

  // the same `View` hooks `main.ts` wires: the pages' tick (their entry and their tracks), the pointer and the wheel
  const hooks: Hooks = { input: createInput(), motion: {}, drag: {}, load: rest.load };
  const root = new El("root");
  const page = pageOf(component, hooks, spec);
  const dispose = render(page, root);
  const frame = createFrame(root, {
    get theme() {
      return theme;
    },
    onPointer: (x, y, down, touch) => {
      hooks.drag.onPointer?.(x, y, down);
      hooks.motion.onPointer?.(x, y, down, touch);
    },
    onPressMiss: () => hooks.input.pressMiss(),
    onWheel: (dx, dy) => hooks.motion.onWheel?.(dx, dy),
    tick: (dt) => hooks.motion.tick?.(dt),
  });
  for (let n = 0; n < warm; n++) frame(-1, -1, false, 1 / 60, false);
  // a press and a release on an element's centre: the four frames `main.ts --click` runs, the second one pressed
  if (rest.clickOn !== undefined) {
    const at = ui.bounds(Buffer.from(rest.clickOn));
    if (at === undefined) throw new Error(`${name}: no element ${rest.clickOn} for clickOn`);
    const x = at[0]! + at[2]! / 2;
    const y = at[1]! + at[3]! / 2;
    for (let n = 0; n < 4; n++) frame(x, y, n === 1, 1 / 60, false);
  }
  // a scripted key is a frame of its own, as `main.ts --keys` gives it: down and up, then the frame that follows
  for (const key of keys ?? []) hooks.input.down(key), hooks.input.up(key), frame(-1, -1, false, 1 / 60, false);
  for (let n = 0; n < settle; n++) frame(-1, -1, false, 1 / 60, false);
  const dump = dumpPage(root);
  if (ui.errors()) throw new Error(`${name}: ${ui.errors()} Clay errors`);
  dispose();
  return dump;
}

/** A page as a tree, as `main.ts` builds it: every page takes a subset of these props and ignores the rest, and the
 *  Sky's theme is a getter because the page reads it each frame. The Figure page takes `spec`. */
function pageOf(module: unknown, hooks: Hooks, spec?: Spec): () => El {
  const component = module as (props: object) => El;
  return () =>
    component({
      input: hooks.input,
      motion: hooks.motion,
      drag: hooks.drag,
      theme: () => hooks.theme,
      spec,
      load: hooks.load,
    });
}

/** The nodes of a snapshot, the document not counted (the count a page's line prints). */
export function nodes(node: A11yNode): number {
  let n = 0;
  for (const child of node.children) n += 1 + nodes(child);
  return n;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--out");
  const specAt = argv.indexOf("--spec");
  const name = argv.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1) && (specAt < 0 || i !== specAt + 1)) as PageName | undefined;
  if (name === undefined || !(name in PAGES)) {
    console.error(`usage: bun solid/dump.ts <${Object.keys(PAGES).join("|")}> [--out path] [--update] [--spec file]`);
    process.exit(1);
  }
  const spec = specAt >= 0 ? readSpecFile(argv[specAt + 1]) : undefined;
  const { format } = await import("./src/dump.ts");
  const dump = await capture(name, undefined, spec ? { spec } : {});
  const counts = `${name}: ${dump.commands.length} commands, ${nodes(dump.a11y)} a11y nodes`;
  const out = at >= 0 ? argv[at + 1] : argv.includes("--update") ? goldens(name) : undefined;
  // `--commands` writes the figure's own golden shape: its commands and its renderer tables, without the a11y snapshot
  const text = `${format(argv.includes("--commands") ? { commands: dump.commands, effects: dump.effects } : dump)}\n`;
  if (out === undefined) process.stdout.write(text);
  else writeFileSync(out, text);
  console.error(out === undefined ? counts : `${counts} -> ${out}`);
  process.exit(0);
}

/** The stored golden a page's `--update` rewrites. */
function goldens(name: PageName): string {
  return new URL(`./goldens/${name}.json`, import.meta.url).pathname;
}
