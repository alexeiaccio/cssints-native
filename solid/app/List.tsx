// The List page: a fixed-height viewport whose offset the page owns (src/vscroll.ts — the Sky feed's machine), and whose
// rows are windowed (src/virtual.ts): only the visible ones plus an overscan are declared, with a spacer box above and
// below standing in for the rest, so the page costs what the screen shows and not what the list holds (`count` rows, 30 by
// default; the 1,000-row page is the same page). The selected row is a window of its own (src/virtual.ts's `segments`): a
// wheel can move the content away from it, and it is still declared, at its own place and clipped out of the viewport, so
// its box, its fill, its ring and its a11y node exist without declaring the range between it and the visible rows.
// The viewport is still one clip element (`css.overflow("hidden")`) with
// the same id, so the renderer's scissor cuts what leaves the box, but the offset is the page's:
// `ui.scrollPut`/`ui.scrollTo` write it every frame before the tree is declared, and `ui.autoScroll(false)` keeps Clay's
// own wheel scrolling out of the way. The wheel accumulates 10px notches (a flick flings), a press inside the viewport
// drags it 1:1 with a 4px click threshold (a click that does not travel selects the row under it; a drag does not), a drag
// or a wheel past an end pulls a rubber band that springs back 80ms after the last input, and the keyboard eases the
// track to the offset that shows the moved row (the reveal). Reduced motion has no band and no fling, and a key lands at
// once. The scrollbar is the machine's too (`BAR`): a 4px thumb on the viewport's right edge that fades in while the rows
// move, fades out 600ms after they stop, and drags the viewport from where it is pressed. The header and the footer are
// the viewport's siblings: they do not move.
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal, For, onCleanup } from "solid-js";

import { pageEntry, type Motion } from "../src/entry.ts";
import { FIELDS } from "../src/pack.ts";
import { fixedWindow, segments, SPACER } from "../src/virtual.ts";
import { scroll } from "../src/vscroll.ts";
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

// the viewport's id: the clip element, Clay's scroll container, and the floats' parent
const VIEW = "list";
// the scrollbar's vertical thumb (src/vscroll.ts writes its height, its top and its opacity every frame): 4px at the
// viewport's inner right edge, a 2px inset (the float's right edge is the viewport's, so the offset x is -2), rounded, the
// muted token. It is a float on the viewport, so Clay positions it from the viewport's own box: it does not travel with the
// rows.
const BAR = "list-thumb";
// ... and the horizontal one, the same 4px bar turned: at the viewport's inner bottom edge, 2px up, its width and its left
// written every frame by the same machine (`scroll`'s second axis). With both, the machine shortens the vertical thumb's
// travel by 6px (the bar and its inset), so the two meet at the corner and do not overlap.
const BAR_X = "list-thumb-x";
const thumb = css.cn(
  css.width(4),
  css.height(24),
  css.borderRadius(2),
  css.bg(t.color.muted),
  css.float({
    parent: VIEW,
    attach: { element: "right top", parent: "right top" },
    offset: { x: -2 },
    zIndex: 1,
    capture: false, // a visible thumb takes the press through the value channel (FIELDS.CAPTURE); at rest the page's
  }),
);
const thumbX = css.cn(
  css.width(24),
  css.height(4),
  css.borderRadius(2),
  css.bg(t.color.muted),
  css.float({
    parent: VIEW,
    attach: { element: "left bottom", parent: "left bottom" },
    offset: { y: -2 },
    zIndex: 1,
    capture: false,
  }),
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
// the wide layout (`--wide`): the same 28px rows, 900px wide, so the viewport shows their first 280px and the rest is a
// horizontal scroll. The name is a fixed cell, the note a fixed cell with `overflow: hidden` — a clip of its own, so the
// long line is cut at the cell instead of widening the row — the temperature stays the row's own text, and a second column
// of values sits past the viewport's edge, which is what there is to scroll to. The widths are a layout matter only: the
// vertical window still counts 28px rows with a 2px gap.
const WIDE = 900;
const rowWide = css.cn(row, css.width(WIDE));
const rowWideSelected = css.cn(rowWide, css.bg(t.color.surface));
const nameWide = css.cn(css.width(150));
const noteBox = css.cn(css.width(320), css.overflow("hidden"));
const noteText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(13));
const more = css.cn(css.width(250));
const moreText = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(13));
// a window's spacer: an empty box in the same column as the rows, its height written every frame through the value
// channel's FIXED axis (fields 4 and 5, as the scrollbar's thumb writes its own), so no style depends on the data
const spacer = css.cn(css.width("stretch"), css.height(0));

export const s = {
  t,
  font,
  root,
  title,
  label,
  note,
  detail,
  head,
  foot,
  view,
  thumb,
  thumbX,
  spacer,
  row,
  rowSelected,
  rowWide,
  rowWideSelected,
  number,
  numberText,
  name,
  nameWide,
  noteBox,
  noteText,
  more,
  moreText,
  labelSelected,
  WIDE,
};

/** The window: 28 + the title (37.5) + the header (20), the 240 viewport and the footer (20) end at 369.5, so the 24px
 *  bottom padding fits a 400 window with slack. */
export const size = { width: 360, height: 400 };

/** A row's height and the column's gap, as the styles above have them (28 and 2): the window's arithmetic. */
const ROW = 28;
const GAP = 2;
/** The overscan either side of the viewport: with nine rows visible in 240px, the page declares at most eleven. The fixed
 *  heights need no slack to find the window (it is arithmetic); one item either side keeps the clip's edge covered. */
const OVERSCAN = 1;
/** The rows a PageUp or a PageDown jumps: the viewport holds eight of them (240 / 30). */
const PAGE = 8;
const ABOVE = "list-above";
const MIDDLE = "list-mid";
const BELOW = "list-below";
/** One row: its number, its name and a dim temperature (and the wide layout's note and second column). No state, no tree
 *  of its own. */
interface Row {
  readonly number: string;
  readonly label: string;
  readonly detail: string;
  readonly note: string;
  readonly more: string;
  readonly id: string;
}
/** Row `i` ("Room A1" .. "Room F5": six letters, five of each, so thirty read apart — and the same pattern past them). */
const rowAt = (i: number): Row => ({
  id: `row-${i}`,
  number: String(i + 1).padStart(2, "0"),
  label: `Room ${String.fromCharCode(65 + (i % 6))}${Math.floor(i / 6) + 1}`,
  detail: `${(18 + ((i * 7) % 11))}.${i % 10} °C`,
  note:
    `${i % 3 === 0 ? "Long" : "East"} table under the window, six sockets in the floor, ` +
    "a projector and a whiteboard; booked until 18:00 on weekdays.",
  more: `${8 + (i % 9)} seats · ${4 + (i % 6)} sockets · wing ${String.fromCharCode(65 + (i % 6))}`,
});

/**
 * The page (`count` rows, 30 by default). One Tab stop: the viewport. Up and Down move the selection a row, PageUp and
 * PageDown eight, Home and End go to the ends; it clamps (it never wraps and never leaves 0..count-1) and every move
 * eases the viewport to the offset that shows the selected row. The wheel scrolls the viewport under the pointer 10px a
 * notch (a flick flings) and leaves the selection alone, and a held pointer drags it 1:1 — the drag never selects. On its
 * first mount the page rises 8px and fades in once (src/entry.ts).
 *
 * `wide` is the page's horizontal layout (`--wide`): the same 28px rows, 900px wide inside the same 280px viewport, so the
 * wheel's dx (a trackpad's swipe, or a shift+vertical wheel) and the horizontal bar scroll the row's second half. The
 * vertical window and the keys are untouched: the widths are a layout matter, the heights and the gaps are not. It is a
 * prop, so the default page declares the same tree as before and its stored frames are byte-identical.
 */
export function List(props: { input: Input; motion?: Motion; count?: number; wide?: boolean }) {
  const { input } = props;
  const wide = props.wide === true;
  const count = props.count ?? 30;
  // the rows' whole block: the page's real content, which the clamp and the thumb read — not the declared subset's
  const content = count > 0 ? count * ROW + (count - 1) * GAP : 0;
  const [selected, setSelected] = createSignal(0);
  const [focused, setFocused] = createSignal(false);
  // the declared window: the cells the tree renders (a spacer's sentinel, the rows' indexes, the other spacer's) — a
  // signal, so the tree updates only when the window moved; the spacer heights go to their boxes through the value
  // channel in `tick`
  const [cells, setCells] = createSignal<number[]>([]);
  pageEntry(props.motion);
  // the entry's tick, which the page's own scroll ticks beside (the entry sets `motion.tick` itself)
  const entry = props.motion?.tick;
  // the page owns the viewport's offset: Clay's own wheel scrolling is off, and the track (src/vscroll.ts) writes it
  ui.autoScroll(false);
  onCleanup(() => ui.autoScroll(true));

  const viewId = Buffer.from(VIEW);
  const barId = Buffer.from(BAR);
  const barXId = wide ? Buffer.from(BAR_X) : undefined;
  const aboveId = Buffer.from(ABOVE);
  const middleId = Buffer.from(MIDDLE);
  const belowId = Buffer.from(BELOW);
  /** The viewport's height and width from the last layout (0 on the first frame). */
  const viewH = () => ui.bounds(viewId)?.[3] ?? 0;
  const viewW = () => ui.bounds(viewId)?.[2] ?? 0;

  /** How far the viewport can scroll: the rows' whole block, less the viewport's height. 0 when they fit. */
  const maxScroll = () => Math.max(0, content - viewH());
  /** ... and sideways: the widest row less the viewport's width. 0 unless the page is `wide`. */
  const maxScrollX = () => (wide ? Math.max(0, WIDE - viewW()) : 0);

  /** The viewport's scroll: the wheel's 10px, the drag, the band and the fling, on the page's track. The scrollbar's thumb
   *  (`BAR`) is the machine's too: it writes its box and its fade every frame. A wide page adds the horizontal axis and its
   *  bar (`BAR_X`); the machine then also tilts the fade, so both bars show and hide together. */
  const viewScroll = scroll(VIEW, maxScroll, BAR, wide ? { max: maxScrollX, bar: BAR_X } : undefined);

  /** Eases the viewport to the least offset that shows row `i`. The row's place is its bounds from the last frame — every
   *  row the column declares has a box, the selected one included when it is outside the viewport (the offset added back,
   *  as the row is drawn shifted by the clip's own offset); a row declared for the first time on this key's frame (the
   *  selection moved to one the window did not hold) has no bounds yet, and its place is the window's arithmetic —
   *  `i·(row + gap)`. Either way it is compared with the track's own target, not the presented offset, so a key pressed
   *  while the track is still travelling still lands where the row is. With the row in view nothing moves. */
  const reveal = (i: number) => {
    const row = ui.bounds(Buffer.from(`row-${i}`));
    const view = ui.bounds(viewId);
    if (!view) return;
    const top = row ? row[1]! - view[1]! - ui.scrollOffset(VIEW) : i * (ROW + GAP);
    const at = viewScroll.target();
    const to = top < at ? top : top + ROW > at + view[3]! ? top + ROW - view[3]! : at;
    if (to !== at) viewScroll.seek(to);
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
      const to = key === "Home" ? 0 : key === "End" ? count - 1 : step ? selected() + step : -1;
      if (to < 0 || count <= 0) return false;
      select(Math.max(0, Math.min(count - 1, to)));
      return true;
    },
    keyUp: () => false,
  };
  const bind = input.add(part);

  // the frame: the entry writes its two group fields, then the scroll retargets on the wheel and a key and writes the
  // viewport's offset, all before the tree is declared; then the column is the one that offset shows, plus the selected
  // row (a range of its own: the wheel can leave it behind, and its box is still declared, outside the viewport)
  let shown: number[] = [];
  const tick = (dt: number) => {
    entry?.(dt);
    viewScroll.tick(dt);
    const w = fixedWindow({
      offset: -ui.scrollOffset(VIEW),
      view: viewH(),
      count,
      item: ROW,
      gap: GAP,
      overscan: OVERSCAN,
    });
    // the cells are one `For`'s: the spacers and the rows in the column's order (see `segments`)
    const seg = segments(w, { count, slot: ROW + GAP, gap: GAP, extra: selected() });
    if (seg.cells.length !== shown.length || seg.cells.some((cell, i) => cell !== shown[i])) {
      shown = seg.cells;
      setCells(seg.cells);
    }
    // the spacers' heights are a FIXED axis's min and max, written every frame (the channel is a frame's) as the thumb's
    // are; an absent spacer's write lands on no element, which is nothing
    ui.value(aboveId, FIELDS.HEIGHT + 1, seg.above);
    ui.value(aboveId, FIELDS.HEIGHT + 2, seg.above);
    ui.value(middleId, FIELDS.HEIGHT + 1, seg.middle);
    ui.value(middleId, FIELDS.HEIGHT + 2, seg.middle);
    ui.value(belowId, FIELDS.HEIGHT + 1, seg.below);
    ui.value(belowId, FIELDS.HEIGHT + 2, seg.below);
  };
  // Clay scrolled the container under the pointer only; a page that owns the offset has to keep that rule itself, or a
  // wheel over the title would scroll the rows. The visible thumb is chrome of the viewport: the wheel over it scrolls too.
  const wheel = (dx: number, dy: number) => {
    if (ui.over(viewId) || ui.over(barId) || (barXId !== undefined && ui.over(barXId))) viewScroll.wheel(dx, dy);
  };
  if (props.motion)
    (props.motion.onWheel = wheel),
      (props.motion.onPointer = viewScroll.pointer),
      (props.motion.tick = tick);

  const current = () => rowAt(selected());

  return (
    <box id="Root" style={s.root}>
      <text style={s.title}>List</text>
      <box id="list-head" style={s.head}>
        <text style={s.note}>{`${current().label} — ${selected() + 1} of ${count}`}</text>
      </box>
      <box {...bind} onPress={() => (bind.onPress(), viewScroll.press())} style={s.view}>
        {/* the window: a spacer for the rows above, the declared rows, a spacer for the ones below — all cells of one
            `For`, so they are in that order in the viewport's gap-spaced column and the declared rows are where the full
            list would have put them. A selected row the window left behind is a cell of its own, with a spacer between it
            and the rows when they are not adjacent */}
        <For each={cells()}>
          {(cell) => {
            if (cell === SPACER.above) return <box id={ABOVE} style={s.spacer} />;
            if (cell === SPACER.middle) return <box id={MIDDLE} style={s.spacer} />;
            if (cell === SPACER.below) return <box id={BELOW} style={s.spacer} />;
            const r = rowAt(cell);
            return (
              <box
                id={r.id}
                // a press that did not travel selects the row, as a browser's list does; a drag belongs to the scroll, and
                // its release lands on the row it started on, so it must not select
                onClick={() => {
                  if (!viewScroll.dragged) select(cell);
                }}
                focused={cell === selected() && focused()}
                style={
                  cell === selected()
                    ? wide
                      ? s.rowWideSelected
                      : s.rowSelected
                    : wide
                      ? s.rowWide
                      : s.row
                }
              >
                <box style={s.number}>
                  <text style={s.numberText}>{r.number}</text>
                </box>
                <box style={wide ? s.nameWide : s.name}>
                  <text style={cell === selected() ? s.labelSelected : s.label}>{r.label}</text>
                </box>
                {/* the wide row's note: a fixed cell that clips its line, so a long note never widens the row */}
                {wide ? (
                  <box style={s.noteBox}>
                    <text style={s.noteText}>{r.note}</text>
                  </box>
                ) : null}
                <text style={s.detail}>{r.detail}</text>
                {/* ... and its second column of values, past the viewport's first 280px */}
                {wide ? (
                  <box style={s.more}>
                    <text style={s.moreText}>{r.more}</text>
                  </box>
                ) : null}
              </box>
            );
          }}
        </For>
      </box>
      {/* the scrollbars: floats on the viewport, over the rows and outside the clip's child offset (they do not scroll) */}
      <box id={BAR} style={s.thumb} onPress={() => viewScroll.thumb()} />
      {wide ? <box id={BAR_X} style={s.thumbX} onPress={() => viewScroll.thumbX()} /> : null}
      <box id="list-foot" style={s.foot}>
        <text style={s.note}>{wide ? "Wheel, sideways, Up/Down." : "Wheel, Up/Down, Page, Home/End."}</text>
      </box>
    </box>
  );
}
