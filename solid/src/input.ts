// Keyboard and pointer focus for a page: SDL keycodes to the names the focus manager and the headless parts use, and
// the routing of one key to the focus manager (Tab), then the focused part, then the page.
import { createFocus, type Focus } from "../../focus/src/focus.ts";
import type { PartHandlers } from "../../headless/src/index.ts";

const KEYS: Record<number, string> = {
  9: "Tab",
  13: "Enter",
  0x40000058: "Enter", // keypad
  27: "Escape",
  32: " ", // DOM's `key` for Space; the parts take "Space" too
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

/**
 * The name of an SDL key event (keycode and SDL_Keymod), or undefined for a key the page has no name for. Shift+Tab is
 * "Shift+Tab"; Ctrl, Alt and Cmd chords are nobody's (the focus manager takes plain keys only); a letter is itself,
 * lower case (SDL reports the key, not the character).
 */
export function keyName(code: number, mod = 0): string | undefined {
  if (mod & CTRL_ALT_GUI) return undefined;
  const name = KEYS[code] ?? (code > 32 && code < 127 ? String.fromCharCode(code) : undefined);
  if (name === "Tab" && mod & SHIFT) return "Shift+Tab";
  // Shift with an arrow, Home or End is a selection chord, not a move
  if (mod & SHIFT && name && name.length > 1 && name !== "Enter" && name !== "Escape") return undefined;
  return name;
}

/**
 * What a part must have to take keys and focus here: any part of the headless widgets (a slider's thumb and a tab
 * panel have no `press`).
 */
export type FocusPart = Pick<PartHandlers, "focus" | "blur" | "keyDown" | "keyUp"> & {
  readonly id: string;
  readonly focused: boolean;
  readonly press?: () => void;
};

/** The props of a `box` that make a part's row clickable and focusable: spread them on it, `<box {...input.add(part)}>`. */
export interface Bind {
  id: string;
  readonly focused: boolean;
  onPress: () => void;
  onClick?: () => void;
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
  /** The host's last resort for a key nobody took (the Sensors page's theme key). */
  fallback?: (name: string) => boolean;
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
        onClick: part.press,
      };
    },
    down(name, repeat = false) {
      // Tab is the manager's. An arrow, Home or End is the focused part's: a radio moves focus and checks what it moved
      // to, tabs select, the toolbar only moves, a slider changes its value; each calls the manager for the move itself
      // and takes only the keys its pattern has (Home on a radio is nobody's, not a move without a check)
      if ((name === "Tab" || name === "Shift+Tab") && focus.key(name)) return true;
      if (focused()?.keyDown(name, repeat)) return true;
      return input.fallback?.(name) ?? false;
    },
    up: (name) => focused()?.keyUp(name) ?? false,
    pressMiss: () => focus.blur(),
  };
  return input;
}
