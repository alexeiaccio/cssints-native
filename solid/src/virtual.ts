// The window: which items a scrolling page declares this frame. A list of thousands costs what the screen shows if the
// page declares only the visible items plus an overscan, and two spacer boxes stand in for the items above and below
// them: the clip element's content height, and so the scroll's clamp and the thumb, stay the real page's.
//
// The items and the spacers are children of one gap-spaced column, so a spacer's own gap is taken out of its height
// (`above = first·slot - gap`): the first item starts at `above + gap`, and the items above are `first·slot` worth of
// content. At an end there is no spacer at all — a zero-height box would still add its gap.
//
// Two shapes. `fixedWindow` is arithmetic: every item is `item` px and the nth item starts at `n·(item + gap)`.
// `measuredWindow` is for items whose heights differ: a height per index (a cache the page fills from `ui.bounds`), and a
// fallback for the ones not measured yet (the mean of the measured ones, or `fallback` when none is). It **measures once,
// then virtualizes**: while any height is unknown every item is declared, so one (or a couple of) frames pay the whole
// column's declare and every frame after it has exact heights — the content, the clamp and the thumb's end do not move as
// items are first seen. The fallback is only the estimate those measuring frames read.
//
// `segments` is the column a page lays out: the window's items, an optional extra index the window must also declare (a
// list's selection, which the scroll has left behind), and the spacers that stand in for the items between them, so the
// declared column is exactly where the whole list would have put it.
//
// ponytail: `measuredWindow` builds a prefix sum over the heights on every call (O(n) a frame; n is a feed, not a
// dataset). A persistent prefix sum maintained as heights arrive, or a binary search over a running total, is the
// upgrade if hundreds of thousands of items ever matter. The measuring pass is O(n) declared boxes on its frames: 200
// cards are 0.85ms of declare (1.07 the median of five mounts) against 0.024ms a frame once the window is back, 1,000
// are 4.9ms, and 2,000 declared boxes already overflow this build's Clay element capacity. A page of thousands would
// therefore want Clay's element count raised and the pass in chunks over idle frames, the content's end estimated until
// the last chunk; no page here has more than a feed of hundreds, so nothing does.

/** The items declared either side of the viewport, on top of the ones it shows. */
export const OVERSCAN = 2;

/** A window: the indexes to declare (`first..last`, inclusive), the spacer heights above and below them, and the real
 *  content height of *all* the items and the gaps between them (the clamp's and the thumb's, not the declared subset's). */
export interface Window {
  /** The first item to declare, 0..count-1 (`last < first` when there is nothing). */
  readonly first: number;
  /** The last item to declare, inclusive. */
  readonly last: number;
  /** The height of the top spacer box, px: 0 when `first` is 0 and there is no spacer. */
  readonly above: number;
  /** The height of the bottom spacer box, px: 0 when `last` is the last item and there is no spacer. */
  readonly below: number;
  /** The real content's height — every item and the gaps between them, not just the declared ones' (the clamp's and
   *  the thumb's). */
  readonly content: number;
}

const NONE: Window = { first: 0, last: -1, above: 0, below: 0, content: 0 };
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** The window of `count` items of one `item` height, `gap` between them, for a viewport `view` tall at `offset` (positive
 *  down, as the page's scroll reports it). */
export function fixedWindow(opts: {
  offset: number;
  view: number;
  count: number;
  item: number;
  gap: number;
  overscan?: number;
}): Window {
  const { offset, view, count, item, gap } = opts;
  if (!(count > 0) || !(item > 0)) return NONE;
  const overscan = opts.overscan ?? OVERSCAN;
  const slot = item + gap;
  const content = count * item + (count - 1) * gap;
  const y = clamp(offset, 0, Math.max(content - view, 0));
  // the item whose slot holds the viewport's top, and the last one whose top is above its bottom (an item starting at
  // exactly the bottom is not visible)
  const firstVisible = Math.min(count - 1, Math.floor(y / slot));
  const lastVisible = Math.min(count - 1, Math.max(firstVisible, Math.ceil((y + view) / slot) - 1));
  const first = clamp(firstVisible - overscan, 0, count - 1);
  const last = clamp(lastVisible + overscan, first, count - 1);
  return {
    first,
    last,
    above: first ? first * slot - gap : 0,
    below: last === count - 1 ? 0 : (count - 1 - last) * slot - gap,
    content,
  };
}

/**
 * The window of items of different heights: `heights[i]` where the page has measured one, and a fallback — the mean of
 * the measured heights, or `fallback` (190) when none is yet — for the rest. `gap` is the column's gap, and the offset
 * and the viewport are in the items' own block (the page takes its padding out of the offset before asking).
 *
 * While a height is unknown the whole column is declared (`first` 0, `last` count-1, no spacers): the page measures them
 * all on that frame, and every frame after it has real heights. `content` is the mean's estimate on those frames and the
 * exact block once the pass is over.
 */
export function measuredWindow(opts: {
  offset: number;
  view: number;
  count: number;
  heights: readonly (number | undefined)[];
  gap: number;
  fallback?: number;
  overscan?: number;
}): Window {
  const { offset, view, count, heights, gap } = opts;
  if (!(count > 0)) return NONE;
  const overscan = opts.overscan ?? OVERSCAN;
  // the fallback: the mean of what has been measured, so an unseen item is the size of the feed's typical one — and
  // whether any item is still unseen, which is the measuring pass
  let measured = 0,
    sum = 0,
    unknown = false;
  for (let i = 0; i < count; i++) {
    const h = heights[i];
    if (h && h > 0) measured++, (sum += h);
    else unknown = true;
  }
  const mean = measured ? sum / measured : (opts.fallback ?? 190);
  const h: number[] = new Array(count);
  const top: number[] = new Array(count + 1); // the item's top in the items' block, gaps included
  top[0] = 0;
  for (let i = 0; i < count; i++) {
    const v = heights[i];
    h[i] = v && v > 0 ? v : mean;
    top[i + 1] = top[i]! + h[i]! + gap;
  }
  const content = top[count]! - gap;
  // measure once, then virtualize: an item without a height is declared, the whole column at once, and the page's next
  // frame has nothing left to measure
  if (unknown) return { first: 0, last: count - 1, above: 0, below: 0, content };
  const y = clamp(offset, 0, Math.max(content - view, 0));
  let firstVisible = 0;
  while (firstVisible < count - 1 && top[firstVisible]! + h[firstVisible]! <= y) firstVisible++;
  let lastVisible = firstVisible;
  while (lastVisible < count - 1 && top[lastVisible + 1]! < y + view) lastVisible++;
  const first = clamp(firstVisible - overscan, 0, count - 1);
  const last = clamp(lastVisible + overscan, first, count - 1);
  return {
    first,
    last,
    above: first ? top[first]! - gap : 0,
    below: last === count - 1 ? 0 : content - top[last]! - h[last]! - gap,
    content,
  };
}

/** A spacer's cell in a windowed column: a sentinel no item's index can be (indexes are 0..count-1). */
export const SPACER = { above: -1, middle: -2, below: -3 } as const;

/** A windowed column's cells and the height of each of its spacers (0 for one that is not in `cells`). */
export interface Segments {
  /** The cells, in order: an item's index, or one of `SPACER`'s three. */
  readonly cells: number[];
  readonly above: number;
  /** Between the window and an extra item outside it (0 when the two are adjacent, or when there is no extra one). */
  readonly middle: number;
  readonly below: number;
}

/**
 * The column of `w`'s items — plus one item the window must declare although it is outside it (`extra`: a list's
 * selection after the wheel has moved the content away from it), so its box is in the tree — with the spacers that stand
 * in for the items not declared. The order follows the indexes (the extra one before the window's items or after them),
 * and each spacer takes its own gap out as the window's do, so the column's layout, its total height, and every declared
 * item's place are the whole list's: an extra item outside the viewport changes no pixel, it only adds a clipped box.
 * An `extra` inside `first..last` is already declared and changes nothing.
 */
export function segments(
  w: Window,
  opts: { count: number; slot: number; gap: number; extra?: number },
): Segments {
  const { count, slot, gap } = opts;
  const none: Segments = { cells: [], above: 0, middle: 0, below: 0 };
  if (w.last < w.first) return none;
  const extra = opts.extra ?? -1; // -1: no extra item (no index is negative)
  const before = extra >= 0 && extra < w.first;
  const after = extra > w.last && extra < count;
  const top = before ? extra : w.first;
  const bottom = after ? extra : w.last;
  // the items from `from` to `to` not declared, as a spacer: `(to - from - 1)` slots less the gap it takes itself
  const between = (from: number, to: number) => (to - from > 1 ? (to - from - 1) * slot - gap : 0);
  const above = top > 0 ? top * slot - gap : 0;
  const middle = before ? between(extra, w.first) : after ? between(w.last, extra) : 0;
  const below = bottom === count - 1 ? 0 : (count - 1 - bottom) * slot - gap;
  const cells: number[] = [];
  if (above > 0) cells.push(SPACER.above);
  if (before) {
    cells.push(extra);
    if (middle > 0) cells.push(SPACER.middle);
  }
  for (let i = w.first; i <= w.last; i++) cells.push(i);
  if (after) {
    if (middle > 0) cells.push(SPACER.middle);
    cells.push(extra);
  }
  if (below > 0) cells.push(SPACER.below);
  return { cells, above, middle, below };
}
