// The Figure page: one glyph-kit spec (solid/src/figure/spec.ts) declared as Clay's boxes and texts, so the numbers are
// geometry — a bar is a track box with a fill box whose width is the value's — and not characters. The same tree runs on
// the desktop (pixels), the terminal (cells) and the browser (a canvas): the layout speaks cells, and this page multiplies
// a cell by eight across and sixteen down, which is the rectangle terminal/cells.h gives a cell, so the three targets draw
// the same shape.
//
// The page is static: no state, no input, no entry. A width is data, and a style is a literal (the tokens are evaluated
// when a `.styles.ts` module loads), so every item's width goes through the value channel in `tick`, the frame's own hook,
// before the tree is declared — as the List's spacers and the terminal's re-cut do. A page at rest writes the same values
// every frame, so its hash does not move and it draws nothing after its first frame.
import { For } from "solid-js";

import type { Motion } from "../src/entry.ts";
import { layoutOf, sizeOf, type Item, type Layout, type Paint } from "../src/figure/kinds.ts";
import type { Spec } from "../src/figure/spec.ts";
import { FIELDS } from "../src/pack.ts";
import { ui } from "../src/ffi.ts";
import * as s from "./Figure.styles.ts";

const ids = new Map<string, Uint8Array>();
const idBytes = (id: string) => ids.get(id) ?? (ids.set(id, new TextEncoder().encode(id)), ids.get(id)!);
const put = (id: string, field: number, value: number) => ui.value(idBytes(id), field, value);
/** A FIXED axis through the value channel: the type, then the min and the max (pack.ts's `axis`, Clay's FIXED takes the
 *  pair). */
const fixedWidth = (id: string, px: number) => {
  put(id, FIELDS.WIDTH, 3);
  put(id, FIELDS.WIDTH + 1, px);
  put(id, FIELDS.WIDTH + 2, px);
};
/** A line's own height, the same way: a type scale's 40px row is three cells. */
const fixedHeight = (id: string, px: number) => {
  put(id, FIELDS.HEIGHT, 3);
  put(id, FIELDS.HEIGHT + 1, px);
  put(id, FIELDS.HEIGHT + 2, px);
};

/** A `#rrggbb` as the three channels the value channel writes: a swatch is the palette's own colour. */
function rgbOf(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1] ?? "000000";
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** A sparkline point's glyph, the same eight of `text.ts`'s `SPARK` (the page keeps its own copy: text.ts reads files). */
const SPARK = "▁▂▃▄▅▆▇█";

/** Every item's width, a bar's fill, a swatch's colour and a line's height, written for the frame about to be declared
 *  (the channel is a frame's). */
function apply(l: Layout, motion: Motion | undefined): void {
  if (!motion) return;
  motion.tick = () => {
    for (const line of l.lines) {
      if (line.id !== undefined && (line.height ?? 1) !== 1) fixedHeight(line.id, line.height! * 16);
      for (const item of line.items) {
        fixedWidth(item.id, item.cells * 8);
        if (item.kind === "bar") fixedWidth(item.fillId, item.fill * 8);
        // a sparkline's point is its bar's height, an eighth of the cell a step: 2px a step of the 16px cell
        if (item.kind === "spark") fixedHeight(item.fillId, (item.eighth + 1) * 2);
        if (item.kind === "swatch") {
          const [r, g, b] = rgbOf(item.value);
          put(item.id, FIELDS.BACKGROUND, r);
          put(item.id, FIELDS.BACKGROUND + 1, g);
          put(item.id, FIELDS.BACKGROUND + 2, b);
        }
      }
    }
  };
}

const styleOf = (paint: Paint) => s.s.text[paint];

function ItemView(props: { item: Item }) {
  const it = props.item;
  if (it.kind === "bar")
    return (
      <box id={it.id} style={s.s.track}>
        <box
          id={it.fillId}
          style={s.s.fill[it.paint === "problem" ? "problem" : it.paint === "good" ? "good" : "plain"]}
        />
      </box>
    );
  // a palette's two: the swatch's colour and the marker's role are the value channel's and the style's, not the data's
  if (it.kind === "swatch") return <box id={it.id} style={s.s.swatch} />;
  if (it.kind === "marker") return <box id={it.id} style={s.s.marker} />;
  // a heatmap's cell is its band's shade, and a sparkline's point a bar of its eighth with the glyph the terminal prints
  if (it.kind === "shade") return <box id={it.id} style={s.s.shade[it.level]} />;
  if (it.kind === "spark")
    return (
      <box id={it.id} style={s.s.sparkCell}>
        <box id={it.fillId} style={s.s.sparkBar}>
          <text id={it.textId} style={s.s.sparkGlyph}>
            {SPARK[it.eighth] ?? ""}
          </text>
        </box>
      </box>
    );
  if (it.kind === "space") return <box id={it.id} style={s.s.cell} />;
  // a type scale's specimen is drawn at its own size: a sized text gets a cell as tall as its line, so a 40px "Aa" is
  // not centred in a 16px row and does not reach the row above it
  const sized = it.kind === "text" && it.size !== undefined ? it.size : undefined;
  const known = sized !== undefined && sized in s.s.typeSize;
  return (
    <box id={it.id} style={it.kind === "box" ? s.s.box : known ? s.s.typeCell[sized as keyof typeof s.s.typeCell] : s.s.cell}>
      <text id={it.textId} style={known ? s.s.typeSize[sized as keyof typeof s.s.typeSize] : styleOf(it.paint)}>
        {it.text}
      </text>
    </box>
  );
}

/** The page's size in pixels, from the spec: what `ui.init` gets and what a browser canvas takes. */
export function size(spec: Spec): { width: number; height: number } {
  return sizeOf(spec);
}

/** The page: the title, the rows (a label, a bar or boxes, the number as text), the source and the focus line. */
export function Figure(props: { spec: Spec; motion?: Motion }) {
  const l = layoutOf(props.spec);
  apply(l, props.motion);
  return (
    <box id="Root" style={s.s.root}>
      <For each={l.lines}>
        {(line) => (
          <box id={line.id} style={s.s.line}>
            <For each={line.items}>{(item) => <ItemView item={item} />}</For>
          </box>
        )}
      </For>
    </box>
  );
}
