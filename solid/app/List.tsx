// The List page: thirty rows in a fixed-height viewport that Clay itself clips and scrolls. The viewport is one clip
// element (`css.overflow("hidden")`), so Clay keeps its scroll offset across frames: `ui_begin` moves it by the frame's
// wheel delta (`Clay_UpdateScrollContainers`), `ui_open` hands the offset back to the element before the layout, and the
// page moves it for the keyboard (`ui.scrollTo`) so that a selected row is always inside the viewport. The header and the
// footer are the viewport's siblings: they do not move.
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal } from "solid-js";

import { ui } from "../src/ffi.ts";
import type { FocusPart, Input } from "../src/input.ts";

// the same palette and the same 2px ring as the Widgets, Dialog and Text field pages
const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    title: { $value: "rgb(230 60 60)" },
    muted: { $value: "rgb(150 155 170)" },
    ink: { $value: "rgb(235 235 240)" },
    accent: { $value: "rgb(240 140 50)" },
    surface: { $value: "rgb(36 40 52)" },
    ring: { $value: "rgb(90 170 255)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    title: "rgb(200 30 40)",
    muted: "rgb(95 100 115)",
    ink: "rgb(25 27 34)",
    accent: "rgb(190 90 10)",
    surface: "rgb(255 255 255)",
    ring: "rgb(20 100 220)",
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
const detail = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(13));

const head = css.cn(css.width("stretch"), css.height(20), css.gap(8), css.alignItems("center"));
const foot = css.cn(css.width("stretch"), css.height(20));

// the viewport: a fixed height and `overflow: hidden` — Clay's clip element, which is also its scroll container. No
// padding, so a row's bounds are the viewport's top plus the offset plus the rows above it, exactly.
const view = css.cn(
  css.width("stretch"),
  css.height(240),
  css.gap(2),
  css.flexDirection("column"),
  css.overflow("hidden"),
  css.bg(t.color.page),
  css.borderRadius(8),
  css.border(1, t.color.muted),
);

// a row: the number dim and right-aligned, the label, the detail at the end. The selected row is the panel's surface with
// its label in the accent (as the tree's selected node) and takes the focus ring while the list has focus.
const row = css.cn(
  css.width("stretch"),
  css.height(28),
  css.p(0, 8),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(6),
  css.focus(css.border(2, t.color.ring)),
);
const rowSelected = css.cn(row, css.bg(t.color.surface));
const number = css.cn(css.width(24), css.justifyContent("flex-end"));
const numberText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(12));
const name = css.cn(css.width("stretch"));
const labelSelected = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(16));

export const s = { t, font, root, title, label, note, detail, head, foot, view, row, rowSelected, number, numberText, name, labelSelected };

/** The window: 28 + the title (37.5) + the header (20), the 240 viewport and the footer (20) end at 369.5, so the 24px
 *  bottom padding fits a 400 window with slack. */
export const size = { width: 360, height: 400 };

const COUNT = 30;
/** The rows a PageUp or a PageDown jumps: the viewport holds eight of the 30 (240 / 30). */
const PAGE = 8;
const VIEW = "list";
/** One row: its number, its name and a dim temperature. No state, no tree of its own. */
interface Row {
  readonly number: string;
  readonly label: string;
  readonly detail: string;
  readonly id: string;
}
const ROWS: readonly Row[] = Array.from({ length: COUNT }, (_unused, i) => ({
  id: `row-${i}`,
  number: String(i + 1).padStart(2, "0"),
  // Room A1 .. Room F5: six letters, five of each, so all thirty read apart
  label: `Room ${String.fromCharCode(65 + (i % 6))}${Math.floor(i / 6) + 1}`,
  detail: `${(18 + ((i * 7) % 11))}.${i % 10} °C`,
}));

/**
 * The page. One Tab stop: the viewport. Up and Down move the selection a row, PageUp and PageDown eight, Home and End go
 * to the ends; it clamps (it never wraps and never leaves 0..29) and every move scrolls the selected row into view. The
 * wheel scrolls the viewport under the pointer (Clay) and leaves the selection alone.
 */
export function List(props: { input: Input }) {
  const { input } = props;
  const [selected, setSelected] = createSignal(0);
  const [focused, setFocused] = createSignal(false);

  /** Scrolls the viewport the least it takes to show row `i`: the row's bounds (already shifted by the offset) against
   *  the viewport's, from the last frame. With both in view nothing moves. */
  const reveal = (i: number) => {
    const row = ui.bounds(Buffer.from(ROWS[i]!.id));
    const view = ui.bounds(Buffer.from(VIEW));
    if (!row || !view) return;
    const [, top, , height] = view;
    const [, rowTop, , rowHeight] = row;
    const below = rowTop! + rowHeight! - (top! + height!);
    const dy = rowTop! < top! ? top! - rowTop! : below > 0 ? -below : 0;
    if (dy) ui.scrollTo(VIEW, ui.scrollOffset(VIEW) + dy);
  };

  const select = (i: number) => {
    setSelected(i);
    reveal(i);
  };

  const part: FocusPart & { readonly disabled: boolean } = {
    id: VIEW,
    disabled: false,
    get focused() {
      return focused();
    },
    // the active row comes into view when the list gets the focus, as a browser does
    focus: () => {
      setFocused(true);
      reveal(selected());
    },
    blur: () => setFocused(false),
    keyDown: (key) => {
      const step =
        key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : key === "PageDown" ? PAGE : key === "PageUp" ? -PAGE : 0;
      const to = key === "Home" ? 0 : key === "End" ? COUNT - 1 : step ? selected() + step : -1;
      if (to < 0) return false;
      select(Math.max(0, Math.min(COUNT - 1, to)));
      return true;
    },
    keyUp: () => false,
  };
  const bind = input.add(part);

  const current = () => ROWS[selected()]!;

  return (
    <box id="Root" style={s.root}>
      <text style={s.title}>List</text>
      <box id="list-head" style={s.head}>
        <text style={s.note}>{`${current().label} — ${selected() + 1} of ${COUNT}`}</text>
      </box>
      <box {...bind} style={s.view}>
        {ROWS.map((r, i) => (
          <box id={r.id} focused={i === selected() && focused()} style={i === selected() ? s.rowSelected : s.row}>
            <box style={s.number}>
              <text style={s.numberText}>{r.number}</text>
            </box>
            <box style={s.name}>
              <text style={i === selected() ? s.labelSelected : s.label}>{r.label}</text>
            </box>
            <text style={s.detail}>{r.detail}</text>
          </box>
        ))}
      </box>
      <box id="list-foot" style={s.foot}>
        <text style={s.note}>Wheel, Up/Down, Page, Home/End.</text>
      </box>
    </box>
  );
}
