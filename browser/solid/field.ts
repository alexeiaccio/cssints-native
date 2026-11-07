// The Text field page in the browser: the desktop's app/Field.tsx unmodified (the neutral `createTextField` of
// headless/, its caret and its selection drawn as runs of text and 1px boxes), with its own createInput() on
// browser/solid/shell.ts — the loop, the pointer, the keys and window.__page as on the other pages.
//
// Typing is the DOM's, and it is the one thing a canvas cannot do for itself: it is no editable element, so it has no
// beforeinput, no input and no composition of its own — the printable characters come from the keydown's `key`, which is
// the string SDL's TEXTINPUT gives (`Input.textInput(text)`, the call the desktop's text events make), and the keys the
// focus manager's table drops stay keys.ts's (Tab, Shift+Tab, Backspace, Delete, the arrows, Home/End, Enter, Escape).
// Shift with Left, Right, Home or End is a selection chord, which `keyName` refuses as a move (`selectionChord`), and the
// page draws the selection it makes.
//
// An input method and the clipboard are text.ts's: Chromium's `EditContext` on the canvas (a hidden textarea where the
// browser has none), whose committed string comes in through the same `Input.textInput`, and Cmd/Ctrl+C/X/V/A on the
// focused field.
import "./globals.ts";

import { Field, size } from "../../solid/app/Field.tsx";
import type { Motion } from "../../solid/src/entry.ts";
import { createInput, type FieldView } from "../../solid/src/input.ts";
import { selectionChord } from "./keys.ts";
import { mountPage } from "./shell.ts";
import { attachText } from "./text.ts";

const input = createInput();
// one frame on the event, as a press and a key have: the shell's own
let frame = () => {};
let motion: Motion | undefined;

await mountPage({
  width: size.width,
  height: size.height,
  input,
  tree: (setup) => {
    frame = setup.immediate;
    motion = setup.motion;
    return () => Field({ input, motion: setup.motion });
  },
});

const canvas = document.getElementById("frame") as HTMLCanvasElement;
const text = attachText(canvas, input, () => frame());
// The IME's mirror of the field is the model's view of it, so it is brought up to date once a frame, in the page's tick
// (before the tree is declared: the boxes it feeds are the frame just drawn). `window.__page.field` is that model, which
// browser/ime-check.mjs compares the context's own text and caret with.
(window.__page as typeof window.__page & { field: () => FieldView | undefined }).field = () => text.field();
const tick = motion?.tick;
if (motion) motion.tick = (dt) => {
  tick?.(dt);
  text.sync();
};
text.sync();

// The typed text, beside the shell's key listener: the two do not overlap — `keyName` drops a selection chord and takes
// no character, and a printable key is a letter, a digit or a mark, not one of the keys it names. Cmd, Ctrl and Alt
// chords are text.ts's (the clipboard) or the browser's (as `keyName` decides), and a keydown inside a composition is the
// IME's, not a character. A character and a selection chord are `preventDefault`ed, as the shell's consumed keys are: the
// canvas is the focused element, and a typed character must not reach a browser accelerator (Chrome's type-to-find) while
// it is the page's.
canvas.addEventListener("keydown", (event) => {
  if (text.composing()) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const chord = selectionChord(event);
  if (chord !== undefined) {
    event.preventDefault();
    input.down(chord);
    frame();
    return;
  }
  // one code point of `key` (a surrogate pair is one character), and only from a key that is a character: "ArrowLeft",
  // "Tab" and the like are the shell's
  if ([...event.key].length !== 1) return;
  event.preventDefault();
  input.textInput(event.key);
  frame();
});
