// The DOM's keys as the names solid/src/input.ts knows: what this page does with a `KeyboardEvent` where the desktop pops
// SDL's queue (main.ts: `ui.keyPop`, `selectionName`, `input.down(name, repeat)`). The table is native/README.md's.
//
// SDL reports a key, not a character: its keycode 97 is `a` with or without Shift (typing is SDL_TEXTINPUT, a second queue
// this page has no text field for). So a letter or a digit is read from `code`, which is the key, and Shift is put back on
// by `keyName`'s own rules; punctuation is the unshifted character too, because that is the keycode's value: Shift+; is
// ";", and Shift+1 is "1", not "!".
import type { Input } from "../../solid/src/input.ts";

const NAMED: Record<string, string> = {
  Tab: "Tab",
  Enter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

// the unshifted character of a punctuation key: SDL's keycode is the key, so Shift does not change it
const PUNCT: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  Backslash: "\\",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/** Cmd, Ctrl and Alt are nobody's: the focus manager takes plain keys only, as `keyName` decides (it refuses the chords). */
const chord = (event: KeyboardEvent) => event.metaKey || event.ctrlKey || event.altKey;

/** The key without its modifiers, as SDL's keycode names it: "a" for KeyA, "1" for Digit1, ";" for Shift+Semicolon. */
function base(event: KeyboardEvent): string | undefined {
  const key = event.key;
  if (key === " " || key === "Spacebar") return " ";
  const named = NAMED[key] ?? NAMED[event.code];
  if (named !== undefined) return named;
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) return digit[1]!;
  if (PUNCT[event.code] !== undefined) return PUNCT[event.code];
  // a keyboard this table does not know (another layout's key): its character, lower case, if it is one character
  if (key.length === 1) return key.toLowerCase();
  return undefined;
}

/**
 * `keyName`'s answer for a DOM key event: "Tab", "Shift+Tab", " " for Space, "Enter", "Escape", "Backspace", "Delete", the
 * arrows, "Home"/"End", "PageUp"/"PageDown", a letter ("a", and "Shift+A" with Shift, the page's own chord), a digit or a
 * punctuation mark, and undefined for a key the page has no name for — and for Shift with an arrow, Home, End, Backspace
 * or Delete, which the desktop calls a selection chord, not a move.
 */
export function keyName(event: KeyboardEvent): string | undefined {
  if (chord(event)) return undefined;
  const name = base(event);
  if (name === undefined) return undefined;
  if (name === "Tab") return event.shiftKey ? "Shift+Tab" : "Tab";
  if (!event.shiftKey) return name;
  if (name !== "Enter" && name !== "Escape" && name.length > 1) return undefined;
  if (name >= "a" && name <= "z") return `Shift+${name.toUpperCase()}`;
  return name;
}

/**
 * The keys the page consumes, so the browser does not move its focus (Tab) or scroll the page (Space, the arrows, Home,
 * End, PageUp, PageDown). A letter or a digit is left to the browser: a canvas has no default action for one, and a
 * chord is not ours.
 */
const consumed = (name: string): boolean =>
  name === "Tab" ||
  name === "Shift+Tab" ||
  name === " " ||
  name === "Enter" ||
  name === "Backspace" ||
  name === "Delete" ||
  name === "Home" ||
  name === "End" ||
  name === "PageUp" ||
  name === "PageDown" ||
  name === "ArrowUp" ||
  name === "ArrowDown" ||
  name === "ArrowLeft" ||
  name === "ArrowRight";

/**
 * The chords a text field selects with and `keyName` lets through: Shift with Left, Right, Home or End — the set
 * `selectionName` keeps for SDL (`src/input.ts`), named as the parts take it (`"Shift+ArrowLeft"`). A shifted letter is
 * not one (it is a page's own chord, `keyName`'s "Shift+A"), and a chord with Cmd, Ctrl or Alt is nobody's.
 */
export function selectionChord(event: KeyboardEvent): string | undefined {
  if (!event.shiftKey || chord(event)) return undefined;
  const name = base(event);
  return name === "ArrowLeft" || name === "ArrowRight" || name === "Home" || name === "End"
    ? `Shift+${name}`
    : undefined;
}

/**
 * The keyboard of a page: a `keydown`/`keyup` pair on the canvas (the element with the DOM's focus, `tabindex=0`), the key
 * into `input` and then the frame it changed — the order main.ts's loop has, a key queued before the tree is declared.
 * `frame` runs one frame on the event, as a press does, so a quick key pair cannot land inside one frame.
 */
export function attachKeys(canvas: HTMLCanvasElement, input: Input, frame: () => void): void {
  canvas.addEventListener("keydown", (event) => {
    const name = keyName(event);
    if (name === undefined) return;
    if (consumed(name)) event.preventDefault();
    input.down(name, event.repeat);
    frame();
  });
  canvas.addEventListener("keyup", (event) => {
    const name = keyName(event);
    if (name === undefined) return;
    if (consumed(name)) event.preventDefault();
    input.up(name);
    frame();
  });
}
