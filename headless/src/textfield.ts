import type { Accessor } from 'solid-js';
import { createSignal } from 'solid-js';
import type { Focus } from '../../focus/src/focus';
import { createControllable } from './controllable';
import { createFocusHost, whenDisposed } from './focus-host';
import type { PartHandlers } from './parts';
import { nextId } from './parts';

/** A run of the value: `start` is the first selected index, `end` the one past the last. Equal = no selection. */
export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export interface TextFieldOptions {
  /** Base of the part's id: `<id>` (the field itself, one focus entry). */
  readonly id?: string;
  /** Controlled: the host owns the text and this is the only thing that changes it. */
  readonly value?: string | undefined;
  /** Starting text when uncontrolled. */
  readonly defaultValue?: string;
  /** Longest text the field takes, in UTF-16 code units (a DOM `maxlength`). */
  readonly maxLength?: number;
  /** The text is selectable and navigable but no edit goes through. */
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  /**
   * The advance of one character in px, for `press`; 8 by default. A host that measures its font passes the run's
   * width divided by its length instead, which is still one advance for every character.
   */
  readonly advance?: number;
  /** The focus manager the field registers with; a private one when omitted. */
  readonly focus?: Focus;
  /** A request to change the text; uncontrolled it is accepted, controlled the host may ignore it. */
  readonly onValueChange?: (value: string) => void;
  /** Enter while the field is focused (a key repeat does not fire it again). */
  readonly onSubmit?: (value: string) => void;
}

/**
 * The field as the host wires it: `role=textbox` and the neutral fields the aria-* attributes carried, plus the
 * handlers. `editsText` marks a part that takes typed characters, so that a host knows to run its text input.
 */
export interface TextFieldPart extends PartHandlers {
  readonly id: string;
  readonly role: 'textbox';
  readonly value: string;
  /** The index the caret is at, 0..`value.length`. */
  readonly caret: number;
  readonly selection: TextSelection;
  /** What a screen reader reads (`aria-valuetext` in the driver's naming). */
  readonly valueText: string;
  readonly readOnly: boolean;
  readonly disabled: boolean;
  readonly focused: boolean;
  readonly tabIndex: 0;
  /** A text field: typed characters reach it through `insert`. False when it is read-only or disabled. */
  readonly editsText: boolean;
  /** Typed characters (the host has already decoded them). Returns whether they went in. */
  readonly insert: (text: string) => boolean;
  /** copy / cut return the text for the clipboard (null: nothing selected); paste inserts `text`. */
  readonly clipboard: (op: 'copy' | 'cut' | 'paste', text: string) => string | null;
}

export interface TextField {
  readonly value: Accessor<string>;
  readonly caret: Accessor<number>;
  readonly selection: Accessor<TextSelection>;
  readonly focused: Accessor<boolean>;
  readonly part: TextFieldPart;
  /** A programmatic request, as `setValue` is on the slider: the host may ignore a controlled one. */
  readonly setValue: (value: string) => void;
  /** Puts the caret at `index` (clamped) and drops the selection. */
  readonly setCaret: (index: number) => void;
  readonly insert: (text: string) => boolean;
  readonly clipboard: (op: 'copy' | 'cut' | 'paste', text: string) => string | null;
  /** Returns whether the key was the field's (editing keys; Tab, Space and the rest are the host's). */
  readonly keyDown: (key: string, repeat?: boolean) => boolean;
  /**
   * A press at `x` px from the start of the text run, measured with `advance` px a character (a fixed advance: a
   * proportional font can put the caret a character off in the middle of a word). Focuses the field.
   */
  readonly press: (x?: number, advance?: number) => void;
  readonly focus: () => void;
  readonly blur: () => void;
}

/** The first `room` UTF-16 units of `text` without cutting a surrogate pair: what the field can take. */
const clip = (text: string, room: number): string => {
  let out = '';
  for (const char of text) {
    if (out.length + char.length > room) {
      break;
    }
    out += char;
  }
  return out;
};

/**
 * A text field, not a port: eoa has no textfield primitive (`packages/headless` has `combobox` and
 * `spinbutton`, both text-like with their own models) and `specs/apg/` has no textbox pattern, so there is no
 * model, mount or walk behind this one and the conformance counts are untouched. The editing rules are the
 * platform's `<input type=text>` ones, written down here.
 *
 * One focus entry, like the slider: the host's Tab reaches the field, `Escape` blurs it, and every key it does not
 * take falls through to the page. The value is request/commit (`value` + `onValueChange`, `defaultValue` when
 * uncontrolled); the caret and the selection are the field's own (an anchor and a caret, the selection being the run
 * between them). Typed characters come through `insert` — a part gets text, not events — so a host must send them in
 * (see `solid/src/input.ts`'s `Input.textInput`).
 *
 * Not covered: bidi, grapheme clusters (an index is a UTF-16 code unit, as `selectionStart` is), wrapping and
 * multiline (a newline in `insert` is kept as a character, there is no line model), undo, and IME composition
 * (the host's text events are already committed characters).
 */
export const createTextField = (options: TextFieldOptions = {}): TextField => {
  const id = options.id ?? nextId('text');
  const host = createFocusHost(options.focus);
  const manager = host.manager;

  const [value, request] = createControllable<string>({
    value: () => options.value,
    initial: options.defaultValue ?? '',
    onChange: () => options.onValueChange,
  });
  const [caret, setCaretAt] = createSignal(0);
  const [anchor, setAnchorAt] = createSignal(0);
  // Solid 2 applies a setter on the next flush, so a caret read in the same tick would lag: the local is always
  // fresh and the signals only notify (as `createControllable` does for the value).
  let caretLocal = 0;
  let anchorLocal = 0;
  const caretValue = (): number => (caret(), caretLocal);
  const anchorValue = (): number => (anchor(), anchorLocal);
  const setCaretLocal = (index: number): void => {
    caretLocal = index;
    setCaretAt(index);
  };
  const setAnchorLocal = (index: number): void => {
    anchorLocal = index;
    setAnchorAt(index);
  };

  manager.register(id, { disabled: options.disabled === true });
  whenDisposed(() => {
    manager.unregister(id);
  });

  const disabled = (): boolean => options.disabled === true;
  const readOnly = (): boolean => options.readOnly === true;
  const editable = (): boolean => !disabled() && !readOnly();
  const focused = (): boolean => manager.focused() === id;
  const read = <R>(fn: () => R): R => {
    host.version();
    return fn();
  };

  const clampIndex = (index: number): number =>
    Math.max(0, Math.min(value().length, Number.isFinite(index) ? Math.round(index) : 0));
  const caretNow = (): number => clampIndex(caretValue());
  const anchorNow = (): number => clampIndex(anchorValue());
  const selection = (): TextSelection => {
    const [a, c] = [anchorNow(), caretNow()];
    return { start: Math.min(a, c), end: Math.max(a, c) };
  };

  /** Drops the selection and puts the caret at `index`. */
  const setCaret = (index: number): void => {
    const at = clampIndex(index);
    setCaretLocal(at);
    setAnchorLocal(at);
  };
  /** Moves the caret, keeping the anchor when `extend` (Shift). */
  const moveTo = (index: number, extend: boolean): void => {
    const at = clampIndex(index);
    setCaretLocal(at);
    if (!extend) {
      setAnchorLocal(at);
    }
  };

  /** Requests the text and leaves the caret after what changed; returns true so the key is taken. */
  const write = (next: string, index: number): true => {
    request(next);
    // not clamped to the text the host still shows: a controlled field's value arrives after its request, and the
    // caret must be at the end of what will be there (the reads clamp against the text that is)
    setCaretLocal(index);
    setAnchorLocal(index);
    return true;
  };

  const insert = (text: string): boolean => {
    if (!editable() || text === '') {
      return false;
    }
    const { start, end } = selection();
    const kept = value().slice(0, start) + value().slice(end);
    const room =
      options.maxLength === undefined
        ? Infinity
        : Math.max(0, options.maxLength - kept.length);
    const take = clip(text, room);
    if (take === '') {
      // at the limit: a selection still collapses, as a browser's does
      if (start !== end) {
        setCaret(start);
      }
      return false;
    }
    const next = kept.slice(0, start) + take + kept.slice(start);
    write(next, start + take.length);
    return true;
  };

  const backspace = (): boolean => {
    if (!editable()) {
      return false;
    }
    const { start, end } = selection();
    if (start !== end) {
      return write(value().slice(0, start) + value().slice(end), start);
    }
    if (start === 0) {
      return true;
    }
    return write(value().slice(0, start - 1) + value().slice(start), start - 1);
  };

  const remove = (): boolean => {
    if (!editable()) {
      return false;
    }
    const { start, end } = selection();
    if (start !== end) {
      return write(value().slice(0, start) + value().slice(end), start);
    }
    if (end >= value().length) {
      return true;
    }
    return write(value().slice(0, start) + value().slice(start + 1), start);
  };

  const keyDown = (key: string, repeat = false): boolean => {
    if (disabled()) {
      return false;
    }
    const { start, end } = selection();
    switch (key) {
      case 'Backspace':
        return backspace();
      case 'Delete':
        return remove();
      case 'ArrowLeft':
        moveTo(start !== end ? start : caretNow() - 1, false);
        return true;
      case 'ArrowRight':
        moveTo(start !== end ? end : caretNow() + 1, false);
        return true;
      case 'Shift+ArrowLeft':
        moveTo(caretNow() - 1, true);
        return true;
      case 'Shift+ArrowRight':
        moveTo(caretNow() + 1, true);
        return true;
      case 'Home':
        moveTo(0, false);
        return true;
      case 'End':
        moveTo(value().length, false);
        return true;
      case 'Shift+Home':
        moveTo(0, true);
        return true;
      case 'Shift+End':
        moveTo(value().length, true);
        return true;
      case 'Enter':
        if (!repeat) {
          options.onSubmit?.(value());
        }
        return true;
      case 'Escape':
        manager.blur();
        return true;
      default:
        return false;
    }
  };

  const press = (x = 0, advance?: number): void => {
    manager.focus(id);
    const length = value().length;
    if (length === 0) {
      setCaret(0);
      return;
    }
    const step = advance !== undefined && advance > 0 ? advance : (options.advance ?? 8);
    setCaret(Math.round(Math.max(0, x) / step));
  };

  const clipboard = (op: 'copy' | 'cut' | 'paste', text: string): string | null => {
    if (op === 'paste') {
      insert(text);
      return null;
    }
    const { start, end } = selection();
    if (start === end) {
      return null;
    }
    const picked = value().slice(start, end);
    if (op === 'cut') {
      if (!editable()) {
        return null;
      }
      write(value().slice(0, start) + value().slice(end), start);
    }
    return picked;
  };

  const focus = (): void => {
    manager.focus(id);
  };
  const blur = (): void => {
    if (focused()) {
      manager.blur();
    }
  };

  const part: TextFieldPart = {
    id,
    role: 'textbox',
    get value() {
      return value();
    },
    get caret() {
      return caretNow();
    },
    get selection() {
      return selection();
    },
    get valueText() {
      return value();
    },
    get readOnly() {
      return readOnly();
    },
    get disabled() {
      return disabled();
    },
    get focused() {
      return read(focused);
    },
    get editsText() {
      return editable();
    },
    tabIndex: 0,
    insert,
    clipboard,
    press,
    keyDown,
    keyUp: () => false,
    key: keyDown,
    focus,
    blur,
  };

  return {
    value,
    caret: () => caretNow(),
    selection,
    focused: () => read(focused),
    part,
    setValue: (next) => request(next),
    setCaret,
    insert,
    clipboard,
    keyDown,
    press,
    focus,
    blur,
  };
};
