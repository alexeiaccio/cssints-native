// What the stored frames of the Widgets page cannot show: the Tab order and Shift+Tab over the whole page, when each key
// acts, what a click does to a widget and to focus, the disabled checkbox, "Select all" over its two children, the
// disclosure, the four groups (radio, tabs, slider, toolbar: one Tab stop each, arrows, clamping, memory, a disabled
// radio, a press on the slider's rail), and how an SDL key becomes a name. Frames are driven as the window does it:
// pointer and keys in, then one frame.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput, keyName } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Widgets, size } = await import("./app/Widgets.tsx");
const s = await import("./app/widgets.styles.ts");

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
  const unhandled: string[] = [];
  input.fallback = (name) => (unhandled.push(name), name === "t");
  dispose = render(() => Widgets({ input, ...options }), root);
  const frame = createFrame(root, { onPressMiss: () => input.pressMiss() });
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
    /** a key pressed and released with a frame after each, as an event loop delivers them */
    down: (name: string, repeat = false) => (input.down(name, repeat), step()),
    up: (name: string) => (input.up(name), step()),
    tap(name: string) {
      this.down(name);
      this.up(name);
    },
    move: (id: string, dx = 0.5, dy = 0.5) => {
      const b = box(id);
      at = [b[0]! + b[2]! * dx, b[1]! + b[3]! * dy];
      step();
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
    box,
  };
}

// --- the Tab order over the whole page: button, switch, select all, wired, wireless, the trigger (the disabled box is
// skipped), then each group once: radio (the checked one), the selected tab, its panel, the slider, the toolbar
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
];
{
  const p = fresh();
  const walk = (key: string, n: number) => Array.from({ length: n }, () => (p.tap(key), p.focused()));
  check("the stops the manager has, in document order", p.input.focus.tabOrder(), ORDER);
  check("Tab order", walk("Tab", ORDER.length + 2), [...ORDER, null, "press"]);
  check("Shift+Tab reverses (after one back from the first, focus is released)", walk("Shift+Tab", 2), [null, "format-item-0"]);
  check("Shift+Tab order", walk("Shift+Tab", ORDER.length - 1), ORDER.slice(0, -1).reverse());
  check("and releases focus past the first", walk("Shift+Tab", 1), [null]);
}

// --- the page fits its window, with the disclosure open too: as wide as the window (a row too wide widens the root and
// shifts everything), and the last widget ends above the root's bottom padding (a page too tall for the window makes
// Clay shrink the panel)
{
  const p = fresh();
  const fits = (what: string) => {
    const last = p.box("format-item-2");
    check(`${what}: the root is the window's width`, p.box("Root")[2], size.width);
    check(`${what}: the toolbar ends inside the page`, last[1]! + last[3]! <= size.height - 24, true);
  };
  fits("closed");
  p.click("more-trigger");
  fits("disclosure open");
  check("the open panel is not shrunk (two lines and its padding: 52.8)", p.box("more-panel")[3]!.toFixed(1), "52.8");
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
    ] as const) {
      const base = themed(style as Shape, theme);
      for (const state of ["", ":hover", ":active"]) {
        const fill = ((state ? (base[state] as Shape) : base).backgroundColor ?? page) as Rgb;
        const r = ratio(ink, fill);
        if (r < 4.5) failed++, console.error(`FAIL contrast ${name}${state} ${theme ?? "dark"}: ${r.toFixed(2)}:1`);
      }
    }
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

// --- the slider: the keys step, page, jump to the ends, and stop at them; a press on the rail sets the value
{
  const p = fresh();
  const knobAt = () => (p.box("volume-thumb")[0]! - p.box("volume-rail")[0]!).toFixed(1);
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
  p.click("volume-thumb", 0.5);
  check("a press on the knob's middle keeps its value", p.volume(), "50%");
  p.away(), p.press(), p.release();
  check("empty space blurs it", p.focused(), null);
}

// --- the toolbar: arrows and Home/End move (no wrap), Tab back in lands on the item left last; Enter and Space toggle
{
  const p = fresh();
  for (let n = 0; n < 11; n++) p.tap("Tab");
  check("Tab reaches the toolbar on the first item", p.focused(), "format-item-0");
  p.tap("ArrowLeft");
  check("no wrap at the start", p.focused(), "format-item-0");
  p.tap("ArrowRight");
  check("ArrowRight: the next item", p.focused(), "format-item-1");
  p.tap("ArrowRight"), p.tap("ArrowRight");
  check("no wrap at the end", p.focused(), "format-item-2");
  p.tap("Home");
  check("Home", p.focused(), "format-item-0");
  p.tap("End");
  check("End", p.focused(), "format-item-2");
  p.tap("ArrowDown");
  check("ArrowDown is not a key of a horizontal toolbar", [p.focused(), p.unhandled.includes("ArrowDown")], ["format-item-2", true]);
  p.tap("ArrowLeft");
  check("the toolbar is one stop", p.input.focus.tabOrder().filter((id) => id.startsWith("format-")), ["format-item-1"]);
  p.tap("Shift+Tab");
  check("Shift+Tab leaves it for the slider", p.focused(), "volume-thumb");
  p.tap("Tab");
  check("memory: Tab back in lands on the item left last (the second), not the first", p.focused(), "format-item-1");
  p.tap("Tab");
  check("Tab out of the last stop releases focus", p.focused(), null);
  p.tap("Shift+Tab");
  check("memory the other way too", p.focused(), "format-item-1");
  check("nothing is on", p.styled(s.ledOn), 0);
  p.tap("Enter");
  check("Enter toggles the item (on key down)", p.styled(s.ledOn), 1);
  p.tap(" ");
  check("Space toggles it back", p.styled(s.ledOn), 0);
  p.click("format-item-2");
  check("a click focuses and toggles", [p.focused(), p.styled(s.ledOn)], ["format-item-2", 1]);
  p.tap("Shift+Tab"), p.tap("Tab");
  check("memory follows a click", p.focused(), "format-item-2");
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
  "solid/widgets.test.ts: Tab order, key timing, clicks and focus, the disabled box, select all, the disclosure, radio, tabs, slider, toolbar",
);
process.exit(0);
