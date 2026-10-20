// What the stored frames of the Dialog page cannot show: the trap (Tab cycles Cancel and OK and never reaches the page
// behind), Escape and Cancel closing without a write, OK writing the volume onto the page, a press on the backdrop doing
// nothing and not reaching the page under it, where Clay put the two floats (`ui.bounds`), and the menu's arrows, Escape
// and Enter. Driven as the window does: pointer and keys in, then one frame.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Dialog, size } = await import("./app/Dialog.tsx");

ui.init(size.width, size.height);
ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) failed++, console.error(`FAIL ${what}: ${a}, wanted ${b}`);
};

let dispose = () => {};
function fresh() {
  dispose();
  const root = new El("root");
  const input = createInput();
  const unhandled: string[] = [];
  input.fallback = (name) => (unhandled.push(name), false);
  dispose = render(() => Dialog({ input }), root);
  const frame = createFrame(root, { onPressMiss: () => input.pressMiss() });
  let at = [-1, -1];
  const step = (down = false) => frame(at[0]!, at[1]!, down, 1 / 60);
  step(), step();

  const find = (pred: (el: El) => boolean, from: El = root): El[] =>
    from.children.flatMap((c) => (c instanceof El ? [...(pred(c) ? [c] : []), ...find(pred, c)] : []));
  const text = (el: El): string => el.children.map((c) => (c instanceof Txt ? c.text : text(c))).join("");
  const texts = () => find((el) => el.tag === "text").map(text);
  const volume = () => texts().find((t) => t.startsWith("Volume:"))?.split(": ")[1];
  const zoom = () => texts().find((t) => /^\d+%$/.test(t));
  const box = (id: string) => ui.bounds(Buffer.from(id))!;
  return {
    input,
    unhandled,
    volume,
    zoom,
    focused: () => input.focus.focused(),
    open: () => find((el) => el.props.id === "settings-dialog").length > 0,
    menuOpen: () => find((el) => el.props.id === "zoom-menu").length > 0,
    exists: (id: string) => find((el) => el.props.id === id).length > 0,
    down: (name: string, repeat = false) => (input.down(name, repeat), step()),
    up: (name: string) => (input.up(name), step()),
    tap(name: string) {
      this.down(name);
      this.up(name);
    },
    /** open the settings dialog from the keyboard: Tab to its trigger (from wherever focus is), Enter */
    openDialog() {
      for (let n = 0; n < 4 && this.focused() !== "settings-trigger"; n++) this.tap("Tab");
      this.tap("Enter");
    },
    move: (id: string, dx = 0.5, dy = 0.5, down = false) => {
      const b = box(id);
      at = [b[0]! + b[2]! * dx, b[1]! + b[3]! * dy];
      step(down);
    },
    press: () => step(true),
    release: () => step(false),
    click(id: string) {
      this.move(id);
      this.press();
      this.release();
    },
    clickAt(x: number, y: number) {
      at = [x, y];
      step();
      step(true);
      step(false);
    },
    box,
  };
}

// --- opening by click and by keyboard: focus moves into the dialog, onto its first control
{
  const p = fresh();
  check("closed at first", [p.open(), p.focused()], [false, null]);
  p.click("settings-trigger");
  check("a click opens the dialog", p.open(), true);
  check("focus moves into the dialog, onto Cancel", p.focused(), "cancel");
  check("the page's line is unchanged", p.volume(), "40%");
  p.click("cancel");
  check("Cancel closes it", p.open(), false);
  check("focus returns to the trigger", p.focused(), "settings-trigger");
  check("and writes nothing", p.volume(), "40%");

  p.openDialog();
  check("Tab then Enter opens it", [p.open(), p.focused()], [true, "cancel"]);
  p.tap("Escape");
  check("Escape closes it", [p.open(), p.focused()], [false, "settings-trigger"]);
  check("Escape writes nothing", p.volume(), "40%");
}

// --- the trap: Tab and Shift+Tab cycle Cancel and OK and never reach the page's own controls
{
  const p = fresh();
  p.openDialog();
  const lap = ["cancel"];
  for (let n = 0; n < 5; n++) p.tap("Tab"), lap.push(p.focused() ?? "none");
  check("Tab cycles the dialog's two controls", lap, ["cancel", "ok", "cancel", "ok", "cancel", "ok"]);
  const back = [p.focused()];
  for (let n = 0; n < 3; n++) p.tap("Shift+Tab"), back.push(p.focused() ?? "none");
  check("Shift+Tab cycles back", back, ["ok", "cancel", "ok", "cancel"]);
  check("and the dialog is still open", p.open(), true);
  check("the page's trigger is not a stop while the dialog is open", lap.includes("settings-trigger"), false);
}

// --- OK writes the value onto the page
{
  const p = fresh();
  p.openDialog();
  p.tap("Tab");
  check("Tab reaches OK", p.focused(), "ok");
  p.tap("Enter");
  check("Enter on OK closes the dialog", p.open(), false);
  check("and writes 55% onto the page", p.volume(), "55% (just set)");
  check("focus is back on the trigger", p.focused(), "settings-trigger");
  p.click("settings-trigger");
  p.tap("Tab"), p.tap(" ");
  check("Space on Cancel closes without a write", [p.open(), p.volume()], [false, "55% (just set)"]);
}

// --- the backdrop: a press on it does nothing and does not reach the page behind it
{
  const p = fresh();
  p.openDialog();
  const before = p.focused();
  p.click("settings-trigger"); // the page's Open button, behind the backdrop
  check("a press on the backdrop leaves the dialog open", p.open(), true);
  check("and focus where it was", p.focused(), before);
  check("and does not press the page's button behind (the volume is untouched)", p.volume(), "40%");
  p.click("zoom-trigger"); // behind the dialog's panel: still no menu
  check("a press on the panel or the page behind opens no menu", p.menuOpen(), false);
}

// --- the floats: the backdrop covers the window; the dialog is centred on the root; the page keeps its layout
{
  const p = fresh();
  const root = [...p.box("Root")];
  const trigger = [...p.box("settings-trigger")];
  const zoom = [...p.box("zoom-trigger")];
  p.openDialog();
  check("the backdrop is the whole window", [...p.box("settings-backdrop")], [0, 0, size.width, size.height]);
  const dialog = p.box("settings-dialog");
  check("the dialog's centre is the root's centre (x)", dialog[0]! + dialog[2]! / 2, size.width / 2);
  check("the dialog's centre is the root's centre (y)", dialog[1]! + dialog[3]! / 2, size.height / 2);
  check("the page's root did not move", [...p.box("Root")], root);
  check("the page's trigger did not move behind the backdrop", [...p.box("settings-trigger")], trigger);
  check("the menu's trigger did not move behind the backdrop", [...p.box("zoom-trigger")], zoom);
}

// --- the menu: arrows, Home and End, Escape back to the trigger, Enter picks
{
  const p = fresh();
  p.tap("Tab"), p.tap("Tab");
  check("Tab reaches the menu trigger", p.focused(), "zoom-trigger");
  check("closed at first", [p.menuOpen(), p.zoom()], [false, "100%"]);
  p.tap("Enter");
  check("Enter opens the menu on the first item", [p.menuOpen(), p.focused()], [true, "zoom-item-0"]);
  p.tap("ArrowDown");
  check("ArrowDown moves", p.focused(), "zoom-item-1");
  p.tap("ArrowUp"), p.tap("ArrowUp");
  check("ArrowUp wraps to the last", p.focused(), "zoom-item-3");
  p.tap("ArrowDown");
  check("ArrowDown wraps to the first", p.focused(), "zoom-item-0");
  p.tap("End");
  check("End goes to the last", p.focused(), "zoom-item-3");
  p.tap("Home");
  check("Home goes to the first", p.focused(), "zoom-item-0");
  p.tap("Escape");
  check("Escape closes the menu", p.menuOpen(), false);
  check("and returns focus to the trigger", p.focused(), "zoom-trigger");
  check("nothing is picked yet", p.zoom(), "100%");

  p.tap("ArrowDown");
  check("ArrowDown on the trigger opens on the first", [p.menuOpen(), p.focused()], [true, "zoom-item-0"]);
  p.tap("ArrowDown"), p.tap("ArrowDown");
  check("to the third", p.focused(), "zoom-item-2");
  p.tap("Enter");
  check("Enter picks it and closes", [p.menuOpen(), p.zoom()], [false, "150%"]);
  check("and focus returns to the trigger", p.focused(), "zoom-trigger");

  p.click("zoom-trigger");
  check("a click opens the menu on the first item", [p.menuOpen(), p.focused()], [true, "zoom-item-0"]);
  p.click("zoom-item-1");
  check("a click picks and closes", [p.menuOpen(), p.zoom()], [false, "125%"]);

  // the panel hangs off the trigger's left-bottom corner, 4px down
  p.tap("Enter");
  const panel = p.box("zoom-menu");
  const trigger = p.box("zoom-trigger");
  check("the menu's left edge is the trigger's", panel[0], trigger[0]);
  check("the menu hangs below the trigger", panel[1], trigger[1]! + trigger[3]! + 4);
  p.tap("Escape");
  check("Escape closes it again", [p.menuOpen(), p.focused()], [false, "zoom-trigger"]);
}

dispose();
if (failed) process.exit(1);
console.log(
  "solid/dialog.test.ts: the modal trap, Escape and Cancel, OK's write, the backdrop, the floats' placement, the menu's keys",
);
process.exit(0);
