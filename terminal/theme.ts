// The Sky page's theme from the terminal's own colours: the page's tokens (solid/app/Sky.styles.ts) as roles of
// `@cssints/tui/system`'s solver — the `createSystemTheme` apps/csssky-tui runs, so the same contrast rules, the same
// hue source, the same light/dark call from the background's luminance — and the compiled styles repainted by it.
//
// Why a value table: a compiled cssints/clay style keeps the colours a token resolved to (`{r,g,b,a}`), not the token
// name, so the solver's answer (one hex a token) meets a style by the value it was. The nine tokens' dark and light
// literals are Sky.styles.ts's, and a style colour that is not one of them (a page's own literal, a gradient stop) keeps
// its value: ponytail: keyed by exact RGB, so a palette change must be mirrored here (the suite's system-theme block
// catches the page's page-colour and accent, not every token).
import type { ClayShape } from "cssints/clay";

import {
  createSystemTheme,
  type Report,
  type Role,
  type Roles,
  type Solved,
  type SystemTheme,
} from "../../packages/tui/src/system.ts";
import { packBox, packText, resolve, type State, type Variant } from "../solid/src/pack.ts";

/** The page's token table as it is at run time: a token is its `var(--name)` string. */
export type Tokens = { readonly color: Readonly<Record<string, string>> };

/** Each token's literal under the page's default theme, then under `light` (`Sky.styles.ts`). */
const LITERALS = {
  page: [
    [16, 19, 22],
    [243, 245, 247],
  ],
  panel: [
    [27, 32, 38],
    [255, 255, 255],
  ],
  panelDeep: [
    [21, 25, 30],
    [240, 243, 246],
  ],
  hover: [
    [34, 40, 49],
    [232, 238, 244],
  ],
  hoverDeep: [
    [28, 33, 40],
    [222, 229, 236],
  ],
  ink: [
    [230, 233, 236],
    [15, 20, 25],
  ],
  muted: [
    [139, 152, 165],
    [86, 99, 111],
  ],
  accent: [
    [59, 156, 240],
    [17, 112, 207],
  ],
  ring: [
    [92, 176, 255],
    [11, 98, 189],
  ],
} as const;

type Key = keyof typeof LITERALS;

/** The page's palette as roles: a surface a tonal step above the page, the page's ink at 7:1 on every surface it is drawn
 *  on, the accent family from the terminal's blue (apps/csssky-tui/src/system.ts's table, for these tokens). */
const rolesOf = (t: Tokens): Roles<Tokens> => {
  const on = (k: Key) => t.color[k]!;
  const roles: Record<Key, Role> = {
    page: { surface: true },
    panel: { surface: true, on: [on("page")], contrast: 1.1 },
    panelDeep: { surface: true, on: [on("page")], contrast: 1.05 },
    hover: { surface: true, on: [on("page")], contrast: 1.3, ansi: 8 },
    hoverDeep: { surface: true, on: [on("page")], contrast: 1.2, ansi: 8 },
    ink: {
      hue: "fg",
      on: [on("page"), on("panel"), on("panelDeep"), on("hover"), on("hoverDeep")],
      contrast: 7,
    },
    muted: { hue: "brightBlack", on: [on("page"), on("panel"), on("hover")], contrast: 4.5 },
    accent: { hue: "blue", on: [on("page"), on("panel")], contrast: 3 },
    ring: { hue: "brightBlue", on: [on("page"), on("panel")], contrast: 3 },
  };
  return { color: roles } as Roles<Tokens>;
};

/** The app's own hues, for a terminal that reports its background but not its palette: the page's own dark values. */
const HUES = {
  fg: "#e6e9ec",
  brightBlack: "#8b98a5",
  blue: "#3b9cf0",
  brightBlue: "#5cb0ff",
};

const themes = new WeakMap<object, SystemTheme>();
/** The solver for a token table, built once (`createSystemTheme` checks the roles: an `on` without a role, a cycle). */
export const solverOf = (t: Tokens): SystemTheme => {
  let s = themes.get(t as object);
  if (!s) themes.set(t as object, (s = createSystemTheme(t, rolesOf(t), { hues: HUES })));
  return s;
};

const packed = (rgb: readonly number[]) => (rgb[0]! << 16) | (rgb[1]! << 8) | rgb[2]!;
const hexOf = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as number[];

/** What a terminal's answer gave the page: the call the solver made, and how a compiled colour is rewritten. */
export interface Paint {
  readonly appearance: "dark" | "light";
  /** a colour packed as `r << 16 | g << 8 | b` -> the solved one, for both the dark and the light literal of a token. */
  readonly map: ReadonlyMap<number, number>;
}

/**
 * The page's theme for a terminal's report, or undefined when the terminal reported no background (the caller keeps its
 * static theme: `--theme light`, or the page's default dark).
 */
export const solve = (t: Tokens, report: Report): Paint | undefined => {
  const solved: Solved = solverOf(t).solve(report);
  const page = solved.values["color-page"];
  if (!page) return undefined;
  const map = new Map<number, number>();
  for (const [key, [dark, light]] of Object.entries(LITERALS)) {
    const name = /^var\(--(.+)\)$/.exec(t.color[key] ?? "")?.[1];
    const hex = name ? solved.values[name] : undefined;
    if (!hex) continue;
    const to = packed(hexOf(hex));
    map.set(packed(dark), to);
    map.set(packed(light), to);
  }
  return { appearance: solved.appearance, map };
};

// A repaint is cached per style and set of states, as pack.ts's variant is, and dropped when the terminal answers again
// (a page's styles are the same objects all run; a new answer gives them new colours)
let painted = new WeakMap<object, Map<string, Variant>>();
/** Forgets the repainted variants: the next frame paints with the new answer. */
export const forget = () => (painted = new WeakMap());

// a colour of a resolved shape, rewritten by the map: the shape is copied along the way, so the page's compiled literal
// (which resolve shares for the fields it does not touch) is never written to
const swap = (v: unknown, map: ReadonlyMap<number, number>): unknown => {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => swap(x, map));
  const c = v as { r?: number; g?: number; b?: number };
  if (typeof c.r === "number" && typeof c.g === "number" && typeof c.b === "number") {
    const to = map.get((c.r << 16) | (c.g << 8) | c.b);
    if (to === undefined) return v;
    return { ...v, r: (to >> 16) & 255, g: (to >> 8) & 255, b: to & 255 };
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = swap(x, map);
  return out;
};

/** A style under the terminal's palette, in these states: pack.ts's `variant` with the colours solved first. The parts a
 *  cell cannot show (a gradient, a shadow, a backdrop) are not returned, as the host drops them anyway. */
export const repaint = (shape: ClayShape, states: State[], paint: Paint): Variant => {
  let byKey = painted.get(shape);
  if (!byKey) painted.set(shape, (byKey = new Map()));
  const key = states.join("");
  let v = byKey.get(key);
  if (!v) {
    const merged = swap(resolve(shape, undefined, states), paint.map) as {
      text?: unknown;
      image?: { imageData?: string };
      [k: string]: unknown;
    };
    const { text, image, ...decl } = merged;
    byKey.set(
      key,
      (v = {
        box: Object.keys(decl).length ? packBox(decl) : undefined,
        text: text && packText(text as never),
        image: image?.imageData,
      }),
    );
  }
  return v;
};
