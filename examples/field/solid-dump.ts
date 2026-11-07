// The Solid Text field page's own frame at the three states examples/field/gen.c dumps, as the reference the generated
// C is compared with (dump-check.ts): the page through the host's own loop — `ui_init`, the font, the page's `input`,
// 31 frames at rest and one frame an input, exactly `main.ts form --warm 30` — and `ui_dump_json`'s data, the emitter
// every golden in solid/goldens is stored with.
//
//   bun examples/field/solid-dump.ts <out dir>     solid-empty.json, solid-typed.json, solid-selection.json
//
// The page's state is its text field's, not a signal the page exports: the field's value, caret and selection live in
// `createTextField` behind `input`. So a state is its input — the row's press (the focus manager's), typed text (SDL's
// TEXT_INPUT, what `main.ts`'s `text:Ada` key stands for) and the keys — and examples/field/states.json is the same
// three scripts the generator replays. The stored pixel frames these agree with are taken by the same sequence:
// `field-empty` is Tab,Tab, `field-typed` Tab,Tab,text:Ada and `field-selection` two Shift+ArrowLeft more.
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
const { Field, size } = await import("../../solid/app/Field.tsx");

const WARM = 31; // `main.ts form --warm 30`: 30 rest frames and the one the frame is written on

const font = new URL("../../vendor/fonts/Roboto-Regular.ttf", import.meta.url).pathname;
if (ui.init(size.width, size.height) || ui.font(font) < 0) throw new Error("ui_init or ui_font failed (thorvg? build/solid)");

/** One state as the page's loop makes it: a fresh page, 31 rest frames, then the state's inputs one frame each. */
function capture(drive: (page: Page) => void): Page {
  const input = createInput();
  const root = new El("root");
  const dispose = render(() => Field({ input }), root);
  const frame = createFrame(root, { onPressMiss: () => input.pressMiss() });
  const page: Page = {
    root,
    dispose,
    step: () => frame(-1, -1, false, 1 / 60, false),
    tap(name) {
      input.down(name);
      input.up(name);
      page.step();
    },
    type(text) {
      input.textInput(text);
      page.step();
    },
  };
  for (let n = 0; n < WARM; n++) page.step();
  drive(page);
  return page;
}

interface Page {
  readonly root: InstanceType<typeof El>;
  readonly dispose: () => void;
  step(): void;
  /** A key down and up, and the frame after it, as `main.ts --keys` gives it. */
  tap(name: string): void;
  /** Typed characters, as SDL's TEXT_INPUT delivers them: not a key. */
  type(text: string): void;
}

function write(name: string, drive: (page: Page) => void): void {
  const page = capture(drive);
  const dump = dumpPage(page.root);
  writeFileSync(`${out}/solid-${name}.json`, `${format(dump)}\n`);
  console.log(`solid-${name}: ${dump.commands.length} commands`);
  page.dispose();
}

// the field's row is the second Tab stop (the command button is the first): the press puts the caret at 0
write("empty", (page) => {
  page.tap("Tab");
  page.tap("Tab");
});
// "Ada" is typed into the focused field: the caret ends after it
write("typed", (page) => {
  page.tap("Tab");
  page.tap("Tab");
  page.type("Ada");
});
// two Shift+ArrowLeft: the selection is "da" and the caret is at its start
write("selection", (page) => {
  page.tap("Tab");
  page.tap("Tab");
  page.type("Ada");
  page.tap("Shift+ArrowLeft");
  page.tap("Shift+ArrowLeft");
});
if (ui.errors()) throw new Error(`${ui.errors()} Clay errors`);
