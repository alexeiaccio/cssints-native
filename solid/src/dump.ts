// The frame as data. `ui_dump_json` (solid/native/ui.c) writes the last frame's command array — every field a draw
// reads — plus the renderer's side tables beside it (a shadow, a backdrop, a gradient, a group, the text weight), which
// `ui_hash` folds into the frame's hash but no command carries. `dumpPage` adds the accessibility snapshot of the same
// tree (a11y.ts). solid/goldens/ is these, one file a page, and solid/dump.test.ts compares them field by field: a
// pixel diff says 300 pixels moved, this says which command and which field.
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { snapshot, type A11yNode } from "../a11y.ts";
import { ui } from "./ffi.ts";
import type { El } from "./renderer.ts";

/** A colour as Clay carries it: red, green, blue, alpha, 0-255, not rounded (the renderer takes floats). */
export type Rgba = [number, number, number, number];
/** A box as Clay lays it out: x, y, width, height, not rounded. */
export type Box = [number, number, number, number];

/** One render command, with the fields of its `type` only. */
export interface Command {
  /** "rectangle", "border", "text", "image", "scissor-start"/"-end", "overlay-color-start"/"-end", "custom". */
  type: string;
  /** Clay's element id: a 32-bit hash of the page's id string. */
  id: number;
  /** The page's `id` of the element the command came from; null for an element without one. */
  element: string | null;
  box: Box;
  /** Clay's z-order (the array is already sorted; a batching renderer reads this). */
  z: number;
  text?: string;
  color?: Rgba;
  radii?: Box;
  /** left, right, top, bottom, betweenChildren. */
  widths?: [number, number, number, number, number];
  font?: number;
  size?: number;
  letterSpacing?: number;
  lineHeight?: number;
  align?: string;
  wrap?: string;
  /** An image's path, as `ui_image` interned it (a `css.image` style's source). */
  path?: string;
  /** A scissor's axes, the ones it cuts: "horizontal" and/or "vertical". */
  axes?: string[];
  /** A custom command's `customData`, as an address: the one field a golden cannot hold (ASLR moves it). */
  pointer?: number;
}

/** A shadow (`css.shadow`), by the element's id: the renderer's table, not a command. */
export interface Shadow {
  id: number;
  element: string | null;
  x: number;
  y: number;
  blur: number;
  color: Rgba;
}
/** A backdrop (`css.backdrop`): the pixels under that element are blurred. */
export interface Backdrop {
  id: number;
  element: string | null;
  blur: number;
}
export interface Stop {
  offset: number;
  color: Rgba;
}
/** A gradient (`css.backgroundImage`): kind 1 is linear, the only one cssints/clay writes. */
export interface Gradient {
  id: number;
  element: string | null;
  kind: number;
  angle: number;
  alpha: number;
  stops: Stop[];
}
/** One element's subtree as a scene: opacity, scale, visual offset and rotation (the value channel's 46..49 and 55). */
export interface Group {
  /** The element's node in the frame's tree (declaration order). */
  node: number;
  element: string | null;
  alpha: number;
  scale: number;
  tx: number;
  ty: number;
  rotate: number;
}

/** The renderer's tables beside the commands: what the frame's hash folds in. A neutral group (255, 1, 0, 0, 0) makes no
 *  scene and is left out, as the hash leaves it out. */
export interface Effects {
  textWeight: number;
  shadows: Shadow[];
  backdrops: Backdrop[];
  gradients: Gradient[];
  groups: Group[];
}

/** One frame, as `ui_dump_json` writes it. */
export interface FrameDump {
  /** The layout's width and height, in Clay units. */
  size: [number, number];
  /** The raster's pixel density (headless 1). */
  scale: number;
  commands: Command[];
  effects: Effects;
}

/** A page's golden: its last frame and the accessibility snapshot of the same tree. */
export interface PageDump extends FrameDump {
  a11y: A11yNode;
}

const file = join(tmpdir(), "cssints-native-dump.json");
/** The worktree's root: an image's path inside it is stored relative to it, so a golden is the same in every checkout. */
const ROOT = new URL("../../../", import.meta.url).pathname;

/** A path as a golden stores it: inside the worktree, relative to it (a checkout's path is not part of a frame); outside,
 *  as it is (a user's own image). */
const portable = (path: string) => (path.startsWith(ROOT) ? path.slice(ROOT.length) : path);

/** The last frame as data: `ui_dump_json` writes it (no struct crosses the FFI boundary), it is read back, and the
 *  accessibility tree of the same Solid tree goes beside it. Call it after the frame, before the next `ui_begin`.
 *  `ui_dump_json` also writes the frame's hash; it is left out here, because a frame with an image hashes the image's
 *  pointer (an address, so a process's own) and a golden stored with it could not be compared by another process. */
export function dumpPage(root: El): PageDump {
  if (ui.dumpJson(file) !== 0) throw new Error(`ui_dump_json failed to write ${file}`);
  const frame = JSON.parse(readFileSync(file, "utf8")) as FrameDump & { hash?: string };
  delete frame.hash;
  for (const command of frame.commands) if (command.path) command.path = portable(command.path);
  return { ...frame, a11y: snapshot(root) };
}

// the goldens' formatter: object keys sorted, a command a line, numbers as JSON wrote them
export { format } from "./format.ts";
