// A figure as an outline: what is on the frame, what it says, and where — compact, with an id on every node so a reader
// (or an agent) can point at one, and `--capture` gets its pixels.
//
// Taken from gpucanvas's agent view (MIT, berkantay), where `describe()` is "what is on the canvas as a short JSON tree
// with ids, and an image of any region, for an AI agent to read and point at", with wrappers that add nothing left out.
// A figure already has that tree without a DOM: `layoutOf` is its items, each with an id and a role, and every item's box
// is Clay's (`ui.bounds`). So the outline is the layout, one node an item that draws — a cell's words, a bar's fill, a
// swatch — and never the scaffolding: a line box, a cell around a text, a spacer between columns.
//
// The rects are rounded **out** to whole pixels: a capture must hold every pixel the node draws, and an item on a half
// pixel is an item whose box is one wider.
import { layoutOf, type Item } from "./kinds.ts";
import type { Spec } from "./spec.ts";

export interface OutlineNode {
  /** The item's id, as the page declares it (`fig-cell-3-1`, a bar's fill): what a focus and a test name it by. */
  id: string;
  /** The node's box in the frame's pixels: [x, y, w, h], whole pixels. */
  rect: [number, number, number, number];
  /** The words the node draws; a cell, a state box, a swatch's own colour. */
  text?: string;
}

export interface Outline {
  kind: string;
  title?: string;
  label?: string;
  /** The frame's size in pixels: the spec's cells, the padding and each line's height. */
  size: [number, number];
  nodes: OutlineNode[];
}

/** A sparkline point's glyph, as `text.ts` and `app/Figure.tsx` print it. */
const SPARK = "▁▂▃▄▅▆▇█";

/**
 * A figure's outline: one node an item of its layout that draws, in reading order, with the box Clay gave it. `bounds` is
 * the frame's own layout (`ui.bounds`); an id without a box (a text's, which the page names only for its colour) is left
 * out rather than given a guessed rect.
 */
export const outline = (
  spec: Spec,
  bounds: (id: string) => readonly number[] | undefined,
  size: [number, number],
): Outline => {
  const nodes: OutlineNode[] = [];
  const add = (id: string, text?: string) => {
    const box = bounds(id);
    if (!box) return;
    const [x, y, w, h] = box as [number, number, number, number];
    const left = Math.floor(x);
    const top = Math.floor(y);
    const node: OutlineNode = { id, rect: [left, top, Math.ceil(x + w) - left, Math.ceil(y + h) - top] };
    if (text !== undefined && text !== "") node.text = text;
    nodes.push(node);
  };
  const one = (item: Item) => {
    switch (item.kind) {
      case "space": // a spacer between columns: the layout's, not the figure's
        return;
      case "bar": // the track, then the fill whose width is the value
        add(item.id);
        add(item.fillId);
        return;
      case "spark": // the point's cell, then its bar
        add(item.id);
        add(item.fillId);
        return;
      case "swatch": // the step's colour is its word
        add(item.id, item.value);
        return;
      case "marker":
      case "shade":
        add(item.id);
        return;
      default: // a text and a state box: the box is the words' box
        add(item.id, item.text);
    }
  };
  for (const line of layoutOf(spec).lines) for (const item of line.items) one(item);
  return {
    kind: spec.kind,
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    ...(spec.label !== undefined ? { label: spec.label } : {}),
    size,
    nodes,
  };
};
