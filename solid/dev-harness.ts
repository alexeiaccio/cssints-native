// The dev page as the window runs it, for the panel's tests (`dev.test.ts` and `tune.test.ts`): a fresh Dev, the host's
// frame over the panel's `stats`, and one step per input — with each of the panel's four sections read off the tree the
// frame declared, so a section is asserted as a developer sees it (not as the panel's own state says it is).
//
// The page is the dev page at its own size (`Dev.tsx`'s `size`), its drawer is `createDrawer` as `main.ts` wires it, and
// a "step" is one frame of the host's loop: the pointer and the keys in, then a frame.
import "./plugin.ts";

import type { A11yNode } from "./a11y.ts";
import type { Values } from "./app/Dev.tsx";

const { ui } = await import("./src/ffi.ts");
const { createFrame, createDrawer } = await import("./src/frame.ts");
const { createInput } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Dev, size, stats } = await import("./app/Dev.tsx");
const { snapshot } = await import("./a11y.ts");

export { size, stats, ui };

const FONT = new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname;

/** `x,y w×h` of a box, as the panel rounds it. */
export const at = (b: number[]) =>
  `${Math.round(b[0]!)},${Math.round(b[1]!)} ${Math.round(b[2]!)}×${Math.round(b[3]!)}`;

/** The panel's four sections, as the frame declared them: the tree's rows, the hovered box's lines, the live values
 *  (their target, their rows and their footer) and the frame's lines. */
export interface Sections {
  rows: string[];
  hover: string[];
  values: Values;
  frame: string[];
}

/** The live values' rows: the lines with the section's three-character gutter (`>` the cursor, `*` a live value). */
export const valueRows = (values: Values): string[] =>
  values.rows.filter((line) => /^[> ][* ] \S/.test(line));

/** The name of a live values row (`> *  radius 12` → `radius`). */
export const rowName = (line: string) => line.slice(3).split(" ")[0]!;
/** The number of a live values row. */
export const rowValue = (line: string) => Number(line.slice(3).split(" ")[1]);
/** Is the row live (its number is the panel's, not the style's)? */
export const isLive = (line: string) => line[1] === "*";
/** The row the arrows act on, or undefined. */
export const selected = (values: Values) =>
  valueRows(values).find((line) => line.startsWith(">"));

export interface Probe {
  input: ReturnType<typeof createInput>;
  root: InstanceType<typeof El>;
  left: () => InstanceType<typeof El>;
  panel: () => InstanceType<typeof El>;
  texts: (el: InstanceType<typeof El>) => string[];
  text: (el: InstanceType<typeof El>) => string;
  find: (pred: (el: InstanceType<typeof El>) => boolean, from?: InstanceType<typeof El>) => InstanceType<typeof El>[];
  reads: { draws: number; presents: number; frames: number }[];
  sections: () => Sections;
  snap: () => A11yNode;
  step: () => number;
  /** a whole key press with a frame after it */
  tap: (name: string) => void;
  /** the pointer to a point, a frame there, and one more for the panel's phase line */
  hover: (x: number, y: number) => void;
  /** the pointer leaves the page (over the panel, say), a frame there */
  move: (x: number, y: number) => void;
  press: () => void;
  release: () => void;
  /** A whole click at a point: the pointer there, a press frame, a release frame and one more */
  click: (x: number, y: number) => void;
  /** N frames at rest through the host's drawer: no input, and a draw only when the frame's hash says so */
  idle: (n: number) => void;
  /** The panel's own focus to a part by id, as Tab would leave it. */
  focus: (id: string) => void;
  /** Tab to a part of the page's tab order (from no focus), as a developer would. */
  tabTo: (id: string) => void;
}

let dispose = () => {};

/** The page as the window runs it: a fresh Dev, the host's frame over the panel's `stats`, and one step per input. */
export function fresh(options: { theme?: string; tune?: string } = {}): Probe {
  dispose();
  stats.length = 0;
  ui.init(size.width, size.height);
  ui.font(FONT);
  const root = new El("root");
  const input = createInput();
  input.fallback = () => false;
  const drag: { onPointer?: (x: number, y: number, down: boolean) => void } = {};
  const motion: { tick?: (dt: number) => void } = {};
  dispose = render(
    () => Dev({ input, motion, drag, theme: () => options.theme, tune: options.tune }),
    root,
  );
  // what the panel sees at each reading: the host's counters and how many frames the frame loop has pushed, taken at the
  // tick, after the page's own sampling. The panel's numbers are asserted against these, not against a guess
  const reads: Probe["reads"] = [];
  const tick = motion.tick;
  motion.tick = (dt) => {
    tick?.(dt);
    reads.push({ draws: ui.draws(), presents: ui.presents(), frames: stats.length });
  };
  // the host wires the page's hook to the frame's tick, as main.ts does
  const frame = createFrame(root, {
    stats,
    tick: (dt) => motion.tick?.(dt),
    get theme() {
      return options.theme;
    },
    onPointer: (x, y, down, touch) => {
      drag.onPointer?.(x, y, down);
      motion.onPointer?.(x, y, down, touch);
    },
    onPressMiss: () => input.pressMiss(),
  });
  const draw = createDrawer(frame, stats);
  let pointer: [number, number] = [-1, -1];
  let down = false;
  const find = (
    pred: (el: InstanceType<typeof El>) => boolean,
    from: InstanceType<typeof El> = root,
  ): InstanceType<typeof El>[] =>
    from.children.flatMap((c) =>
      c instanceof El ? [...(pred(c) ? [c] : []), ...find(pred, c)] : [],
    );
  const text = (el: InstanceType<typeof El>): string =>
    el.children.map((c) => (c instanceof Txt ? c.text : text(c))).join("");
  const texts = (el: InstanceType<typeof El>): string[] =>
    el.children.flatMap((c) => (!(c instanceof El) ? [] : c.tag === "text" ? [text(c)] : texts(c)));
  const left = () => find((el) => el.props.id === "Root")[0]!;
  const panel = () => find((el) => el.props.id === "dev-panel")[0]!;
  /** The four sections of the panel, split by their headers, as the texts the frame declares. */
  const sections = (): Sections => {
    const lines = texts(panel());
    const heads = ["hovered box", "live values", "frame"].map((h) => lines.indexOf(h));
    const [i, j, k] = heads as [number, number, number];
    const values = lines.slice(j + 1, k);
    return {
      rows: lines.slice(1, i),
      hover: lines.slice(i + 1, j),
      values: {
        target: values[0] ?? "",
        rows: values.slice(1, -1),
        footer: values[values.length - 1] ?? "",
      },
      frame: lines.slice(k + 1),
    };
  };
  // a step with `render` on: `frame` draws, which is what its fourth phase times (the host's drawer draws outside it)
  const step = () => frame(pointer[0]!, pointer[1]!, down, 1 / 60);
  step(), step();
  return {
    input,
    root,
    left,
    panel,
    texts,
    text,
    find,
    reads,
    sections,
    snap: (): A11yNode => snapshot(left()),
    step,
    tap(name: string) {
      input.down(name);
      input.up(name);
      step();
    },
    hover(x: number, y: number) {
      pointer = [x, y];
      step();
      step();
    },
    move(x: number, y: number) {
      pointer = [x, y];
      step();
    },
    press() {
      down = true;
      step();
    },
    release() {
      down = false;
      step();
    },
    click(x: number, y: number) {
      pointer = [x, y];
      step();
      step();
      down = true;
      step();
      step();
      down = false;
      step();
      step();
    },
    idle(n: number) {
      for (let i = 0; i < n; i++) draw(pointer[0]!, pointer[1]!, false, 1 / 60);
    },
    focus(id: string) {
      input.focus.focus(id);
      step();
    },
    tabTo(id: string) {
      const order = input.focus.tabOrder();
      const index = order.indexOf(id);
      if (index < 0) throw new Error(`no Tab stop "${id}": ${order.join(", ")}`);
      // from no focus, Tab lands on the first stop; the i-th stop is i + 1 Tabs
      for (let n = 0; n <= index; n++) {
        input.down("Tab");
        input.up("Tab");
        step();
      }
    },
  };
}

/** The page's teardown (`fresh()` disposes the page before it): the end of a test. */
export { dispose as _dispose };
