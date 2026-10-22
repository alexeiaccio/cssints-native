// A cssints/clay style (a ClayShape literal) as what ui.c takes: a theme and a state picked, then the fields packed
// into a Float32Array in a fixed order. The picking is what header() does for C (`<name>_<theme>`, `<name>_active`),
// done at run time; a variant is packed once and kept.
import type { ClayShape } from "cssints/clay";

type Shape = Record<string, any>;

/** The fields of a box, by index (ui.c's ui_open reads the same order). */
export const STYLE_FIELDS = 45;
/** The fields of a text, by index (ui.c's ui_text). */
export const TEXT_FIELDS = 10;

const SIZING = { FIT: 0, GROW: 1, PERCENT: 2, FIXED: 3 } as const;
const ALIGN_X = { LEFT: 0, CENTER: 1, RIGHT: 2 } as const;
const ALIGN_Y = { TOP: 0, CENTER: 1, BOTTOM: 2 } as const;
const DIRECTION = { LEFT_TO_RIGHT: 0, TOP_TO_BOTTOM: 1 } as const;
const WRAP = { WORDS: 0, NEWLINES: 1, NONE: 2 } as const;
// Clay's floating enums, in its own order (clay.h): the packed form prints these names
const ATTACH_TO = { NONE: 0, PARENT: 1, ELEMENT_WITH_ID: 2, ROOT: 3 } as const;
const ATTACH_POINT = {
  LEFT_TOP: 0,
  LEFT_CENTER: 1,
  LEFT_BOTTOM: 2,
  CENTER_TOP: 3,
  CENTER_CENTER: 4,
  CENTER_BOTTOM: 5,
  RIGHT_TOP: 6,
  RIGHT_CENTER: 7,
  RIGHT_BOTTOM: 8,
} as const;
const CAPTURE = { CAPTURE: 0, PASSTHROUGH: 1 } as const;
const CLIP = { NONE: 0, ATTACHED_PARENT: 1 } as const;

// the same merge as header(): a colour or a sizing axis is replaced whole, anything else field by field
const isLeaf = (v: unknown) => typeof v !== "object" || Object.hasOwn(v as object, "r") || Object.hasOwn(v as object, "type");
const merge = (a: Shape, b: Shape): Shape => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isLeaf(v) || out[k] === undefined ? v : merge(out[k], v);
  return out;
};

export type State = ":hover" | ":focus" | ":active";
// the order the states are laid over the base, so the last wins where two set one field: active > focus > hover
const STATES: State[] = [":hover", ":focus", ":active"];

/**
 * What header() prints as `<name>[_<state>][_<theme>]`: the base, the theme over it, the states over that. header()
 * prints one state a declaration; at run time an element can be hovered, focused and pressed at once, so the states
 * that hold are laid over each other in STATES' order.
 */
export function resolve(shape: ClayShape, theme?: string, states: State[] = []): Shape {
  const all: Shape = theme ? merge(shape, (shape.themes as Shape | undefined)?.[theme] ?? {}) : shape;
  const { themes: _, ...v } = all;
  let out: Shape = Object.fromEntries(Object.entries(v).filter(([k]) => !STATES.includes(k as State)));
  for (const s of STATES) if (states.includes(s) && v[s]) out = merge(out, v[s]);
  return out;
}

const put = (f: Float32Array, at: number, ...values: (number | undefined)[]) => values.forEach((x, i) => (f[at + i] = x ?? 0));
const rgba = (c?: Shape) => [c?.r, c?.g, c?.b, c?.a];
const sides = (s?: Shape) => [s?.left, s?.right, s?.top, s?.bottom];
const axis = (a?: Shape) => [SIZING[a?.type as keyof typeof SIZING] ?? 0, a?.percent ?? a?.min, a?.max];

export function packBox(d: Shape): Float32Array {
  const f = new Float32Array(STYLE_FIELDS);
  const l = d.layout ?? {};
  put(f, 0, ...axis(l.sizing?.width), ...axis(l.sizing?.height), ...sides(l.padding), l.childGap);
  put(f, 11, ALIGN_X[l.childAlignment?.x as keyof typeof ALIGN_X], ALIGN_Y[l.childAlignment?.y as keyof typeof ALIGN_Y]);
  put(f, 13, DIRECTION[l.layoutDirection as keyof typeof DIRECTION]);
  put(f, 14, ...rgba(d.backgroundColor));
  put(f, 18, d.cornerRadius?.topLeft, d.cornerRadius?.topRight, d.cornerRadius?.bottomRight, d.cornerRadius?.bottomLeft);
  put(f, 22, ...sides(d.border?.width), ...rgba(d.border?.color));
  put(f, 30, d.clip?.horizontal, d.clip?.vertical);
  const fl = d.floating;
  if (fl) {
    const parentId = Number(fl.parentId ?? 0) >>> 0;
    put(
      f,
      32,
      1,
      ATTACH_TO[fl.attachTo as keyof typeof ATTACH_TO] ?? ATTACH_TO.PARENT,
      // Clay's parentId is a 32-bit hash and a float32 holds 24 bits exactly: two halves
      Math.floor(parentId / 65536),
      parentId % 65536,
      ATTACH_POINT[fl.attachPoints?.element as keyof typeof ATTACH_POINT] ?? 0,
      ATTACH_POINT[fl.attachPoints?.parent as keyof typeof ATTACH_POINT] ?? 0,
      fl.offset?.x,
      fl.offset?.y,
      fl.expand?.width,
      fl.expand?.height,
      fl.zIndex,
      CAPTURE[fl.pointerCaptureMode as keyof typeof CAPTURE] ?? 0,
      CLIP[fl.clipTo as keyof typeof CLIP] ?? 0,
    );
  }
  return f;
}

export function packText(t: Shape): Float32Array {
  const f = new Float32Array(TEXT_FIELDS);
  put(f, 0, ...rgba(t.textColor), t.fontId, t.fontSize, t.letterSpacing, t.lineHeight);
  put(f, 8, { LEFT: 0, CENTER: 1, RIGHT: 2 }[t.textAlignment as string], WRAP[t.wrapMode as keyof typeof WRAP]);
  return f;
}

export interface Variant {
  box?: Float32Array;
  text?: Float32Array;
  /** The style's image path (`css.image`): Clay's image config is one pointer, so it travels beside the floats. */
  image?: string;
}

const cache = new WeakMap<object, Map<string, Variant>>();

/** The packed form of a style under a theme and the states that hold, kept per style object. */
export function variant(shape: ClayShape, theme?: string, states: State[] = []): Variant {
  let byKey = cache.get(shape);
  if (!byKey) cache.set(shape, (byKey = new Map()));
  const key = `${theme}|${states.join("")}`;
  let v = byKey.get(key);
  if (!v) {
    const { text, image, ...decl } = resolve(shape, theme, states);
    byKey.set(key, (v = { box: Object.keys(decl).length ? packBox(decl) : undefined, text: text && packText(text), image: image?.imageData }));
  }
  return v;
}

/** Does the style have a look for a state (so the element must ask where the pointer is)? */
export const hasStates = (shape: ClayShape) => STATES.some((s) => s in shape);
