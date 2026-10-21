// The Text field page: the neutral `createTextField` part of `headless/` on a real window, with its styles in this
// file. One editable field ("Name"), a readout of its value and length, a read-only field, a Submit button and the
// command button of the other pages. The caret and the selection are not text attributes here: the value is laid out
// as up to three text runs (before, the selection in a tinted box, after) with a 1px caret box between them, so Clay
// puts them exactly where the glyphs are and no measurement is needed to draw them.
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal, Show } from "solid-js";

import {
  createButton,
  createTextField,
  type TextField,
} from "../../headless/src/index.ts";
import { ui } from "../src/ffi.ts";
import { a11y } from "../a11y.ts";
import type { Bind, Input } from "../src/input.ts";

const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    title: { $value: "rgb(230 60 60)" },
    muted: { $value: "rgb(150 155 170)" },
    ink: { $value: "rgb(235 235 240)" },
    off: { $value: "rgb(60 64 78)" },
    accent: { $value: "rgb(240 140 50)" },
    surface: { $value: "rgb(36 40 52)" },
    hover: { $value: "rgb(48 53 68)" },
    active: { $value: "rgb(64 70 90)" },
    ring: { $value: "rgb(90 170 255)" },
    // the selection run: the accent, tinted, so the ink keeps its contrast both ways
    selection: { $value: "rgb(240 140 50 / 0.30)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    title: "rgb(200 30 40)",
    muted: "rgb(95 100 115)",
    ink: "rgb(25 27 34)",
    off: "rgb(190 194 206)",
    accent: "rgb(190 90 10)",
    surface: "rgb(255 255 255)",
    hover: "rgb(232 235 241)",
    active: "rgb(216 221 231)",
    ring: "rgb(20 100 220)",
    selection: "rgb(190 90 10 / 0.22)",
  },
});
const font = css.fonts("Roboto");

const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(28, 40, 24, 40),
  css.gap(8),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
const title = css.cn(font.Roboto, css.color(t.color.title), css.fontSize(32));
const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16));
const note = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));

// a command button: the pill of the Sensors, Widgets and Dialog pages
const button = css.cn(
  css.width("stretch"),
  css.height(40),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(20),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);

// the field: a row that takes the focus ring (2px, as the other rows), no padding change when it does
const field = css.cn(
  css.width("stretch"),
  css.height(44),
  css.p(10, 12),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(8),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.focus(css.border(2, t.color.ring)),
);
// the text run: fit width, so its bounds are the glyphs' extent (the page measures a press against them)
const line = css.cn(css.alignItems("center"));
const value = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16), css.whiteSpace("nowrap"));
const caret = css.cn(css.width(1), css.height(18), css.bg(t.color.ink));
const selection = css.cn(css.bg(t.color.selection));

export const s = { t, font, root, title, label, note, button, field, line, value, caret, selection };

/** The window of the page: the tallest state (a submitted line under the buttons) fits. */
export const size = { width: 360, height: 450 };

/**
 * The value as the row shows it: the runs before the selection, the selection (a tinted box) and the run after it,
 * with the caret between the first and the second or the second and the third (1px, only while the field has focus).
 * Two Shows would share an id; they are exclusive (`caret === selection.start` and its negation), so only one is ever
 * in the tree.
 */
function Content(props: { field: TextField; id: string }) {
  const text = () => props.field.value();
  const selection = () => props.field.selection();
  const caret = () => props.field.caret();
  const shown = () => props.field.focused() && caret() === selection().start;
  return (
    <box id={props.id} style={s.line}>
      <Show when={selection().start > 0}>
        <text style={s.value}>{text().slice(0, selection().start)}</text>
      </Show>
      <Show when={shown()}>
        <box id={`${props.id}-caret`} style={s.caret} />
      </Show>
      <Show when={selection().start < selection().end}>
        <box id={`${props.id}-selection`} style={s.selection}>
          <text style={s.value}>{text().slice(selection().start, selection().end)}</text>
        </box>
      </Show>
      <Show when={!shown() && props.field.focused()}>
        <box id={`${props.id}-caret`} style={s.caret} />
      </Show>
      <Show when={selection().end < text().length}>
        <text style={s.value}>{text().slice(selection().end)}</text>
      </Show>
    </box>
  );
}

/**
 * The page. Tab order: the command button, Name, Read-only, Submit. Typing reaches the focused field through
 * `Input.textInput` (the host routes SDL's text events), Enter submits, Escape blurs, and the arrows, Home/End,
 * Backspace and Delete are the field's keys. `t` flips the theme only while no field has focus: while one does, a
 * letter is a character, not a shortcut.
 */
export function Field(props: { input: Input }) {
  const { input } = props;
  const [count, setCount] = createSignal(0);
  const [submitted, setSubmitted] = createSignal<string | null>(null);

  const press = createButton({ id: "press", onClick: () => setCount((n) => n + 1) });
  const pressBind = input.add(press.part);
  // the fields register themselves in the page's manager (creation order is the Tab order, as the groups do)
  const name = createTextField({
    id: "name",
    focus: input.focus,
    maxLength: 24,
    onSubmit: (text) => setSubmitted(text),
  });
  const mail = createTextField({ id: "mail", focus: input.focus, readOnly: true, defaultValue: "ada@example.com" });
  const submit = createButton({ id: "submit", onClick: () => setSubmitted(name.value()) });
  const submitBind = input.add(submit.part);

  /**
   * A press places the caret: x from the start of the row's text, and one advance of the row's measured width divided
   * by its length (the approximation: a proportional font is not evenly spaced, so the middle of a word can be a
   * character off; the ends clamp). The row's bounds are the previous frame's, the state the press was made on.
   */
  const pressAt = (field: TextField, lineId: string) => (px: number) => {
    const [left, , width] = ui.bounds(Buffer.from(lineId)) ?? [0, 0, 0];
    const length = field.value().length;
    field.press(px - left!, length > 0 ? width! / length : undefined);
  };

  const readout = () => `Value: ${JSON.stringify(name.value())} (${name.value().length})`;

  return (
    <box id="Root" style={s.root}>
      <text style={s.title}>Text field</text>
      <text style={s.note}>Type in the field.</text>
      <text style={s.note}>Shift with the arrows selects.</text>
      <box {...pressBind} {...a11y(press.part)} style={s.button}>
        <text style={s.label}>{`Presses: ${count()}`}</text>
      </box>
      <text id="name-label" style={s.label}>Name</text>
      <box
        {...bindOf(input.bind(name.part))}
        {...a11y(name.part)}
        labelledBy="name-label"
        onClick={pressAt(name, "name-line")}
        style={s.field}
      >
        <Content field={name} id="name-line" />
      </box>
      <text style={s.note}>{readout()}</text>
      <text id="mail-label" style={s.label}>Read-only</text>
      <box
        {...input.bind(mail.part)}
        {...a11y(mail.part)}
        labelledBy="mail-label"
        onClick={pressAt(mail, "mail-line")}
        style={s.field}
      >
        <Content field={mail} id="mail-line" />
      </box>
      <box {...submitBind} {...a11y(submit.part)} style={s.button}>
        <text style={s.label}>Submit</text>
      </box>
      <text style={s.note}>{submitted() === null ? "Nothing submitted yet" : `Submitted: ${submitted()}`}</text>
    </box>
  );
}

/** The props of a field's row: `input.bind`, without its `onClick` (the page replaces it with `pressAt`). */
function bindOf(bind: Bind): Omit<Bind, "onClick"> {
  const { onClick: _press, ...rest } = bind;
  return rest;
}
