// The Dialog page: a settings screen with the two overlays of `headless/`. A modal dialog on a dim backdrop (both
// Clay root floats: the backdrop swallows the pointer, the dialog is centred on the page) and a menu button whose
// panel floats under its trigger. The styles live in this file, as on the Widgets page.
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal, Show } from "solid-js";

import {
  createButton,
  createDialogModal,
  createMenu,
} from "../../headless/src/index.ts";
import type { Input } from "../src/input.ts";
import { a11y } from "../a11y.ts";

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
    shadow: { $value: "rgb(8 10 14)" },
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
    shadow: "rgb(60 64 78)",
  },
});
const font = css.fonts("Roboto");

const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(28, 40, 24, 40),
  css.gap(10),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
const title = css.cn(font.Roboto, css.color(t.color.title), css.fontSize(32));
const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16));
const note = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));
const mark = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(18));

// the rows of the page and the dialog's buttons: the pill of the Widgets page
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
const row = css.cn(
  css.width("stretch"),
  css.p(8, 12),
  css.gap(10),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(10),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const pill = css.cn(
  css.p(2, 10),
  css.bg(t.color.off),
  css.borderRadius(10),
  css.justifyContent("center"),
  css.alignItems("center"),
);
const pillText = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(14));

// the backdrop: a root float over the whole page, dimming it and taking the pointer. ThorVG composites its alpha.
const backdrop = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.bg("rgb(0 0 0 / 0.55)"),
  css.float({ root: true, attach: { element: "left top", parent: "left top" }, zIndex: 1, capture: true }),
);
// the dialog: a root float centred on the page, above the backdrop
const panel = css.cn(
  css.width(280),
  css.p(18),
  css.gap(10),
  css.flexDirection("column"),
  css.bg(t.color.surface),
  css.borderRadius(12),
  css.border(1, t.color.muted),
  css.float({
    root: true,
    attach: { element: "center center", parent: "center center" },
    zIndex: 2,
    capture: true,
  }),
);
const dialogTitle = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(20));
const actions = css.cn(css.width("stretch"), css.gap(10));

// the menu: a float attached to its trigger's left-bottom corner, one row per item
const menuPanel = css.cn(
  css.width(150),
  css.p(6),
  css.gap(2),
  css.flexDirection("column"),
  css.bg(t.color.surface),
  css.borderRadius(10),
  css.border(1, t.color.muted),
  css.float({
    parent: "zoom-trigger",
    attach: { element: "left top", parent: "left bottom" },
    offset: { y: 4 },
    zIndex: 10,
  }),
);
const item = css.cn(
  css.width("stretch"),
  css.p(5, 8),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(6),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const dot = css.cn(css.width(8), css.height(8), css.borderRadius(4), css.bg(t.color.accent));

export const s = {
  t,
  font,
  root,
  title,
  label,
  note,
  mark,
  button,
  row,
  pill,
  pillText,
  backdrop,
  panel,
  dialogTitle,
  actions,
  menuPanel,
  item,
  dot,
};

/** The window of the page. */
export const size = { width: 360, height: 480 };

const ZOOMS = ["100%", "125%", "150%", "200%"];

/**
 * The settings screen. The dialog's Open button is the page's own button: while the dialog is open the backdrop takes
 * every press and `input.modal` every key, so the page behind is unreachable. OK writes 55% onto the page, Cancel and
 * Escape close without writing. The menu reports the zoom it last picked next to its trigger.
 */
export function Dialog(props: { input: Input }) {
  const { input } = props;
  const [volume, setVolume] = createSignal(40);
  const [changed, setChanged] = createSignal(false);
  const [zoom, setZoom] = createSignal(0);

  const dialog = createDialogModal({ id: "settings", focus: input.focus, labelledby: "settings-title" });
  const cancel = createButton({ id: "cancel", onClick: () => dialog.close() });
  const ok = createButton({
    id: "ok",
    onClick: () => {
      setVolume(55);
      setChanged(true);
      dialog.close();
    },
  });
  const bind = {
    open: input.add(dialog.trigger),
    cancel: input.bind(dialog.add(cancel.part)),
    ok: input.bind(dialog.add(ok.part)),
  };

  const menu = createMenu({
    id: "zoom",
    items: ZOOMS,
    focus: input.focus,
    onItemClick: (index) => setZoom(index),
  });
  const menuBind = {
    trigger: input.add(menu.trigger),
    items: ZOOMS.map((_label, index) => input.bind(menu.item(index))),
  };

  // the modal trap: tab cycles the dialog's controls, Escape closes it; other keys go to the focused control
  input.modal = (name, repeat) => dialog.open() && dialog.keyDown(name, repeat);

  return (
    <box id="Root" style={s.root}>
      <text style={s.title}>Settings</text>
      <text style={s.note}>A modal dialog on a dimmed page, and a menu that floats under its trigger.</text>
      <box {...bind.open} {...a11y(dialog.trigger)} style={s.button}>
        <text style={s.label}>Open settings</text>
      </box>
      <text style={s.label}>{`Volume: ${volume()}%${changed() ? " (just set)" : ""}`}</text>
      <box {...menuBind.trigger} {...a11y(menu.trigger)} label={`Zoom: ${ZOOMS[zoom()]}`} style={s.row}>
        <text style={s.label}>Zoom</text>
        <box style={s.pill}>
          <text style={s.pillText}>{ZOOMS[zoom()]}</text>
        </box>
        <text style={s.mark}>{menu.open() ? "-" : "+"}</text>
      </box>
      <Show when={menu.open()}>
        <box {...a11y(menu.menu)} label="Zoom" style={s.menuPanel}>
          {ZOOMS.map((name, index) => (
            <box {...menuBind.items[index]!} {...a11y(menu.item(index))} style={s.item}>
              <text style={s.label}>{name}</text>
              <Show when={index === zoom()}>
                <box style={s.dot} />
              </Show>
            </box>
          ))}
        </box>
      </Show>
      <Show when={dialog.open()}>
        <box id={dialog.backdrop.id} style={s.backdrop} onPress={() => {}} />
        <box {...a11y(dialog.dialog)} style={s.panel} onPress={() => {}}>
          <text id="settings-title" style={s.dialogTitle}>Set the volume</text>
          <text style={s.note}>OK sets it to 55%. Cancel or Escape leaves it at {volume()}%.</text>
          <box style={s.actions}>
            <box {...bind.cancel} {...a11y(cancel.part)} style={s.button}>
              <text style={s.label}>Cancel</text>
            </box>
            <box {...bind.ok} {...a11y(ok.part)} style={s.button}>
              <text style={s.label}>OK</text>
            </box>
          </box>
        </box>
      </Show>
    </box>
  );
}
