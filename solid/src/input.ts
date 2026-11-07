// Keyboard and pointer focus for a page: SDL keycodes to the names the focus manager and the headless parts use, and
// the routing of one key to the focus manager (Tab), then the focused part, then the page.
import { createFocus, type Focus } from "../../focus/src/focus.ts";
import type { PartHandlers } from "../../headless/src/index.ts";

const KEYS: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  0x40000058: "Enter", // keypad
  27: "Escape",
  32: " ", // DOM's `key` for Space; the parts take "Space" too
  127: "Delete",
  0x4000004a: "Home",
  0x4000004b: "PageUp",
  0x4000004d: "End",
  0x4000004e: "PageDown",
  0x4000004f: "ArrowRight",
  0x40000050: "ArrowLeft",
  0x40000051: "ArrowDown",
  0x40000052: "ArrowUp",
};
const SHIFT = 0x3;
const CTRL_ALT_GUI = 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800;
// the arrows and Home/End whose Shift form is a selection chord rather than a move of the focus manager's
const SELECTION = new Set([0x4000004a, 0x4000004d, 0x4000004f, 0x40000050]);

/**
 * The name of an SDL key event (keycode and SDL_Keymod), or undefined for a key the page has no name for. Shift+Tab is
 * "Shift+Tab"; Ctrl, Alt and Cmd chords are nobody's (the focus manager takes plain keys only); a letter is itself,
 * lower case (SDL reports the key, not the character).
 */
export function keyName(code: number, mod = 0): string | undefined {
  if (mod & CTRL_ALT_GUI) return undefined;
  const name = KEYS[code] ?? (code > 32 && code < 127 ? String.fromCharCode(code) : undefined);
  if (name === "Tab" && mod & SHIFT) return "Shift+Tab";
  // a letter with Shift keeps its Shift: a page's own chord ("Shift+R", the dev panel's reset-all). The parts take no
  // shifted letter otherwise (a character comes through `insert`, not `keyDown`), so nothing loses a key to this.
  if (mod & SHIFT && name !== undefined && name >= "a" && name <= "z") return `Shift+${name.toUpperCase()}`;
  // Shift with an arrow, Home or End is a selection chord, not a move
  if (mod & SHIFT && name && name.length > 1 && name !== "Enter" && name !== "Escape") return undefined;
  return name;
}

/**
 * `keyName`, keeping Shift on the chords a text field selects with: "Shift+ArrowLeft", "Shift+Home". The focus manager
 * is only ever given Tab and Shift+Tab, so no part sees a selection chord it did not have before (a shifted letter has a
 * name of its own, `keyName`'s "Shift+R").
 */
export function selectionName(code: number, mod = 0): string | undefined {
  const name = keyName(code, mod);
  if (name !== undefined) return name;
  if (!(mod & SHIFT) || mod & CTRL_ALT_GUI || !SELECTION.has(code)) return undefined;
  return `Shift+${KEYS[code]}`;
}

/**
 * What a part must have to take keys and focus here: any part of the headless widgets (a slider's thumb and a tab
 * panel have no `press`). `editsText` marks a text field: its typed characters come through `insert`, and the host
 * runs SDL's text input only while it has focus.
 */
export type FocusPart = Pick<PartHandlers, "focus" | "blur" | "keyDown" | "keyUp"> & {
  readonly id: string;
  readonly focused: boolean;
  readonly press?: (x?: number) => void;
  /** A text field: typed characters reach it through `insert`. */
  readonly editsText?: boolean;
  readonly insert?: (text: string) => boolean;
  /** copy and cut return what goes on the clipboard; paste takes it. null when there is nothing to do. */
  readonly clipboard?: (op: "copy" | "cut" | "paste", text: string) => string | null;
  /** A text field's own text, caret (the moving end) and selection: what a host mirrors to an IME. */
  readonly value?: string;
  readonly caret?: number;
  readonly selection?: { readonly start: number; readonly end: number };
}

/** A focused text field as a host sees it: the model an IME's context (or a hidden textarea) is a view of. */
export interface FieldView {
  readonly id: string;
  readonly value: string;
  readonly caret: number;
  readonly selection: { readonly start: number; readonly end: number };
};

/** The props of a `box` that make a part's row clickable and focusable: spread them on it, `<box {...input.add(part)}>`. */
export interface Bind {
  id: string;
  readonly focused: boolean;
  onPress: () => void;
  onClick?: (x?: number) => void;
}

export interface Input {
  readonly focus: Focus;
  /** Registers a part in the focus manager (in call order: the document order) and returns its box props. */
  add(part: FocusPart & { readonly disabled: boolean }, options?: { group?: string }): Bind;
  /**
   * A part of a group (radio, tabs, toolbar, slider) registered itself in the manager it was given (`focus: input.focus`);
   * this only routes keys and focus to it and returns its box props. Their document order is the order of creation.
   */
  bind(part: FocusPart): Bind;
  /** A key went down. Returns whether something took it. */
  down(name: string, repeat?: boolean): boolean;
  up(name: string): boolean;
  /** Typed characters (UTF-8 already decoded) to the focused part; false when it is no text field. */
  textInput(text: string): boolean;
  /** The focused part is a text field: SDL's text input should run. */
  editing(): boolean;
  /** Cmd+C, Cmd+X, Cmd+V on the focused part; `undefined` when it is no text field. */
  clipboard(op: "copy" | "cut" | "paste", text: string): string | null | undefined;
  /** The focused text field's text, caret and selection (a host mirrors it to an IME); undefined for any other part. */
  field(): FieldView | undefined;
  /** The host's last resort for a key nobody took (the Sensors page's theme key). */
  fallback?: (name: string) => boolean;
  /**
   * While a modal is open, every key goes here first and true means it was taken (a dialog's trap: Tab and Shift+Tab
   * cycle its controls, Escape closes it). False lets the key through as usual.
   */
  modal?: (name: string, repeat?: boolean) => boolean;
  /** A press on empty space: the focus goes away, as a click on a page's background blurs a field. */
  pressMiss(): void;
}

/**
 * Focus state of one page. The manager decides who is focused; each change blurs the old part and focuses the new one,
 * so a part's `focused` follows. Tab and Shift+Tab go to the manager, any other key to the focused part's `keyDown` (a
 * group's part moves focus through the manager itself), then to `fallback`; `up` goes to the part's `keyUp`. Tab past the last stop releases focus, as the
 * manager does, and nobody takes that Tab.
 */
export function createInput(): Input {
  const focus = createFocus();
  const parts = new Map<string, FocusPart>();
  focus.onChange((next, prev) => {
    if (prev !== null) parts.get(prev)?.blur();
    if (next !== null) parts.get(next)?.focus();
  });
  const focused = () => {
    const id = focus.focused();
    return id === null ? undefined : parts.get(id);
  };

  const input: Input = {
    focus,
    add(part, options) {
      focus.register(part.id, { disabled: part.disabled, ...options });
      return input.bind(part);
    },
    bind(part) {
      parts.set(part.id, part);
      return {
        id: part.id,
        get focused() {
          return part.focused;
        },
        // a disabled part refuses focus, so a press on it leaves the focus where it was
        onPress: () => void focus.focus(part.id),
        // x only: a text field places its caret from it (its own advance when the page has not measured one)
        onClick: (x?: number) => part.press?.(x),
      };
    },
    down(name, repeat = false) {
      // a modal dialog owns the keyboard while it is open: Tab cycles inside it and Escape closes it
      if (input.modal?.(name, repeat)) return true;
      // Tab is the manager's. An arrow, Home or End is the focused part's: a radio moves focus and checks what it moved
      // to, tabs select, the toolbar only moves, a slider changes its value; each calls the manager for the move itself
      // and takes only the keys its pattern has (Home on a radio is nobody's, not a move without a check)
      if ((name === "Tab" || name === "Shift+Tab") && focus.key(name)) return true;
      if (focused()?.keyDown(name, repeat)) return true;
      return input.fallback?.(name) ?? false;
    },
    up: (name) => focused()?.keyUp(name) ?? false,
    textInput: (text) => focused()?.insert?.(text) ?? false,
    editing: () => focused()?.editsText === true,
    clipboard: (op, text) => focused()?.clipboard?.(op, text),
    field() {
      const part = focused();
      if (part?.value === undefined || part.caret === undefined || part.selection === undefined)
        return undefined;
      return { id: part.id, value: part.value, caret: part.caret, selection: part.selection };
    },
    pressMiss: () => focus.blur(),
  };
  return input;
}
