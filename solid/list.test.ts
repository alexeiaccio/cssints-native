// What the stored frames of the List page cannot show: the wheel moving Clay's own scroll offset and the rows with it,
// the clamps at both ends, the viewport's clip (a selected row's fill cut at the edge, not drawn above it), the keyboard
// selection scrolling the selected row into view, the selection staying in 0..29, the wheel leaving the selection alone,
// the header and footer staying put, and the page fitting. Driven as the window does it: pointer and wheel in, then a
// frame.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { List, size } = await import("./app/List.tsx");

ui.init(size.width, size.height);
ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) failed++, console.error(`FAIL ${what}: ${a}, wanted ${b}`);
};
/** Floating point from layout, to the pixel. */
const round = (xs: number[]) => xs.map((x) => Math.round(x * 100) / 100);

const PAGE = [16, 18, 24]; // the page token of the dark theme
const SURFACE = [36, 40, 52]; // the selected row's fill
const RING = [90, 170, 255]; // the focus ring

let dispose = () => {};
function fresh() {
  dispose();
  const root = new El("root");
  const input = createInput();
  dispose = render(() => List({ input }), root);
  const frame = createFrame(root, { onPressMiss: () => input.pressMiss() });
  let at = [-1, -1];
  const step = (down = false) => frame(at[0]!, at[1]!, down, 1 / 60);
  step();
  // Clay keeps a scroll container's offset across frames by its id, and one Clay context serves every `fresh()` here:
  // the page starts where the last test left it unless it is put back (the window is a new process every run)
  ui.scrollTo("list", 0);
  step();

  const find = (pred: (el: El) => boolean, from: El = root): El[] =>
    from.children.flatMap((c) => (c instanceof El ? [...(pred(c) ? [c] : []), ...find(pred, c)] : []));
  const text = (el: El): string => el.children.map((c) => (c instanceof Txt ? c.text : text(c))).join("");
  const box = (id: string) => [...(ui.bounds(Buffer.from(id)) ?? [])];
  const pixel = (x: number, y: number) => ui.pixel(Math.floor(x), Math.floor(y)).slice(0, 3);
  /** The header's readout: "Room A1 — 1 of 30". */
  const readout = () => find((el) => el.tag === "text").map(text).find((t) => / of 30$/.test(t))!;
  /** The selection the readout shows, 1-based. */
  const selected = () => Number(/— (\d+) of 30$/.exec(readout())![1]);

  return {
    input,
    box,
    pixel,
    readout,
    selected,
    /** The view's top and height, the offset Clay keeps: a row's top is its own plus this. */
    view: () => box("list"),
    offset: () => ui.scrollOffset("list"),
    /** Puts the pointer at x, y and lays out a frame: `ui.bounds` and Clay's "what is under it" follow. */
    point(x: number, y: number) {
      at = [x, y];
      step();
    },
    /** `n` wheel notches down in one frame (each is 10px of Clay's scroll), the pointer left where it is. */
    notch(n: number) {
      ui.wheel(0, -n);
      step();
    },
    /** `n` notches down over the viewport: the pointer goes onto it first, as the wheel needs it there. */
    wheel(n: number) {
      this.point(180, 160);
      this.notch(n);
    },
    /** One notch up, the pointer over the viewport. */
    wheelUp(n: number) {
      this.point(180, 160);
      ui.wheel(0, n);
      step();
    },
    /** A key pressed and released with a frame after each. */
    tap(name: string) {
      input.down(name);
      step();
      input.up(name);
      step();
    },
    /** A row's box, from the last frame. */
    row: (i: number) => box(`row-${i}`),
  };
}

// --- the page: one clip element of 240, thirty rows of 28 in a column of 30, the header and the footer outside it
{
  const p = fresh();
  const view = p.view();
  check("the viewport is 240 tall", view[3], 240);
  check("and one page wide", [view[0], view[2]], [40, 280]);
  const first = p.row(0);
  check("the first row is at the viewport's top", first[1], view[1]);
  check("a row is 28 tall", first[3], 28);
  const last = p.row(29);
  check("thirty rows, the last one past the viewport: the content is 30 * 30 - 2", last[1]! + last[3]! - view[1]!, 898);
  check("a row is as wide as the viewport", first[2], view[2]);
  const root = p.box("Root");
  check("the page is the window wide", [root[0], root[2]], [0, size.width]);
  const foot = p.box("list-foot");
  check("and its last line and the 24px padding fit the height", foot[1]! + foot[3]! + 24 <= size.height, true);
  check("the viewport is not shrunk by the window", view[3], 240);
  check("nothing is focused at first", p.input.focus.focused(), null);
  check("and nothing is scrolled", p.offset(), 0);
}

// --- the wheel: Clay's offset moves by 10px a notch, and the rows move with it
{
  const p = fresh();
  const view = p.view();
  p.wheel(2);
  check("two notches down move the offset to -20", p.offset(), -20);
  check("and the first row up by exactly that", round([p.row(0)[1]!, view[1]! - 20]), round([view[1]! - 20, view[1]! - 20]));
  check("the rows below it too", p.row(3)[1], view[1]! + 90 - 20);
  check("the selection did not move", p.selected(), 1);
  p.wheelUp(1);
  check("a notch up comes back by 10", p.offset(), -10);
  check("and the first row with it", p.row(0)[1], view[1]! - 10);
}

// --- the clamps: the top is 0 and the bottom is the last screenful
{
  const p = fresh();
  const view = p.view();
  p.wheel(200);
  check("the offset stops at the content's end: 898 - 240", p.offset(), -658);
  check("the last row's bottom is the viewport's", p.row(29)[1]! + p.row(29)[3]!, view[1]! + view[3]!);
  p.wheelUp(200);
  check("and at the top it is 0, not positive", p.offset(), 0);
  check("the first row back at the viewport's top", p.row(0)[1], view[1]);
}

// --- the clip: a selected row's fill is cut at the viewport's edge, not drawn above it
{
  const p = fresh();
  p.tap("Tab");
  check("Tab focuses the list", p.input.focus.focused(), "list");
  const view = p.view();
  p.wheel(1);
  check("one notch down", p.offset(), -10);
  const row = p.row(0);
  check("the bounds are not clipped: the row's top is 10 above the viewport", row[1], view[1]! - 10);
  const inside = p.pixel(view[0]! + 20, view[1]! + 5);
  check("inside, the selected row's fill is drawn", inside, SURFACE);
  const above = p.pixel(view[0]! + 20, view[1]! - 5);
  check("above the viewport, where the row would be, the page shows through", above, PAGE);
  check("and past the viewport's bottom too", p.pixel(view[0]! + 20, view[1]! + view[3]! + 5), PAGE);
}

// --- the keyboard: every move scrolls the selected row into view and the selection stays in 0..29
{
  const p = fresh();
  p.tap("Tab");
  const view = p.view();
  const inView = (i: number) => {
    const [rowTop, rowHeight] = [p.row(i)[1]!, p.row(i)[3]!];
    return rowTop >= view[1]! - 0.01 && rowTop + rowHeight <= view[1]! + view[3]! + 0.01;
  };
  check("the first row starts in view", inView(0), true);
  for (let i = 1; i <= 12; i++) {
    p.tap("ArrowDown");
    check(`ArrowDown ${i} selects ${i + 1} of 30`, p.selected(), i + 1);
    check(`and row ${i} is in the viewport`, inView(i), true);
  }
  // past the edge: row 12 is the last screenful, so the view has scrolled by 12 rows less eight
  check("the view scrolled to the selected row", p.offset(), -148);
  p.tap("PageDown");
  check("PageDown jumps eight: 21 of 30", p.selected(), 21);
  check("and scrolls to it", [inView(20), p.offset()], [true, -388]);
  p.tap("End");
  check("End goes to 30 of 30", p.selected(), 30);
  check("at the bottom of the content", p.offset(), -658);
  check("the last row is in view", inView(29), true);
  p.tap("ArrowDown");
  check("Down at the end stays at 30 of 30", p.selected(), 30);
  check("and does not scroll further", p.offset(), -658);
  p.tap("PageUp");
  check("PageUp jumps back eight", p.selected(), 22);
  check("after a Home the first row is back at the top", (p.tap("Home"), [p.selected(), p.offset(), inView(0)]), [1, 0, true]);
  p.tap("ArrowUp");
  check("Up at the top stays at 1 of 30", p.selected(), 1);
  check("with nothing scrolled", p.offset(), 0);
}

// --- the wheel leaves the selection alone, and a key brings it back into view
{
  const p = fresh();
  p.tap("Tab");
  for (let i = 0; i < 3; i++) p.tap("ArrowDown");
  check("the selection is 4 of 30", p.selected(), 4);
  p.wheel(20);
  check("the wheel scrolled the view", p.offset(), -200);
  check("and did not touch the selection", p.selected(), 4);
  check("the selected row went out of view", p.row(3)[1]! < p.view()[1]!, true);
  p.tap("ArrowDown");
  check("ArrowDown selects 5 of 30", p.selected(), 5);
  check("and scrolls the view up to row 5", [p.row(4)[1], p.offset()], [p.view()[1], -120]);
}

// --- the header and the footer are outside the clip element: they stay where they are
{
  const p = fresh();
  const head = p.box("list-head");
  const foot = p.box("list-foot");
  const row = p.row(2);
  p.wheel(5);
  check("the header did not move", p.box("list-head"), head);
  check("and neither did the footer", p.box("list-foot"), foot);
  check("while the rows moved by the offset", p.row(2)[1], row[1]! - 50);
  check("the readout still shows the selection", p.readout(), "Room A1 — 1 of 30");
}

// --- the focus ring: the selected row's, 2px in the ring token, only while the list has the focus
{
  const p = fresh();
  const row = p.row(0);
  check("unfocused, the selected row's left edge is its fill", p.pixel(row[0]! + 1, row[1]! + 14), SURFACE);
  p.tap("Tab");
  check("focused, the row's left edge is the ring", p.pixel(row[0]! + 1, p.row(0)[1]! + 14), RING);
  check("2px in, then the fill again", p.pixel(p.row(0)[0]! + 3, p.row(0)[1]! + 14), SURFACE);
  p.tap("Escape");
  check("Escape is nobody's here: the list keeps the focus", p.input.focus.focused(), "list");
}

// --- the wheel only reaches the container under the pointer
{
  const p = fresh();
  p.tap("Tab");
  p.wheel(2);
  check("the pointer over the viewport scrolls it", p.offset(), -20);
  p.point(180, 40); // the title, above the viewport
  p.notch(2);
  check("with the pointer off the viewport the same wheel scrolls nothing", p.offset(), -20);
}

dispose();
if (failed) process.exit(1);
console.log(
  "solid/list.test.ts: the wheel moving Clay's scroll offset and the rows with it, the clamps at both ends, the clip at " +
    "the viewport's edge, the keyboard selection scrolling into view and staying in range, the wheel leaving the " +
    "selection alone, the header and footer staying put, the focus ring, the page fitting",
);
process.exit(0);
