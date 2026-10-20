// What the stored frames of the Text field page cannot show: typed text reaching only the focused field, the theme
// shortcut while no field has focus, the caret's and the selection's pixels at the right x, a press placing the caret,
// Backspace and Delete, a selection replaced, maxLength, the read-only field refusing edits, submit. Driven as the
// window does it: pointer, keys and typed text in, then one frame.
import "./plugin.ts";

const { ui } = await import("./src/ffi.ts");
const { createFrame } = await import("./src/frame.ts");
const { createInput } = await import("./src/input.ts");
const { El, render, Txt } = await import("./src/renderer.ts");
const { Field, size } = await import("./app/Field.tsx");

ui.init(size.width, size.height);
ui.font(new URL("../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname);

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) failed++, console.error(`FAIL ${what}: ${a}, wanted ${b}`);
};

// the theme the field page's styles take, as `main.ts` keeps it
let theme: string | undefined;
let dispose = () => {};
function fresh() {
  dispose();
  theme = undefined;
  const root = new El("root");
  const input = createInput();
  const unhandled: string[] = [];
  // the host's page shortcut, exactly as main.ts sets it: `t` flips the theme only while no text field has focus
  input.fallback = (name) => {
    unhandled.push(name);
    return name === "t" && !input.editing() ? ((theme = theme ? undefined : "light"), true) : false;
  };
  dispose = render(() => Field({ input }), root);
  const frame = createFrame(root, {
    get theme() {
      return theme;
    },
    onPressMiss: () => input.pressMiss(),
  });
  let at = [-1, -1];
  const step = (down = false) => frame(at[0]!, at[1]!, down, 1 / 60);
  step(), step();

  const find = (pred: (el: El) => boolean, from: El = root): El[] =>
    from.children.flatMap((c) => (c instanceof El ? [...(pred(c) ? [c] : []), ...find(pred, c)] : []));
  const text = (el: El): string => el.children.map((c) => (c instanceof Txt ? c.text : text(c))).join("");
  const texts = () => find((el) => el.tag === "text").map(text);
  const line = (id: string) => text(find((el) => el.props.id === id)[0]!);
  const readout = () => texts().find((t) => t.startsWith("Value: "))!;
  const value = () => JSON.parse(readout().slice(7, readout().lastIndexOf(" (")));
  const submitted = () => texts().find((t) => t.startsWith("Submitted: ") || t === "Nothing submitted yet")!;
  const box = (id: string) => [...ui.bounds(Buffer.from(id))!];
  const pixel = (x: number, y: number) => ui.pixel(Math.floor(x), Math.floor(y));
  /** The brightest of the two pixels a 1px run at a fractional x can cover: its colour, or [0,0,0,0]. */
  const inkAt = (x: number, y: number) => {
    const [a, b] = [pixel(x, y), pixel(x + 1, y)];
    return a[0]! + a[1]! + a[2]! >= b[0]! + b[1]! + b[2]! ? a : b;
  };

  return {
    input,
    unhandled,
    root,
    theme: () => theme,
    readout,
    value,
    submitted,
    line,
    texts,
    box,
    pixel,
    inkAt,
    focused: () => input.focus.focused(),
    editing: () => input.editing(),
    /** a key pressed and released with a frame after each */
    down: (name: string, repeat = false) => (input.down(name, repeat), step()),
    up: (name: string) => (input.up(name), step()),
    tap(name: string) {
      this.down(name);
      this.up(name);
    },
    /** typed characters, as an SDL TEXT_INPUT event delivers them: not a key */
    typed(input_: string) {
      input.textInput(input_);
      step();
    },
    /** Tab until the field `id` has focus (the page has four stops) */
    tabTo(id: string) {
      for (let n = 0; n < 5 && this.focused() !== id; n++) this.tap("Tab");
      check(`Tab reaches ${id}`, this.focused(), id);
    },
    clickAt(x: number, y: number) {
      at = [x, y];
      step();
      step(true);
      step(false);
    },
    click(id: string, dx = 0.5, dy = 0.5) {
      const b = box(id);
      this.clickAt(b[0]! + b[2]! * dx, b[1]! + b[3]! * dy);
    },
  };
}

// --- typing reaches the focused field and nothing else on the page
{
  const p = fresh();
  check("nothing is focused at first", p.focused(), null);
  p.tabTo("name");
  p.typed("Ada");
  check("the field took the text", p.readout(), 'Value: "Ada" (3)');
  check("the command button's count did not change", p.texts().includes("Presses: 0"), true);
  check("and the read-only field is untouched", p.line("mail-line"), "ada@example.com");

  p.tabTo("mail");
  p.typed("Z");
  check("typing into the read-only field changes nothing", p.readout(), 'Value: "Ada" (3)');
  check("and its own text is unchanged", p.line("mail-line"), "ada@example.com");
  check("a read-only field takes no text input", p.editing(), false);
}

// --- the page's theme key: not while a field is focused, again once Escape blurs it
{
  const p = fresh();
  p.tabTo("name");
  check("a text field has focus", p.editing(), true);
  p.tap("t");
  check("`t` is not taken by the field", p.unhandled.includes("t"), true);
  check("and does not flip the theme while the field has focus", p.theme(), undefined);
  check("the caret stayed in the field", p.focused(), "name");

  p.tap("Escape");
  check("Escape blurs the field", [p.focused(), p.editing()], [null, false]);
  p.tap("t");
  check("`t` flips the theme once nothing is being typed into", p.theme(), "light");
}

// --- the caret: at the right x, 1px wide, drawn in the ink; the arrows move it
{
  const p = fresh();
  p.tabTo("name");
  p.typed("Ada");
  const line = p.box("name-line");
  const end = p.box("name-line-caret");
  check("the caret is 1px wide", end[2], 1);
  check("after typing the caret is after the last character", end[0], line[0]! + line[2]! - 1);
  const ink = p.inkAt(end[0]!, end[1]! + 9);
  check("and it is drawn in the ink colour", ink[0]! > 200 && ink[1]! > 200 && ink[2]! > 200, true);
  const before = p.pixel(line[0]! - 6, end[1]! + 9);
  check("the field around it is the surface", before.slice(0, 3), [36, 40, 52]);

  p.tap("Home");
  const start = p.box("name-line-caret");
  check("Home puts the caret at the start of the run", start[0], line[0]);
  p.tap("ArrowRight");
  const one = p.box("name-line-caret");
  p.tap("ArrowRight");
  const two = p.box("name-line-caret");
  check("each ArrowRight moves it a character right", [one[0]! > start[0]!, two[0]! > one[0]!], [true, true]);
  check("and it stops at the end", (p.tap("ArrowRight"), p.box("name-line-caret")[0]), line[0]! + line[2]! - 1);
}

// --- the selection: a tinted run between the anchor and the caret, at their x
{
  const p = fresh();
  p.tabTo("name");
  p.typed("Ada");
  p.tap("Home");
  p.tap("ArrowRight");
  const one = p.box("name-line-caret")[0]!;
  p.tap("ArrowRight");
  const two = p.box("name-line-caret")[0]!;
  p.tap("Shift+ArrowLeft");
  check("Shift+ArrowLeft leaves the caret at the anchor's side", p.box("name-line-caret")[0], one);
  const run = p.box("name-line-selection");
  // the caret is a 1px box in the row and costs that 1px of layout, so the run starts just after it
  check("the selection starts at the character after the caret", run[0], one + 1);
  check("and is as wide as the one character it covers", run[2], two - one);
  const tint = p.pixel(run[0]! + run[2]! / 2, run[1]! + 2);
  const plain = p.pixel(p.box("name-line")[0]! + 150, run[1]! + 2);
  check("the field beyond the text is the surface", plain.slice(0, 3), [36, 40, 52]);
  check("the selection is tinted over it", tint[0]! - tint[2]! > 20 && plain[0]! - plain[2]! < 0, true);

  p.tap("Shift+ArrowLeft");
  const wide = p.box("name-line-selection");
  const line0 = p.box("name-line");
  // the caret is at the start now, so it sits before the run: the run is 1px right of the line and 1px longer than
  // the two characters measured with the caret after them
  check(
    "a second Shift+ArrowLeft widens it to both characters, just after the caret",
    [wide[2]! > run[2]!, wide[0]!], [true, line0[0]! + 1],
  );
  check("and it ends 1px past where the caret was", wide[0]! + wide[2]!, two + 1);
  p.typed("X");
  check("typing replaces the selection", p.readout(), 'Value: "Xa" (2)');
}

// --- Backspace, Delete and maxLength
{
  const p = fresh();
  p.tabTo("name");
  p.typed("Ada");
  p.tap("Backspace");
  check("Backspace removes the character before the caret", p.readout(), 'Value: "Ad" (2)');
  p.tap("Home");
  check("the caret is at the start", p.box("name-line-caret")[0], p.box("name-line")[0]);
  p.tap("Delete");
  check("Delete removes the character after the caret", p.readout(), 'Value: "d" (1)');
  p.tap("End");
  p.tap("Delete");
  check("Delete at the end leaves the text", p.readout(), 'Value: "d" (1)');
}

// --- maxLength
{
  const p = fresh();
  p.tabTo("name");
  p.typed("abcdefghijklmnopqrstuvwxyz0123");
  check("the field stops at its maxLength of 24", p.readout(), 'Value: "abcdefghijklmnopqrstuvwx" (24)');
  p.typed("y");
  check("and takes nothing more", p.readout(), 'Value: "abcdefghijklmnopqrstuvwx" (24)');
}

// --- a press inside the text places the caret; a press on the read-only field moves its caret too
{
  const p = fresh();
  p.tabTo("name");
  p.typed("Ada");
  const line = p.box("name-line");
  const y = line[1]! + line[3]! / 2;
  p.clickAt(line[0]! + 2, y);
  check("a click at the start of the run puts the caret there", p.box("name-line-caret")[0], line[0]);
  p.clickAt(line[0]! + line[2]! - 2, y);
  check("a click at the far edge puts it at the end", p.box("name-line-caret")[0], line[0]! + line[2]! - 1);
  check("and the text is unchanged", p.readout(), 'Value: "Ada" (3)');
}

// --- submit: Enter in the field, and the Submit button; each shows the value once
{
  const p = fresh();
  p.tabTo("name");
  check("nothing submitted yet", p.submitted(), "Nothing submitted yet");
  p.typed("Ada");
  p.tap("Enter");
  check("Enter submits the field's text", p.submitted(), "Submitted: Ada");
  check("and leaves the caret in the field", p.focused(), "name");
  p.tap("Enter");
  check("a second Enter shows it once, not twice", p.submitted(), "Submitted: Ada");
  p.typed("!");
  check("typing after a submit does not submit again", p.submitted(), "Submitted: Ada");
  p.tabTo("submit");
  p.tap("Enter");
  check("the Submit button submits the current text", p.submitted(), "Submitted: Ada!");
}

// --- the page fits its window in its tallest state, and its four stops are the page's
{
  const p = fresh();
  p.tabTo("name");
  p.typed("Ada");
  p.tap("Enter");
  const root = p.box("Root");
  check("the page is the window wide", [root[0], root[2]], [0, size.width]);
  check("and its content fits its height", root[3]! <= size.height, true);
  const mail = p.box("mail");
  check("the read-only field's row is below the readout", mail[1]! > p.box("name")[1]!, true);
  const order: (string | null)[] = [];
  p.tap("Escape");
  for (let n = 0; n < 5; n++) (p.tap("Tab"), order.push(p.focused()));
  check("Tab walks press, name, mail, submit and then releases focus", order, [
    "press",
    "name",
    "mail",
    "submit",
    null,
  ]);
}

dispose();
if (failed) process.exit(1);
console.log(
  "solid/field.test.ts: typing to the focused field, the theme key, the caret and selection pixels, the arrows, " +
    "Backspace and Delete, maxLength, presses, read-only, submit, the page fitting",
);
process.exit(0);
