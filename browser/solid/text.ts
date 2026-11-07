// The DOM's text above the canvas: the input method the field's characters come from, the mirror of the field it sees,
// and the clipboard's chords.
//
// A canvas is no editable element, so it is dispatched no beforeinput, no input and no composition. Chromium's
// `EditContext` is the standard's answer (`canvas.editContext = new EditContext()`), and a browser without it — WebKit —
// gets a hidden textarea instead (`?ime=input` forces that path, which is how the check drives both). The composition's
// committed string goes to `Input.textInput`, the call main.ts makes for SDL's TEXTINPUT, and only while a text field has
// the focus (`textInput` answers false for anything else).
//
// **The mirror.** An input method reads the context it is handed: its string, its selection and the boxes they are drawn
// in. The field's model is `Input`'s (`Input.field()`: the focused text field's text, caret and selection), so the
// context is a *view* of it, brought up to date by `sync()` once a frame — the page's tick runs it before the tree is
// declared, so the boxes are the frame just laid out (one frame, 16ms, behind an edit; the candidate window is placed
// after the composition starts, not in the same millisecond). `updateText(0, text.length, value)`,
// `updateSelection(anchor, caret)`, `updateControlBounds` (the field's row) and `updateSelectionBounds` (the 1x18 caret
// box the page already draws) are written only when the value or the boxes moved, so a frame at rest pays one read of
// the model and four comparisons. `characterboundsupdate` is answered from the row's width divided by its length — one
// advance a character, the approximation `press` makes, because the page draws runs and not per-glyph boxes.
//
// The fallback is the same code path: the hidden textarea *is* its own mirror (`value`, `selectionStart`/`selectionEnd`),
// so `sync()` only chooses where the strings and boxes go — `updateText`/`updateSelection`/`update*Bounds` on the
// context, or the textarea's own properties and its 1px box moved to the caret's pixel. A real IME on the textarea
// composes into the field's string and its caret, as it would into any editable element.
//
// **A composition is the IME's.** Its `textupdate` is applied to the context (the view: the context's text is then the
// field's text with the draft in it, which is what an IME reads back) and never to the model, so the page's value, its
// commands and its pixels are untouched until `compositionend` — `sync()` is skipped while one runs and re-runs on the
// end, which restores the model's string if the composition was cancelled. `compositionend`'s string goes through
// `Input.textInput`, one insertion at the field's caret, then the mirror follows the model at once rather than a frame
// later.
//
// The clipboard is the same Input's: copy and cut read the selection the field already has (`Input.clipboard`), paste
// inserts what the clipboard holds through `Input.textInput`, and select-all is the field's own Home then Shift+End, so no
// second selection model is invented here. A read is a promise, so a paste changes nothing until it settles and then runs
// one frame: while the permission is pending the canvas shows the field as it was.
import type { FieldView, Input } from "../../solid/src/input.ts";
import { ui } from "./ffi-browser.ts";

/** Chromium's EditContext, the part this page uses (TypeScript 5.9's lib.dom has no declaration for it). */
interface EditContext extends EventTarget {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  updateText(start: number, end: number, text: string): void;
  updateSelection(start: number, end: number): void;
  updateControlBounds(rect: DOMRect): void;
  updateSelectionBounds(rect: DOMRect): void;
  updateCharacterBounds(start: number, rects: DOMRect[]): void;
}

/** The IME's change, as Chromium's `TextUpdateEvent` carries it: the range of the previous text it replaces, and the
 *  selection after it. */
interface TextUpdate extends Event {
  readonly text: string;
  readonly updateRangeStart: number;
  readonly updateRangeEnd: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/** The boxes the IME reads, in the page's layout px: a row's [x, y, w, h]. */
type Box = readonly [number, number, number, number];
/** The two things a mirror can write: a string with a selection, and the boxes it is drawn in. */
interface Mirror {
  text(): string;
  selection(): readonly [number, number];
  writeText(text: string, anchor: number, caret: number): void;
  writeBounds(control: Box | undefined, caret: Box | undefined): void;
}

export interface Text {
  /** A composition is in progress: its keydowns are the IME's, not characters of the page's. */
  composing(): boolean;
  /** The focused text field's text, caret and selection: the model this file's mirror is a view of. */
  field(): FieldView | undefined;
  /**
   * Brings the mirror up to the model: once a frame, and on a composition's end. A no-op while a composition runs (the
   * IME's draft is the context's truth) and with no text field focused (there is nothing to compose into).
   */
  sync(): void;
}

const encoder = new TextEncoder();
const ids = new Map<string, Uint8Array>();
const bytes = (id: string): Uint8Array =>
  ids.get(id) ?? (ids.set(id, encoder.encode(id)), ids.get(id)!);

/**
 * The field's text path: the composition surface, its mirror, and the four clipboard chords. `frame` is one frame on an
 * edit (the shell's `immediate`), so a committed string, a paste and a cut are drawn at once, as a key is.
 */
export function attachText(canvas: HTMLCanvasElement, input: Input, frame: () => void): Text {
  const forced = new URLSearchParams(location.search).get("ime");
  const Edit = (globalThis as { EditContext?: new () => EditContext }).EditContext;
  const useEditContext = forced !== "input" && Edit !== undefined;
  // the composition as the IME presents it: held only so a `compositionend` that carries no data still commits the
  // string it showed
  let presented = "";
  let composing = false;
  let mirror: Mirror;

  const origin = (): DOMRect => canvas.getBoundingClientRect();
  const view = (): FieldView | undefined => input.field();
  /** The selection's moving end: the field keeps the run's two ends, the IME wants an anchor and a caret. */
  const anchorOf = (field: FieldView): number =>
    field.caret === field.selection.start ? field.selection.end : field.selection.start;

  /** The committed string to the focused field, and its frame; then the mirror, which is the model's again. */
  const commit = (text: string): void => {
    composing = false;
    presented = "";
    if (text !== "" && input.textInput(text)) frame();
    sync();
  };

  if (useEditContext) {
    const context = new (Edit as new () => EditContext)();
    context.addEventListener("compositionstart", () => {
      composing = true;
      presented = "";
    });
    // the IME's own change: applied to the context, the view (its text is the field's with the draft in it, which an IME
    // reads back), never to the model — the page is untouched until compositionend
    context.addEventListener("textupdate", (event) => {
      if (!composing) return;
      const e = event as TextUpdate;
      context.updateText(e.updateRangeStart, e.updateRangeEnd, e.text);
      context.updateSelection(e.selectionStart, e.selectionEnd);
      presented = e.text;
    });
    context.addEventListener("compositionend", (event) => commit((event as CompositionEvent).data ?? presented));
    // the IME asks where the composition's characters are: the row's width over its length, one advance a character
    context.addEventListener("characterboundsupdate", (event) => {
      const field = view();
      if (field === undefined) return;
      const at = event as Event & { readonly rangeStart?: number; readonly rangeEnd?: number };
      const start = at.rangeStart ?? field.caret;
      const end = at.rangeEnd ?? start;
      const line = ui.bounds(bytes(`${field.id}-line`));
      if (line === undefined) return;
      const o = origin();
      const advance = field.value.length > 0 ? line[2] / field.value.length : line[3];
      const rects: DOMRect[] = [];
      for (let i = start; i < end; i++)
        rects.push(new DOMRect(o.left + line[0] + i * advance, o.top + line[1], advance, line[3]));
      context.updateCharacterBounds(start, rects);
    });
    mirror = {
      text: () => context.text,
      selection: () => [context.selectionStart, context.selectionEnd],
      writeText: (text, anchor, caret) => {
        context.updateText(0, context.text.length, text);
        context.updateSelection(anchor, caret);
      },
      writeBounds: (control, caret) => {
        const o = origin();
        const rect = (box: Box): DOMRect => new DOMRect(o.left + box[0], o.top + box[1], box[2], box[3]);
        if (control !== undefined) context.updateControlBounds(rect(control));
        // the caret's own 1px box: the candidate window lands there, not at the canvas's corner; a field with no caret
        // box drawn (unfocused) falls back to the row's left edge
        if (caret !== undefined) context.updateSelectionBounds(rect(caret));
        else if (control !== undefined)
          context.updateSelectionBounds(rect([control[0], control[1], 1, control[3]]));
      },
    };
    (canvas as HTMLCanvasElement & { editContext?: EditContext }).editContext = context;
  } else {
    // the fallback: an editable element the browser will attach its IME to, off the page's pixels. It keeps the field's
    // text and selection of its own (the mirror below), so an IME composes over the field's string and at its caret; a
    // plain character is cancelled in `beforeinput` (the keydown having taken it already) and the value restored. It
    // holds the DOM's focus while the page is the field's: a keydown on it is cloned onto the canvas (where the shell's
    // key listener and this page's are), and a key the page consumed is `preventDefault`ed on the real event too, so the
    // browser neither moves the focus on Tab nor scrolls on Space or an arrow
    const hidden = document.createElement("textarea");
    hidden.setAttribute("aria-hidden", "true");
    hidden.tabIndex = -1;
    hidden.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;resize:none;z-index:-1";
    document.body.append(hidden);
    const forward = (event: KeyboardEvent): void => {
      const clone = new KeyboardEvent(event.type, {
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      canvas.dispatchEvent(clone);
      if (clone.defaultPrevented) event.preventDefault();
    };
    hidden.addEventListener("keydown", forward);
    hidden.addEventListener("keyup", forward);
    hidden.addEventListener("compositionstart", () => {
      composing = true;
      presented = "";
    });
    hidden.addEventListener("compositionupdate", (event) => {
      presented = event.data ?? "";
    });
    hidden.addEventListener("compositionend", (event) => {
      commit(event.data ?? presented);
    });
    hidden.addEventListener("beforeinput", (event) => {
      if (composing) return;
      // the keydown took the character: the browser's own insert is stopped, and the textarea is the model's again (it
      // was already, one frame behind at worst)
      event.preventDefault();
      sync();
    });
    mirror = {
      text: () => hidden.value,
      selection: () => [hidden.selectionStart, hidden.selectionEnd],
      writeText: (text, anchor, caret) => {
        if (hidden.value !== text) hidden.value = text;
        hidden.setSelectionRange(anchor, caret);
      },
      writeBounds: (control, caret) => {
        // no `update*Bounds` here: the IME anchors to the element's own box, so the 1px field is moved to the caret's
        // pixel (client coordinates, as the textarea is `position:fixed`)
        const at = caret ?? control;
        if (at === undefined) return;
        const o = origin();
        hidden.style.left = `${o.left + at[0]}px`;
        hidden.style.top = `${o.top + at[1]}px`;
      },
    };
    // a press keeps the canvas the page's, but the DOM's focus goes to the IME's element after it: the browser's own
    // focus on mousedown is cancelled, so the canvas's `focus()` in the shell does not take it back
    canvas.addEventListener("mousedown", (event) => {
      event.preventDefault();
      hidden.focus();
    });
  }

  // the boxes are the last frame's (`ui.bounds`): a key that moved the caret costs the next frame's sync, not this one's
  let boxes: string | undefined;
  /** The mirror's update: the model's string, then its boxes, each written only when it moved. */
  function sync(): void {
    if (composing) return;
    const field = view();
    if (field === undefined) {
      // no text field has the focus: an IME sees an empty context, and a composition commits to nothing
      if (mirror.text() !== "") mirror.writeText("", 0, 0);
      return;
    }
    const anchor = anchorOf(field);
    const [start, end] = mirror.selection();
    if (mirror.text() !== field.value || start !== anchor || end !== field.caret)
      mirror.writeText(field.value, anchor, field.caret);
    const control = ui.bounds(bytes(field.id));
    const caret = ui.bounds(bytes(`${field.id}-line-caret`));
    const key = `${control?.join(",") ?? "-"}|${caret?.join(",") ?? "-"}`;
    if (key === boxes) return;
    boxes = key;
    mirror.writeBounds(
      control as Box | undefined,
      caret as Box | undefined,
    );
  }

  // Cmd/Ctrl+C, X, V and A on a focused text field: the page's own clipboard (`Input.clipboard`), the field's own
  // selection, and `Input.textInput` for a paste. A chord on a page with no text field focused — or in a context with no
  // `navigator.clipboard` — is the browser's, as `keyName` decides for the desktop's keys.
  const fieldFocused = (): boolean => input.field() !== undefined;
  canvas.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "a" && key !== "c" && key !== "x" && key !== "v") return;
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined || !fieldFocused()) return;
    event.preventDefault();
    if (key === "a") {
      input.down("Home");
      input.down("Shift+End");
      frame();
      return;
    }
    if (key === "v") {
      // the permission is a promise: the field is untouched until it settles, and then one frame shows the insert
      void clipboard.readText().then(
        (text) => {
          if (input.textInput(text)) frame();
        },
        () => {},
      );
      return;
    }
    // copy and cut are the field's: `cut` is its own copy and the backspace rule over the selection, as main.ts's chord
    const text = input.clipboard(key === "c" ? "copy" : "cut", "");
    if (text === null) return;
    if (key === "x") frame();
    void clipboard.writeText(text).catch(() => {});
  });

  return { composing: () => composing, field: view, sync };
}
