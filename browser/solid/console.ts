// The console target in a browser: the Sensors page in the terminal's own cells, printed with console.log instead of
// drawn on a canvas. It is the terminal host's page and cell plan (terminal/solid.ts's `cellStyle`) on the browser's
// Clay (ui.wasm), with the cells made by the terminal's renderer (terminal/cells.c + render.c, compiled into the same
// wasm) and the sink (terminal/cells.c's `cells_console`) turning them into a console.log call: one %c run a colour
// pair, a row a console line, and nothing at all when no cell changed (a console has no double buffer).
//
// A cell is 8x16 px and the grid is 80x20, so the layout's size is 640x320 and every page length is re-cut to the cell
// the terminal uses; the canvas stays dark (the shell's console sink never paints it) and the page's display is the
// console: open it, then Tab (the pill's ring), Space or Enter (press it) or `p` (print the frame again — at rest the
// sink is quiet).
import { observe, vitals } from "@cssints/devtools/vitals";

import { Sensors } from "../../solid/app/Sensors.tsx";
import * as styles from "../../examples/sensors/styles.ts";
import { FIELDS, variant } from "../../solid/src/pack.ts";
import { El } from "../../solid/src/renderer.ts";
import { ui } from "./ffi-browser.ts";
import { mountPage } from "./shell.ts";

// The report starts with the page: frames and long animation frames are only counted from when it observes.
observe();

const CELL_W = 8;
const CELL_H = 16;
const COLS = 80;
const ROWS = 20;

const encoder = new TextEncoder();
const ids = new Map<string, Uint8Array>();
const idOf = (id: string) => ids.get(id) ?? (ids.set(id, encoder.encode(id)), ids.get(id)!);

/** 0 the pill, 1 nothing: terminal/solid.ts's focus, and the ring its cell plan draws. */
let focus = 0;

/**
 * terminal/solid.ts's `cellStyle`, through the browser's value channel: the root's two cells of padding and no gap,
 * the pill three rows, and its 1px border the accent while it has the focus. The values are written each frame before
 * the tree is declared, because Clay reads them when an element opens.
 */
function cellStyle(): void {
  const root = idOf("Root");
  const units = idOf("Units");
  ui.value(root, FIELDS.PADDING + 0, 2 * CELL_W);
  ui.value(root, FIELDS.PADDING + 1, 2 * CELL_W);
  ui.value(root, FIELDS.PADDING + 2, 2 * CELL_H);
  ui.value(root, FIELDS.PADDING + 3, 2 * CELL_H);
  ui.value(root, FIELDS.GAP, 0);
  // 3 is CLAY__SIZING_TYPE_FIXED, then the min and the max (solid/src/pack.ts's axis)
  ui.value(units, FIELDS.HEIGHT + 0, 3);
  ui.value(units, FIELDS.HEIGHT + 1, 3 * CELL_H);
  ui.value(units, FIELDS.HEIGHT + 2, 3 * CELL_H);
  if (focus !== 0) return;
  const accent = variant(styles.magnitude).text;
  if (accent) for (let i = 0; i < 4; i++) ui.value(units, FIELDS.BORDER + i, accent[i]!);
}

/** The page's own tree, kept to press its one control the way the terminal's host does (`units?.props.onClick`). */
let root: El | undefined;
await mountPage({
  width: COLS * CELL_W,
  height: ROWS * CELL_H,
  sink: "console",
  beforeTree: cellStyle,
  tree: (setup) => {
    root = setup.root;
    return () => Sensors({ motion: setup.motion });
  },
});

/** The element of that id in the page's tree, wherever it is: the terminal host's `units` is found the same way (as
 *  the page declares it), and the pill's own onClick is pressed. */
function byId(el: El, id: string): El | undefined {
  if (el.props.id === id) return el;
  for (const child of el.children) {
    if (!(child instanceof El)) continue;
    const found = byId(child, id);
    if (found) return found;
  }
  return undefined;
}


/** Space/Enter: the pill's own onClick, as the terminal host presses it — no pointer, so no hover is left on the frame. */
function pressPill(): void {
  if (root) byId(root, "Units")?.props.onClick?.(-1, -1);
  window.__page.warm(1);
}

// The terminal's press gives the pill the focus (`focus = 0`, terminal/solid.ts's own rule), so a press on it brings the
// ring back after Tab. The shell's press frame ran before this listener (it was bound when the host was made); the ring
// lands on the release's frame, one frame later, which is the frame a reader sees.
document.getElementById("frame")!.addEventListener("pointerdown", (event) => {
  const box = window.__page.bounds("Units");
  if (!box) return;
  const canvas = event.currentTarget as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) * COLS * CELL_W) / rect.width;
  const y = ((event.clientY - rect.top) * ROWS * CELL_H) / rect.height;
  if (x >= box[0]! && x <= box[0]! + box[2]! && y >= box[1]! && y <= box[1]! + box[3]!) focus = 0;
});

// The chapter's keys, at the host: the Sensors page has no Input (it is pointer-only), so the ring is the host's, as the
// terminal's is, and Space is the press of the page's own control.
window.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    focus = focus === 0 ? 1 : 0;
    window.__page.warm(1);
  } else if ((event.key === " " || event.key === "Enter") && focus === 0) {
    event.preventDefault();
    pressPill();
  } else if (event.key === "p") {
    // the sink is quiet at rest; `p` prints the whole frame again, for a reader with the console open
    event.preventDefault();
    console.log(...JSON.parse(window.__page.cells()));
  } else if (event.key === "v") {
    // the page's vitals: this page draws to a canvas, so there is nothing in the DOM to inspect
    event.preventDefault();
    vitals();
  }
});

// `?vitals`: the same report once, after the first frames, so a reader who opens the console late still gets it
if (new URLSearchParams(location.search).has("vitals")) setTimeout(() => vitals(), 500);
