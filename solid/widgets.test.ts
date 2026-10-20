// What the stored frames of the Widgets page cannot show: the Tab order and Shift+Tab over the whole page, when each key
// acts, what a click does to a widget and to focus, the disabled checkbox, "Select all" over its two children, the
// disclosure, the four groups (radio, tabs, slider, toolbar: one Tab stop each, arrows, clamping, memory, a disabled
// radio, a press on the slider's rail and a drag with the button held), the settings tree (one stop, the visible nodes
// only, Right and Left, Home and End, Space), and how an SDL key becomes a name. Frames are driven as the window does it:
// pointer and keys in, then one frame.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput, keyName } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Widgets, size } = await import("./app/Widgets.tsx");
const { s } = await import("./app/Widgets.tsx");

ui.init(size.width, size.height);
ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) failed++, console.error(`FAIL ${what}: ${a}, wanted ${b}`);
};

// the page as the window runs it: a fresh page each time, the pointer remembered between frames
let dispose = () => {};
function fresh(options: { disabledSpeeds?: number[] } = {}) {
  dispose();
  const root = new El("root");
  const input = createInput();
  const drag: { onPointer?: (x: number, y: number, down: boolean) => void } = {};
  const unhandled: string[] = [];
  input.fallback = (name) => (unhandled.push(name), name === "t");
  dispose = render(() => Widgets({ input, drag, ...options }), root);
  const frame = createFrame(root, { onPointer: (x, y, down) => drag.onPointer?.(x, y, down), onPressMiss: () => input.pressMiss() });
  let at = [-1, -1];
  const step = (down = false) => frame(at[0]!, at[1]!, down, 1 / 60);
  step(), step();

  const find = (pred: (el: El) => boolean, from: El = root): El[] =>
    from.children.flatMap((c) => (c instanceof El ? [...(pred(c) ? [c] : []), ...find(pred, c)] : []));
  const styled = (style: object) => find((el) => el.props.style === style).length;
  const text = (el: El): string => el.children.map((c) => (c instanceof Txt ? c.text : text(c))).join("");
  const label = () => find((el) => el.tag === "text" && /^Presses/.test(text(el))).map(text)[0];
  const texts = () => find((el) => el.tag === "text").map(text);
  const box = (id: string) => ui.bounds(Buffer.from(id))!;
  return {
    input,
    unhandled,
    styled,
    label,
    texts,
    /** the readout of the volume slider */
    volume: () => texts().find((t) => /^\d+%$/.test(t)),
    /** where Tab lands on a group: the one of its entries that is in the Tab order */
    stop: (prefix: string) => input.focus.tabOrder().find((id) => id.startsWith(prefix)),
    focused: () => input.focus.focused(),
    exists: (id: string) => find((el) => el.props.id === id).length > 0,
    /** the texts of the boxes whose id matches, in document order: a tree's rows, the hidden ones absent */
    labels: (re: RegExp) => find((el) => typeof el.props.id === "string" && re.test(el.props.id)).map(text),
    /** a key pressed and released with a frame after each, as an event loop delivers them */
    down: (name: string, repeat = false) => (input.down(name, repeat), step()),
    up: (name: string) => (input.up(name), step()),
    tap(name: string) {
      this.down(name);
      this.up(name);
    },
    move: (id: string, dx = 0.5, dy = 0.5, down = false) => {
      const b = box(id);
      at = [b[0]! + b[2]! * dx, b[1]! + b[3]! * dy];
      step(down);
    },
    away: () => ((at = [352, 432]), step()),
    press: () => step(true),
    release: () => step(false),
    click(id: string, dx = 0.5) {
      this.move(id, dx);
      this.press();
      this.release();
    },
    pixel: (x: number, y: number) => ui.pixel(x, y).join(","),
    /** A prop of the box with this id (the part fields a page puts on it, `hasPopup`, `expanded`). */
    prop: (id: string, name: string) => find((el) => el.props.id === id).map((el) => el.props[name])[0],
    box,
  };
}

// --- the Tab order over the whole page: button, switch, select all, wired, wireless, the trigger (the disabled box is
// skipped), then each group once: radio (the checked one), the selected tab, its panel, the slider, the toolbar, the tree
const ORDER = [
  "press",
  "wifi",
  "all",
  "wired",
  "wireless",
  "more-trigger",
  "speed-radio-0",
  "tabs-tab-0",
  "tabs-tabpanel-0",
  "volume-thumb",
  "format-item-0",
  "settings-item-1",
];
{
  const p = fresh();
  const walk = (key: string, n: number) => Array.from({ length: n }, () => (p.tap(key), p.focused()));
  check("the stops the manager has, in document order", p.input.focus.tabOrder(), ORDER);
  check("Tab order", walk("Tab", ORDER.length + 2), [...ORDER, null, "press"]);
  check("Shift+Tab reverses (after one back from the first, focus is released)", walk("Shift+Tab", 2), [null, "settings-item-1"]);
  check("Shift+Tab order", walk("Shift+Tab", ORDER.length - 1), ORDER.slice(0, -1).reverse());
  check("and releases focus past the first", walk("Shift+Tab", 1), [null]);
}

// --- the page fits its window, with the disclosure open and the tree's Display open too: as wide as the window (a row
// too wide widens the root and shifts everything), and the last row ends above the root's bottom padding (a page too
// tall for the window makes Clay shrink a box: the panel below, when it is the one that does not fit)
{
  const p = fresh();
  const fits = (what: string) => {
    const last = p.box("settings-item-6");
    check(`${what}: the root is the window's width`, p.box("Root")[2], size.width);
    check(`${what}: the last tree row ends inside the page`, last[1]! + last[3]! <= size.height - 24, true);
  };
  fits("closed");
  p.click("more-trigger");
  fits("disclosure open");
  check("the open panel is not shrunk (two lines and its padding: 52.8)", p.box("more-panel")[3]!.toFixed(1), "52.8");
  // the tallest state: the panel open and a subtree open under it (6 tree rows)
  p.input.focus.focus("settings-item-4"), p.tap("ArrowRight");
  check("Display is open", p.texts().includes("Brightness"), true);
  fits("disclosure and Display open");
  check("the panel is still not shrunk", p.box("more-panel")[3]!.toFixed(1), "52.8");
}

// --- the focus ring is drawn on the focused row, and only there
{
  const p = fresh();
  const [x, y, , h] = p.box("wifi") as unknown as number[];
  const edge = () => p.pixel(x! + 1, y! + h! / 2);
  check("no ring at rest", edge() === "90,170,255,255", false);
  p.tap("Tab"), p.tap("Tab");
  check("ring on the switch after Tab Tab", edge(), "90,170,255,255");
  p.tap("Tab");
  check("ring moves on", edge() === "90,170,255,255", false);
}

// --- keys: Space acts on key up, Enter on key down (a button), Space on the switch, Enter does not toggle a switch
{
  const p = fresh();
  p.tap("Tab");
  p.down(" ");
  check("Space down on the button does not press", p.label(), "Presses: 0");
  p.up(" ");
  check("Space up presses", p.label(), "Presses: 1");
  p.down("Enter");
  check("Enter down presses", p.label(), "Presses: 2");
  p.up("Enter");
  check("Enter up does not press again", p.label(), "Presses: 2");
  p.down(" "), p.down(" ", true), p.up(" ");
  check("a held Space presses once", p.label(), "Presses: 3");

  p.tap("Tab");
  p.down(" ");
  check("Space down on the switch does not toggle", p.styled(s.trackOn), 0);
  p.up(" ");
  check("Space up toggles the switch", p.styled(s.trackOn), 1);
  p.tap("Enter");
  check("Enter does not toggle a switch", p.styled(s.trackOn), 1);
  p.tap(" ");
  check("Space toggles it back", p.styled(s.trackOn), 0);
  // an armed Space is dropped when focus moves away
  p.down(" ");
  p.tap("Tab");
  p.up(" ");
  check("Space armed on the switch, Tab away: nothing fires", [p.styled(s.trackOn), p.label()], [0, "Presses: 3"]);
}

// --- a click: toggles the switch and focuses it; the pressed look while held
{
  const p = fresh();
  p.click("wifi");
  check("click toggles the switch", p.styled(s.trackOn), 1);
  check("click focuses the switch", p.focused(), "wifi");
  p.click("press");
  check("click on the button counts and moves focus", [p.label(), p.focused()], ["Presses: 1", "press"]);
  p.away();
  const b = p.box("wifi");
  const fill = () => p.pixel(b[0]! + 20, b[1]! + 3);
  check("a row at rest has no fill", fill(), "16,18,24,255");
  p.move("wifi");
  check("hover look (:hover) of a row", fill(), "48,53,68,255");
  p.press();
  check("pressed look (:active) of a row", fill(), "64,70,90,255");
  p.release();
  check("released after a press: toggled back", p.styled(s.trackOn), 0);
  // pressed on the switch, released elsewhere: no toggle
  p.move("wifi"), p.press(), p.away(), p.release();
  check("press here, release elsewhere", p.styled(s.trackOn), 0);

  p.click("press");
  p.away(), p.press(), p.release();
  check("a click on empty space blurs", p.focused(), null);
}

// --- contrast: the ink on every fill a button, a row, a radio, a tab or a tool can have, in both themes (WCAG 2: at least 4.5:1)
{
  const lum = (c: { r: number; g: number; b: number }) => {
    const ch = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const ratio = (a: Rgb, b: Rgb) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x! + 0.05) / (y! + 0.05);
  };
  type Rgb = { r: number; g: number; b: number };
  type Shape = { backgroundColor?: Rgb; text?: { textColor?: Rgb }; [k: string]: unknown };
  const themed = (shape: Shape, theme?: string): Shape =>
    theme ? { ...shape, ...((shape.themes as Record<string, Shape>)[theme] ?? {}) } : shape;
  for (const theme of [undefined, "light"]) {
    const ink = themed(s.label as Shape, theme).text!.textColor!;
    const page = themed(s.root as Shape, theme).backgroundColor!;
    const surface = themed(s.tabPanel as Shape, theme).backgroundColor!;
    const note = themed(s.note as Shape, theme).text!.textColor!;
    if (ratio(note, surface) < 4.5) failed++, console.error(`FAIL contrast note on a panel ${theme ?? "dark"}`);
    for (const [name, style] of [
      ["button", s.button],
      ["row", s.row],
      ["choice", s.choice],
      ["tab", s.tab],
      ["tabOn", s.tabOn],
      ["tool", s.tool],
      ["node", s.node],
      ["nodeSelected", s.nodeSelected],
    ] as const) {
      const base = themed(style as Shape, theme);
      for (const state of ["", ":hover", ":active"]) {
        const fill = ((state ? (base[state] as Shape) : base).backgroundColor ?? page) as Rgb;
        const r = ratio(ink, fill);
        if (r < 4.5) failed++, console.error(`FAIL contrast ${name}${state} ${theme ?? "dark"}: ${r.toFixed(2)}:1`);
      }
    }
    // the tree's selected row writes its label in the accent: the accent on the surface it sits on
    const accent = themed(s.labelSelected as Shape, theme).text!.textColor!;
    const r = ratio(accent, surface);
    if (r < 4.5) failed++, console.error(`FAIL contrast tree label selected ${theme ?? "dark"}: ${r.toFixed(2)}:1`);
  }
}

// --- the disabled checkbox: skipped by Tab (above), ignores a click, leaves focus where it was
{
  const p = fresh();
  p.click("wifi");
  p.click("beta");
  check("a click on the disabled box checks nothing", p.styled(s.tick) + p.styled(s.dash), 0);
  check("and does not take focus, nor drop it", p.focused(), "wifi");
}

// --- select all over its two children
{
  const p = fresh();
  p.click("all");
  check("select all checks both children", p.styled(s.tick), 3);
  p.click("wired");
  check("one child off: select all is mixed", [p.styled(s.tick), p.styled(s.dash)], [1, 1]);
  p.click("all");
  check("a mixed select all checks both", [p.styled(s.tick), p.styled(s.dash)], [3, 0]);
  p.click("all");
  check("checked, a click clears both", [p.styled(s.tick), p.styled(s.dash)], [0, 0]);
  p.click("wired");
  check("one child on: mixed", [p.styled(s.tick), p.styled(s.dash)], [1, 1]);
  p.tap("Tab");
  check("Tab from a clicked box goes on in order", p.focused(), "wireless");
}

// --- the disclosure: Enter shows the panel, Space on key up hides it, a click toggles
{
  const p = fresh();
  check("panel hidden at first", p.exists("more-panel"), false);
  for (let n = 0; n < 6; n++) p.tap("Tab");
  check("the trigger is focused", p.focused(), "more-trigger");
  p.tap("Enter");
  check("Enter shows the panel", p.exists("more-panel"), true);
  p.down(" ");
  check("Space down keeps it", p.exists("more-panel"), true);
  p.up(" ");
  check("Space up hides it", p.exists("more-panel"), false);
  p.click("more-trigger");
  check("a click shows it", p.exists("more-panel"), true);
}

// --- the radio: Tab enters at the checked one and leaves as one stop; the arrows move focus and check
{
  const p = fresh();
  const tabTo = (id: string) => {
    for (let n = 0; n < ORDER.length && p.focused() !== id; n++) p.tap("Tab");
    return p.focused();
  };
  check("Tab reaches the radio on the first one (checked)", tabTo("speed-radio-0"), "speed-radio-0");
  check("one radio is checked", [p.styled(s.radioOn), p.styled(s.dot)], [1, 1]);
  p.tap("ArrowRight");
  check("ArrowRight moves focus and checks", [p.focused(), p.stop("speed-radio")], ["speed-radio-1", "speed-radio-1"]);
  check("still one checked, one dot", [p.styled(s.radioOn), p.styled(s.dot)], [1, 1]);
  p.tap("ArrowRight");
  check("on to the third", [p.focused(), p.stop("speed-radio")], ["speed-radio-2", "speed-radio-2"]);
  p.tap("ArrowRight");
  check("ArrowRight wraps", [p.focused(), p.stop("speed-radio")], ["speed-radio-0", "speed-radio-0"]);
  p.tap("ArrowLeft");
  check("ArrowLeft wraps back", [p.focused(), p.stop("speed-radio")], ["speed-radio-2", "speed-radio-2"]);
  p.tap("ArrowDown");
  check("ArrowDown is forward too (the group is both ways)", p.focused(), "speed-radio-0");
  p.tap("ArrowUp");
  check("ArrowUp is back", p.focused(), "speed-radio-2");
  check("the group is one Tab stop", p.input.focus.tabOrder().filter((id) => id.startsWith("speed-radio")), ["speed-radio-2"]);
  p.tap("Home");
  check("Home is not a radio key: focus and check stay, the page gets it", [p.focused(), p.unhandled.includes("Home")], ["speed-radio-2", true]);
  p.tap("Tab");
  check("Tab leaves the group to the next stop, not the next radio", p.focused(), "tabs-tab-0");
  p.tap("Shift+Tab");
  check("Shift+Tab comes back to the checked radio", p.focused(), "speed-radio-2");
  p.tap("ArrowLeft");
  p.input.focus.focus("speed-radio-0");
  p.tap(" ");
  check("Space checks the focused radio", p.stop("speed-radio"), "speed-radio-0");
  p.click("speed-radio-1");
  check("a click focuses and checks", [p.focused(), p.stop("speed-radio")], ["speed-radio-1", "speed-radio-1"]);
}

// --- a disabled radio is skipped by the arrows, by Tab, and by a click
{
  const p = fresh({ disabledSpeeds: [1] });
  check("the disabled radio looks it", p.styled(s.radioDisabled), 1);
  p.input.focus.focus("speed-radio-0");
  p.tap("ArrowRight");
  check("ArrowRight skips it", [p.focused(), p.stop("speed-radio")], ["speed-radio-2", "speed-radio-2"]);
  p.tap("ArrowLeft");
  check("and ArrowLeft", p.focused(), "speed-radio-0");
  p.click("speed-radio-1");
  check("a click on it does nothing: focus stays, nothing checked", [p.focused(), p.stop("speed-radio")], ["speed-radio-0", "speed-radio-0"]);
  const lap = Array.from({ length: ORDER.length + 1 }, () => (p.tap("Tab"), p.focused()));
  check("a lap of Tab never lands on it", lap.includes("speed-radio-1"), false);
  check("and enters the group at the checked one", lap.filter((id) => id?.startsWith("speed-radio")), ["speed-radio-0"]);
}

// --- the tabs: arrows and Home/End move and select; the panel follows; the panel is the next Tab stop
{
  const p = fresh();
  for (let n = 0; n < 8; n++) p.tap("Tab");
  check("Tab reaches the tabs on the selected one", p.focused(), "tabs-tab-0");
  check("the first panel", [p.exists("tabs-tabpanel-0"), p.exists("tabs-tabpanel-1"), p.styled(s.tabOn)], [true, false, 1]);
  p.tap("ArrowRight");
  check("ArrowRight focuses and selects the second", [p.focused(), p.stop("tabs-tab-")], ["tabs-tab-1", "tabs-tab-1"]);
  check("its panel is shown, with its text", [p.exists("tabs-tabpanel-0"), p.exists("tabs-tabpanel-1"), p.texts().includes("Home and End go to the first")], [false, true, true]);
  check("one tab is selected", p.styled(s.tabOn), 1);
  p.tap("ArrowRight");
  p.tap("ArrowRight");
  check("ArrowRight wraps to the first", [p.focused(), p.exists("tabs-tabpanel-0")], ["tabs-tab-0", true]);
  p.tap("ArrowLeft");
  check("ArrowLeft wraps to the last and selects it", [p.focused(), p.exists("tabs-tabpanel-2")], ["tabs-tab-2", true]);
  p.tap("Home");
  check("Home: the first tab", [p.focused(), p.exists("tabs-tabpanel-0")], ["tabs-tab-0", true]);
  p.tap("End");
  check("End: the last tab", [p.focused(), p.exists("tabs-tabpanel-2")], ["tabs-tab-2", true]);
  p.tap("ArrowDown");
  check("ArrowDown is not a key of a horizontal tablist", [p.focused(), p.unhandled.includes("ArrowDown")], ["tabs-tab-2", true]);
  check("the tablist is one stop, then its panel", p.input.focus.tabOrder().filter((id) => id.startsWith("tabs-")), ["tabs-tab-2", "tabs-tabpanel-2"]);
  p.tap("Tab");
  check("Tab goes to the selected panel", p.focused(), "tabs-tabpanel-2");
  const [x, y, , h] = p.box("tabs-tabpanel-2") as unknown as number[];
  check("the panel has the focus ring", p.pixel(x! + 1, y! + h! / 2), "90,170,255,255");
  p.tap("Tab");
  check("and then the slider", p.focused(), "volume-thumb");
  p.tap("Shift+Tab"), p.tap("Shift+Tab");
  check("Shift+Tab: the panel, then the selected tab", p.focused(), "tabs-tab-2");
  p.click("tabs-tab-1");
  check("a click selects and focuses", [p.focused(), p.exists("tabs-tabpanel-1")], ["tabs-tab-1", true]);
}

// --- the slider: the keys step, page, jump to the ends, and stop at them; a press on the rail sets the value; a drag
// with the button held follows the pointer
{
  const p = fresh();
  const RAIL = 140;
  const KNOB = 16;
  // the x of a pointer position on the rail that is `r` of the thumb's travel (the rail less the knob), as `onRail`
  // measures it: 0.9 of the travel is 90% of the value
  const at = (r: number) => (KNOB / 2 + r * (RAIL - KNOB)) / RAIL;
  const knobAt = () => (p.box("volume-knob")[0]! - p.box("volume-rail")[0]!).toFixed(1);
  check("40% at first, the knob at 40% of 124", [p.volume(), knobAt()], ["40%", "49.6"]);
  for (let n = 0; n < 10; n++) p.tap("Tab");
  check("Tab reaches the slider", p.focused(), "volume-thumb");
  p.tap("ArrowRight");
  check("ArrowRight: one step (5)", p.volume(), "45%");
  p.tap("ArrowUp");
  check("ArrowUp: a step up", p.volume(), "50%");
  p.tap("ArrowLeft"), p.tap("ArrowLeft");
  check("ArrowLeft: steps down", p.volume(), "40%");
  p.tap("ArrowDown");
  check("ArrowDown: a step down", p.volume(), "35%");
  p.tap("PageUp");
  check("PageUp: a large step (20)", p.volume(), "55%");
  p.tap("PageDown"), p.tap("PageDown");
  check("PageDown: a large step down", p.volume(), "15%");
  p.tap("End");
  check("End: the maximum", [p.volume(), knobAt()], ["100%", "124.0"]);
  p.tap("ArrowRight"), p.tap("PageUp");
  check("clamped at the maximum", p.volume(), "100%");
  p.tap("Home");
  check("Home: the minimum", [p.volume(), knobAt()], ["0%", "0.0"]);
  p.tap("ArrowLeft"), p.tap("PageDown");
  check("clamped at the minimum", p.volume(), "0%");
  p.tap("PageUp"), p.tap("PageUp"), p.tap("PageUp"), p.tap("PageUp"), p.tap("PageUp"), p.tap("PageUp");
  check("a page at a time reaches the maximum and stops there", p.volume(), "100%");
  check("keys do not move focus", p.focused(), "volume-thumb");
  // a press on the rail: the value from where the press was
  p.away();
  p.input.focus.blur();
  p.click("volume-rail", 0.5);
  check("a press in the middle of the rail: 50%", [p.volume(), p.focused()], ["50%", "volume-thumb"]);
  p.click("volume-rail", 0.25);
  check("a quarter along: the nearest step (21.8 is 20)", p.volume(), "20%");
  p.click("volume-rail", 0);
  check("at the left end: 0%", p.volume(), "0%");
  p.click("volume-rail", 1);
  check("at the right end: 100%", p.volume(), "100%");
  p.click("volume-rail", 0.5);
  p.click("volume-knob", 0.5);
  check("a press on the knob's middle keeps its value", p.volume(), "50%");
  // a drag: press at a quarter, then move with the button held, both ways
  p.away();
  p.move("volume-rail", 0.25);
  p.press();
  check("a press at a quarter of the rail: 20%", p.volume(), "20%");
  const knobPos = () => p.box("volume-knob")[0]! - p.box("volume-rail")[0]!;
  const quarter = knobPos();
  p.move("volume-rail", at(0.9), 0.5, true);
  check("dragging to 0.9: 90%", p.volume(), "90%");
  check("the knob follows the pointer", knobPos() > quarter + 50, true);
  p.move("volume-rail", at(0.1), 0.5, true);
  check("dragging back to 0.1: 10%, no step drift", p.volume(), "10%");
  check("the knob is back near the start", knobPos().toFixed(1), (0.1 * (RAIL - KNOB)).toFixed(1));
  p.move("volume-rail", -0.5, 0.5, true);
  check("dragging past the left end clamps at 0", p.volume(), "0%");
  p.move("volume-rail", 1.5, 0.5, true);
  check("dragging past the right end clamps at 100", p.volume(), "100%");
  p.release();
  check("a release outside the rail keeps the last value", p.volume(), "100%");
  p.move("volume-rail", at(0.5));
  check("after the release, a move changes nothing", p.volume(), "100%");
  // a press off the rail does not drag, even with the button held over the rail
  p.away(), p.press();
  p.move("volume-rail", at(0.2), 0.5, true);
  check("a press off the rail then a move changes nothing", p.volume(), "100%");
  p.release();
  p.away(), p.press(), p.release();
  check("empty space blurs it", p.focused(), null);
}

// --- the slider's focus ring is the rail's (the control), not the row's and not the value text's, and moves no layout
{
  const p = fresh();
  const rail = p.box("volume-rail") as unknown as number[];
  const row = p.box("volume-thumb") as unknown as number[];
  const RING = "90,170,255,255";
  const railEdge = () => p.pixel(rail[0]! + 1, rail[1]! + rail[3]! / 2);
  // the readout starts a gap (4) after the rail: its top edge is where the row's ring would draw, not where the rail's is
  const readoutTop = () => p.pixel(rail[0]! + rail[2]! + 4 + 22, rail[1]! + 1);
  const rowRight = () => p.pixel(row[0]! + row[2]! - 1, row[1]! + 1);
  check("no ring on the rail at rest", railEdge() === RING, false);
  const before = JSON.stringify(p.box("volume-rail"));
  for (let n = 0; n < 10; n++) p.tap("Tab");
  check("the slider is focused", p.focused(), "volume-thumb");
  check("the ring is on the rail's edge", railEdge(), RING);
  check("the rail has the same box when focused", JSON.stringify(p.box("volume-rail")), before);
  check("the readout has no ring (the ring does not enclose the value)", readoutTop() === RING, false);
  check("the row has no ring of its own", rowRight() === RING, false);
  const knob = p.box("volume-knob");
  check("no ring on the knob", p.pixel(knob[0]! + 1, knob[1]! + knob[3]! / 2), "150,155,170,255");
}

// --- the toolbar: arrows and Home/End move (no wrap), Tab back in lands on the item left last; Enter and Space toggle a
// plain item. The third item is a menu button (the next block): the roving focus treats it as one more item.
{
  const p = fresh();
  for (let n = 0; n < 11; n++) p.tap("Tab");
  check("Tab reaches the toolbar on the first item", p.focused(), "format-item-0");
  p.tap("ArrowLeft");
  check("no wrap at the start", p.focused(), "format-item-0");
  p.tap("ArrowRight");
  check("ArrowRight: the next item", p.focused(), "format-item-1");
  p.tap("ArrowRight"), p.tap("ArrowRight");
  check("no wrap at the end, the menu button included", p.focused(), "format-item-2");
  p.tap("Home");
  check("Home", p.focused(), "format-item-0");
  p.tap("End");
  check("End", p.focused(), "format-item-2");
  p.tap("ArrowLeft");
  check("the toolbar is one stop", p.input.focus.tabOrder().filter((id) => id.startsWith("format-")), ["format-item-1"]);
  p.tap("Shift+Tab");
  check("Shift+Tab leaves it for the slider", p.focused(), "volume-thumb");
  p.tap("Tab");
  check("memory: Tab back in lands on the item left last (the second), not the first", p.focused(), "format-item-1");
  p.tap("Tab");
  check("Tab out of the toolbar goes on to the tree", p.focused(), "settings-item-1");
  p.tap("Tab");
  check("Tab out of the tree, the last stop, releases focus", p.focused(), null);
  p.tap("Shift+Tab");
  check("Shift+Tab comes back to the tree", p.focused(), "settings-item-1");
  p.tap("Shift+Tab");
  check("memory the other way too", p.focused(), "format-item-1");
  p.tap("Home");
  check("nothing is on", p.styled(s.ledOn), 0);
  p.tap("Enter");
  check("Enter toggles a plain item (on key down)", p.styled(s.ledOn), 1);
  p.tap(" ");
  check("Space toggles it back", p.styled(s.ledOn), 0);
  p.click("format-item-0");
  check("a click focuses and toggles", [p.focused(), p.styled(s.ledOn)], ["format-item-0", 1]);
  p.tap("Shift+Tab"), p.tap("Tab");
  check("memory follows a click", p.focused(), "format-item-0");
}

// --- the toolbar's menu button: it carries aria-haspopup, Down/Up/Enter/Space open its menu on the first/last radio,
// its arrows and Home/End move and wrap, Enter picks and closes, Escape closes and returns focus to the item, Tab closes
// and goes on, the chosen size shows in the item's label, and the menu is a float under the item
{
  const p = fresh();
  const RING = "90,170,255,255";
  const menuItemRing = (index: number) => {
    const [x, y, , h] = p.box(`size-item-${index}`) as unknown as number[];
    return p.pixel(x! + 1, y! + h! / 2);
  };
  for (let n = 0; n < 11; n++) p.tap("Tab");
  p.tap("ArrowRight"), p.tap("ArrowRight");
  check("on the menu button", p.focused(), "format-item-2");
  check("the menu button carries aria-haspopup", p.prop("format-item-2", "hasPopup"), "menu");
  check("its label shows the current value", p.texts().includes("Size: Medium"), true);
  check("the menu is closed", [p.exists("size-menu"), p.prop("format-item-2", "expanded")], [false, false]);
  p.tap("ArrowDown");
  check("ArrowDown opens the menu", [p.exists("size-menu"), p.prop("format-item-2", "expanded")], [true, true]);
  check("opened on the first radio (Small), the menu has the ring", [p.texts().includes("Small"), menuItemRing(0)], [true, RING]);
  check("the menu button's own ring is off while the menu is open", p.pixel(p.box("format-item-2")[0]! + 1, p.box("format-item-2")[1]! + 20), "36,40,52,255");
  const menu = p.box("size-menu") as unknown as number[];
  const item = p.box("format-item-2") as unknown as number[];
  check("the menu floats under its item, from the item's left edge", [menu[0]!.toFixed(1), menu[1]!.toFixed(1)], [item[0]!.toFixed(1), (item[1]! + item[3]! + 4).toFixed(1)]);
  check(
    "the menu is inside the window (not clipped)",
    [menu[0]! >= 0, menu[0]! + menu[2]! <= size.width, menu[1]! + menu[3]! <= size.height],
    [true, true, true],
  );
  p.tap("ArrowDown");
  check("ArrowDown moves to the second", menuItemRing(1), RING);
  p.tap("ArrowDown"), p.tap("ArrowDown");
  check("Down wraps to the first", menuItemRing(0), RING);
  p.tap("ArrowUp");
  check("Up wraps to the last", menuItemRing(2), RING);
  p.tap("Home");
  check("Home", menuItemRing(0), RING);
  p.tap("End");
  check("End", menuItemRing(2), RING);
  p.tap("Enter");
  check("Enter picks the size and closes the menu", [p.exists("size-menu"), p.texts().includes("Size: Large")], [false, true]);
  check("Escape's counterpart: focus is on the menu button again, ringed", [p.focused(), p.pixel(p.box("format-item-2")[0]! + 1, p.box("format-item-2")[1]! + 20)], ["format-item-2", RING]);
  // Enter opens it too, and Escape closes it and returns focus to the item
  p.tap("Enter");
  check("Enter opens the menu", p.exists("size-menu"), true);
  p.tap("Escape");
  check("Escape closes it, focus back on the item", [p.exists("size-menu"), p.focused()], [false, "format-item-2"]);
  // Up opens on the last radio
  p.tap("ArrowUp");
  check("Up opens on the last radio", menuItemRing(2), RING);
  p.tap("Escape");
  // Tab closes the menu and goes on through the focus manager
  p.tap("ArrowDown"), p.tap("Tab");
  check("Tab closes the menu and moves on", [p.exists("size-menu"), p.focused()], [false, "settings-item-1"]);
  p.tap("Shift+Tab");
  // a click on the item toggles the menu; a click on a radio picks it and closes
  p.click("format-item-2");
  check("a click opens the menu", p.exists("size-menu"), true);
  p.click("size-item-1");
  check("a click picks Medium and closes", [p.exists("size-menu"), p.texts().includes("Size: Medium")], [false, true]);
  check("the menu takes the press: focus stays on the item, not on the tree under the float", p.focused(), "format-item-2");
  // a click elsewhere closes it
  p.click("format-item-2");
  p.click("wifi");
  check("a click on another widget leaves the menu behind", p.exists("size-menu"), false);
  check("the toolbar is still one stop with the menu button in it", p.input.focus.tabOrder().filter((id) => id.startsWith("format-")), ["format-item-2"]);
}

// --- the tree: one Tab stop, entered at the first visible node; the arrows walk the visible rows only (a collapsed
// subtree's node is skipped); Right opens and steps in, Left closes and steps to the parent; Home and End; Space selects
// and moves nothing; the ring is on the roving row
{
  const p = fresh();
  const stop = () => p.input.focus.tabOrder().filter((id) => id.startsWith("settings-item"));
  const rows = () => p.labels(/^settings-item-\d+$/);
  // the ring on a row's left edge, as the other rows' ring is read
  const ring = (id: string) => {
    const [x, y, , h] = p.box(id) as unknown as number[];
    return p.pixel(x! + 1, y! + h! / 2);
  };
  check("the tree is one Tab stop", stop(), ["settings-item-1"]);
  check(
    "at rest: Network open with its two children, Display closed, Storage after it",
    rows(),
    ["-Network", "Wi-Fi", "Bluetooth", "+Display", "Storage"],
  );
  check("a collapsed subtree's node is not rendered", p.texts().includes("Brightness"), false);
  check("nothing is selected at first", p.styled(s.labelSelected), 0);

  for (let n = 0; n < 12; n++) p.tap("Tab");
  check("Tab enters the tree at the first visible node", p.focused(), "settings-item-1");
  check("the ring is on the entry row", ring("settings-item-1"), "90,170,255,255");
  p.tap("ArrowDown");
  check("ArrowDown moves without selecting", [p.focused(), p.styled(s.labelSelected)], ["settings-item-2", 0]);
  check("the ring follows the roving row", [ring("settings-item-2"), ring("settings-item-1")], ["90,170,255,255", "16,18,24,255"]);
  p.tap("ArrowDown"), p.tap("ArrowDown"), p.tap("ArrowDown");
  check("Down skips the closed subtree's Brightness and lands on Storage", p.focused(), "settings-item-6");
  p.tap("ArrowDown");
  check("Down clamps at the last visible node", p.focused(), "settings-item-6");
  p.tap("ArrowUp");
  check("Up goes back a visible node", p.focused(), "settings-item-4");
  p.tap("Home");
  check("Home: the first visible node", p.focused(), "settings-item-1");
  p.tap("End");
  check("End: the last visible node", p.focused(), "settings-item-6");

  // Right on the closed Display opens it and stays on it; a second Right steps into Brightness
  p.tap("Home"), p.tap("ArrowDown"), p.tap("ArrowDown"), p.tap("ArrowDown");
  check("on Display", p.focused(), "settings-item-4");
  p.tap("ArrowRight");
  check("Right opens Display", [p.focused(), p.texts().includes("Brightness")], ["settings-item-4", true]);
  check("its mark turns from '+' to '-' and the child row appears after it", rows(), ["-Network", "Wi-Fi", "Bluetooth", "-Display", "Brightness", "Storage"]);
  const [display, brightness, storage] = ["settings-item-4", "settings-item-5", "settings-item-6"].map(
    (id) => p.box(id) as unknown as number[],
  );
  check(
    "Brightness is rendered between Display and Storage",
    brightness![1]! >= display![1]! + display![3]! && brightness![1]! + brightness![3]! <= storage![1]!,
    true,
  );
  check(
    "a child's content is indented a step under its parent's, and its row still spans the page",
    [p.box("settings-item-5-mark")[0]! - p.box("settings-item-4-mark")[0]!, p.box("settings-item-5")[2]],
    [18, 280],
  );
  p.tap("ArrowRight");
  check("a second Right steps into the first child", p.focused(), "settings-item-5");
  p.tap("ArrowDown");
  check("and Down goes on to Storage", p.focused(), "settings-item-6");
  p.tap("ArrowDown");
  check("Down stays at the end now", p.focused(), "settings-item-6");
  p.tap("ArrowUp");
  check("Up walks the opened child", p.focused(), "settings-item-5");
  p.tap("ArrowLeft");
  check("Left on a leaf steps to its parent", [p.focused(), p.texts().includes("Brightness")], ["settings-item-4", true]);
  p.tap("ArrowLeft");
  check("Left on the open parent closes it and stays on it", [p.focused(), p.texts().includes("Brightness")], ["settings-item-4", false]);

  // Space selects the roving node; the selected row is the surface fill in the accent, and focus does not move
  p.tap(" ");
  check("Space selects the focused node", [p.styled(s.labelSelected), p.focused()], [1, "settings-item-4"]);
  check(
    "the selected row is filled and still ringed",
    [ring("settings-item-4"), p.pixel(p.box("settings-item-4")[0]! + 200, p.box("settings-item-4")[1]! + 12)],
    ["90,170,255,255", "36,40,52,255"],
  );
  p.tap("ArrowDown");
  check("moving does not move the selection", [p.focused(), p.styled(s.labelSelected)], ["settings-item-6", 1]);

  // a hidden node is neither an arrow's nor a Tab stop: select Brightness, close Display over it, then Tab out and back
  p.tap("Home"), p.tap("ArrowDown"), p.tap("ArrowDown"), p.tap("ArrowDown"), p.tap("ArrowRight"), p.tap("ArrowRight");
  check("on Brightness", p.focused(), "settings-item-5");
  p.tap(" ");
  check("Brightness is the selection", p.styled(s.labelSelected), 1);
  p.tap("ArrowLeft"), p.tap("ArrowLeft");
  check("Display closed again, Brightness hidden but selected", [p.focused(), p.texts().includes("Brightness")], ["settings-item-4", false]);
  check("the group's stop is still the first visible node", stop(), ["settings-item-1"]);
  p.tap("Tab");
  check("the tree is the last stop: Tab releases focus", p.focused(), null);
  p.tap("Shift+Tab");
  check("Shift+Tab enters at the first visible node, not at the hidden selection", p.focused(), "settings-item-1");

  // a click on a row focuses and selects it; a leaf has no expansion to toggle
  p.click("settings-item-6");
  check("a click focuses and selects a leaf", [p.focused(), p.styled(s.labelSelected), p.texts().includes("Brightness")], ["settings-item-6", 1, false]);
  p.click("settings-item-4");
  check("a click on Display opens it and selects it", [p.focused(), p.texts().includes("Brightness")], ["settings-item-4", true]);
}

// --- keys nobody takes go to the page
{
  const p = fresh();
  p.tap("t");
  p.tap("Tab");
  p.tap("ArrowRight"); // nothing is focused: not a move, the page gets it
  p.tap("Escape");
  check("unhandled keys reach the page", p.unhandled.filter((k) => k !== "Tab"), ["t", "ArrowRight", "Escape"]);
}

// --- SDL's keys as names
{
  check("Tab", keyName(9), "Tab");
  check("Shift+Tab", keyName(9, 0x1), "Shift+Tab");
  check("right Shift+Tab", keyName(9, 0x2), "Shift+Tab");
  check("Space", keyName(32), " ");
  check("Enter, keypad Enter", [keyName(13), keyName(0x40000058)], ["Enter", "Enter"]);
  check("Escape", keyName(27), "Escape");
  check("arrows", [0x40000050, 0x4000004f, 0x40000052, 0x40000051].map((k) => keyName(k)), ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  check("Home, End", [keyName(0x4000004a), keyName(0x4000004d)], ["Home", "End"]);
  check("a letter", keyName(116), "t");
  check("Cmd+t and Ctrl+Tab are nobody's", [keyName(116, 0x400), keyName(9, 0x40)], [undefined, undefined]);
  check("Shift+ArrowRight is not a move", keyName(0x4000004f, 0x1), undefined);
  check("an unknown key", keyName(0x40000039), undefined);
}

dispose();
if (failed) process.exit(1);
console.log(
  "solid/widgets.test.ts: Tab order, key timing, clicks and focus, the disabled box, select all, the disclosure, radio, tabs, slider, toolbar, tree",
);
process.exit(0);
