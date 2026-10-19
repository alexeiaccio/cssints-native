// What the stored frames of the Widgets page cannot show: the Tab order and Shift+Tab, when each key acts, what a click
// does to a widget and to focus, the disabled checkbox, "Select all" over its two children, the disclosure, and how an
// SDL key becomes a name. Frames are driven as the window does it: pointer and keys in, then one frame.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput, keyName } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Widgets } = await import("./app/Widgets.tsx");
const s = await import("./app/widgets.styles.ts");

ui.init(360, 440);
ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) failed++, console.error(`FAIL ${what}: ${a}, wanted ${b}`);
};

// the page as the window runs it: a fresh page each time, the pointer remembered between frames
let dispose = () => {};
function fresh() {
  dispose();
  const root = new El("root");
  const input = createInput();
  const unhandled: string[] = [];
  input.fallback = (name) => (unhandled.push(name), name === "t");
  dispose = render(() => Widgets({ input }), root);
  const frame = createFrame(root, { onPressMiss: () => input.pressMiss() });
  let at = [-1, -1];
  const step = (down = false) => frame(at[0]!, at[1]!, down, 1 / 60);
  step(), step();

  const find = (pred: (el: El) => boolean, from: El = root): El[] =>
    from.children.flatMap((c) => (c instanceof El ? [...(pred(c) ? [c] : []), ...find(pred, c)] : []));
  const styled = (style: object) => find((el) => el.props.style === style).length;
  const text = (el: El): string => el.children.map((c) => (c instanceof Txt ? c.text : text(c))).join("");
  const label = () => find((el) => el.tag === "text" && /^Presses/.test(text(el))).map(text)[0];
  const box = (id: string) => ui.bounds(Buffer.from(id))!;
  return {
    input,
    unhandled,
    styled,
    label,
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
    click(id: string) {
      this.move(id);
      this.press();
      this.release();
    },
    pixel: (x: number, y: number) => ui.pixel(x, y).join(","),
    box,
  };
}

// --- the Tab order: button, switch, select all, wired, wireless, the trigger; the disabled box is skipped
{
  const p = fresh();
  const walk = (key: string, n: number) => Array.from({ length: n }, () => (p.tap(key), p.focused()));
  check(
    "Tab order",
    walk("Tab", 8),
    ["press", "wifi", "all", "wired", "wireless", "more-trigger", null, "press"],
  );
  check("Shift+Tab reverses (after one back from the first, focus is released)", walk("Shift+Tab", 2), [null, "more-trigger"]);
  check(
    "Shift+Tab order",
    walk("Shift+Tab", 6),
    ["wireless", "wired", "all", "wifi", "press", null],
  );
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

// --- contrast: the ink on every fill a button or a row can have, in both themes (WCAG 2: at least 4.5:1)
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
    for (const [name, style] of [["button", s.button], ["row", s.row]] as const) {
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

// --- keys nobody takes go to the page
{
  const p = fresh();
  p.tap("t");
  p.tap("Tab");
  p.tap("ArrowRight"); // no group on this page: the manager does not own it, the switch does not take it
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
console.log("solid/widgets.test.ts: Tab order, key timing, clicks and focus, the disabled box, select all, the disclosure");
process.exit(0);
