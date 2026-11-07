// A Solid page at build time, as C: the same component the desktop renders, rendered by the desktop's own renderer
// (solid/src/renderer.ts) into an El tree, then walked and printed as Clay's immediate-mode calls. For a target with no
// JS (the ESP32): the page's signals are fixed here, so the emitted frame function is one static frame.
//
// Styles are not printed again. A style object that is an export of the page's styles module is referenced by the name
// generator/clay-header.ts gave it in styles.h (`root`, `units`, `title_text`, `units_active`, ...), found by identity.
// A style the page does not export (declared inside the .tsx) is printed by the *same* printer, `header()` of
// cssints/clay, and named `style_<index>` in tree order: one printer, two sets of names.
//
// Run:
//   bun --conditions=development generator/page-to-c.ts solid/app/Sensors.tsx \
//     --styles examples/sensors/styles.ts --states examples/sensors/states.json \
//     --state use_g=true --name app_frame_g --out examples/sensors/page_generated_g.c
//
// --text <name> hands the strings to the target instead of baking them in: each text element's content becomes
// `<name>(<index>)`, with its index in tree order (the file lists them), for a target whose values are not the
// build's -- the board's live sample. Without the flag the strings are the page's own, as double-quoted bytes.
//
// --prop name=value renders the page with that prop (`--prop image=true`): the page's props are fixed at build time,
// as its signals are, and a variant a page reaches through a prop (not a signal) is a file of its own.
//
// --tick <n> gives the page its frame hook (`motion`) and runs it n frames at 1/60 before the frame is emitted, for a
// page whose tree depends on it: the List's window is its tick's. The hook's reads of the host are answered by
// generator/ui-build.ts — the box a style states (`ui.bounds`), the offset the host will scroll it to (`--scroll`) — and
// its value-channel writes are baked into the emitted declarations, since a static page has no channel.
//
// --scroll <id>=<px> is the offset the host puts in the page's scroll container, positive down or right (the page's
// `ui.scrollOffset` reads Clay's, which is negative). The offset is not a declaration: the emitted clip element reads
// it from Clay (`Clay_GetScrollOffset()`, as the Solid host does), and the window the page declares depends on it, hence
// a file per offset.
//
// --events <file.c> emits the page as a *state machine* instead of one frame: every state `--states` names, plus the
// states its handlers lead to (a press and a release over each element with an onClick/onPress, with the page's own
// :hover/:active), one frame function a state, the count and names, and the transition table
// `int <name>_next(int state, uint32_t id, int event)` (event kinds in generator/events.h). A state transition the
// generator cannot express as a frame of a state states.json names fails here, at build time, not in the host.
//
// A state's actions replay the page's input as well as its signals: `{"press": "name"}` focuses a part (its row's
// onPress, the focus manager), `{"key": "Shift+ArrowLeft"}` presses and releases a key, and `{"text": "Ada"}` types
// into the focused part — the page's state can be the text a field holds, which is its input's, not a signal the file
// could name. A text with no focused field fails the build.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { plugin } from "bun";
import { header } from "cssints/clay";

import type { Input } from "../solid/src/input.ts";

const STATES = [":hover", ":focus", ":active"] as const;
type State = (typeof STATES)[number];

const fail = (what: string): never => {
  console.error(`page-to-c: ${what}`);
  process.exit(1);
};

/** A `--prop` value as the JS value it names: `true`/`false`, a number, else the string. */
const literalOf = (raw: string): unknown => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
};

// ---------- arguments

interface Options {
  page: string;
  out?: string;
  /** The state machine's file (`--events`): frames, names and the transition table. */
  events?: string;
  /** Its C prefix: `<prefix>_state_count`, `<prefix>_next`, `<prefix>_frame`, ... (`--events-name`, default `page`). */
  eventsName: string;
  name: string;
  styles: string[];
  states?: string;
  state: string[];
  /** The function the target supplies the strings with, by index: `--text`. */
  text?: string;
  /** The page's props, fixed at build time: `--prop image=true`. */
  props: Record<string, unknown>;
  /** Frames of the page's own tick before the frame is emitted (`--tick`): the hook is given to the page. */
  tick: number;
  /** The offset the host will put in a scroll container, by id (`--scroll list=10`). */
  scroll: Record<string, number>;
}
const opts: Partial<Options> & {
  styles: string[];
  state: string[];
  props: Record<string, unknown>;
  tick: number;
  scroll: Record<string, number>;
} = {
  name: "app_frame",
  eventsName: "page",
  styles: [],
  state: [],
  props: {},
  tick: 0,
  scroll: {},
};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => argv[++i] ?? fail(`missing value for ${a}`);
    if (a === "--out") opts.out = value();
    else if (a === "--events") opts.events = value();
    else if (a === "--events-name") opts.eventsName = value();
    else if (a === "--name") opts.name = value();
    else if (a === "--styles") opts.styles.push(value());
    else if (a === "--states") opts.states = value();
    else if (a === "--state") opts.state.push(value());
    else if (a === "--text") opts.text = value();
    else if (a === "--tick") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 0) fail(`${a} takes a whole number of frames`);
      opts.tick = n;
    } else if (a === "--scroll") {
      const [name, px, ...rest] = value().split("=");
      if (!name || px === undefined || rest.length || Number.isNaN(Number(px))) fail(`${a} takes id=px`);
      opts.scroll[name] = Number(px);
    } else if (a === "--prop") {
      const [name, ...rest] = value().split("=");
      if (!name || !rest.length) fail(`${a} takes name=value`);
      opts.props[name] = literalOf(rest.join("="));
    }
    else if (a.startsWith("--")) fail(`unknown option ${a}`);
    else if (!opts.page) opts.page = a;
    else fail(`unexpected argument ${a}`);
  }
  if (!opts.page)
    fail(
      "usage: bun generator/page-to-c.ts <page.tsx> (--out <page.c> | --events <table.c>) [--styles <styles.ts>]...",
    );
  if (!opts.out && !opts.events) fail("--out or --events is required");
  if ((opts.state.length || opts.events) && !opts.states)
    fail("--state and --events need a --states file: a state is a script of events, not a signal");
  if (opts.events && opts.text) fail("--events and --text are not combined: the table's frames are the page's strings");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(opts.eventsName)) fail(`--events-name ${opts.eventsName} is not a C identifier`);
  if (opts.text && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(opts.text)) fail(`--text ${opts.text} is not a C identifier`);
}

// ---------- the page, rendered

// JSX and cssints compile in Bun only through the app's loader, and it must be registered before the page is imported
await import("../solid/plugin.ts");
// A page's `ui` (solid/src/ffi.ts: libui.dylib through bun:ffi) is resolved to the build's own stand-in before any page
// is imported: a page's tick asks the host for a box and a scroll offset, and there is no host here (and no dylib, which
// needs SDL3 and ThorVG). The stub records what it is told and what the page writes; nothing is drawn.
const build = await import("./ui-build.ts");
plugin({
  name: "cssints-native-build-ui",
  setup(b) {
    const stub = new URL("./ui-build.ts", import.meta.url).pathname;
    b.onResolve({ filter: /(^|\/)ffi\.ts$/ }, () => ({ path: stub }));
  },
});
const { El, Txt, render } = await import("../solid/src/renderer.ts");
const { packBox, resolve: resolveStyle, STYLE_FIELDS } = await import("../solid/src/pack.ts");
const { createInput } = await import("../solid/src/input.ts");
const { flush } = await import("solid-js");

const mod = await import(resolve(opts.page!));
const Page = Object.values(mod).find((v) => typeof v === "function") as
  | ((props: Record<string, unknown>) => unknown)
  | undefined;
if (!Page) fail(`${opts.page} exports no component`);

const find = (n: El, id: string): El | undefined => {
  if (n.props.id === id) return n;
  for (const c of n.children) if (c instanceof El) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
};

// ---------- the state: events the page handles, replayed, as the build drives it to one frame

interface Action {
  /** A click on the element with that id: its own onClick, called where the frame calls it on release. */
  click?: string;
  /** A press (the button going down over the element): its onPress, called with (0, 0). */
  press?: string;
  /** The pointer over the element at build time, with the button down or up: a build-time :hover / :active. */
  pointer?: string;
  down?: boolean;
  /** A named key, pressed and released (`input.down` then `up`): the page's own keys, `main.ts --keys`' names
   *  ("Tab", "Shift+ArrowLeft"). A page's state can be reached by a key, not only by a signal the file names. */
  key?: string;
  /** Typed characters, as SDL's text events deliver them to the focused part (`input.textInput`, `main.ts`'s
   *  `text:`): the text a field's value holds is the page's state, and a press on its row is how it gets the focus. */
  text?: string;
}
/** The pointer as the frame being emitted sees it: `:hover` when it is over the element, `:active` when it is also down. */
const pointer: { id?: string; down: boolean } = { down: false };

/** The states the state machine may start from and reach: the file's, keyed by the signal they name. */
const script: Record<string, Action[]> = opts.states
  ? (JSON.parse(readFileSync(resolve(opts.states), "utf8")) as Record<string, Action[]>)
  : {};

function apply(a: Action, root: El, label: string, input: Input): void {
  if (a.click) {
    const el = find(root, a.click);
    if (!el?.props.onClick) fail(`${label}: no element with id "${a.click}" and an onClick`);
    el.props.onClick(0, 0);
  } else if (a.press) {
    const el = find(root, a.press);
    if (!el?.props.onPress) fail(`${label}: no element with id "${a.press}" and an onPress`);
    el.props.onPress(0, 0);
  } else if (a.key !== undefined) {
    // a key is down then up, as `main.ts --keys` gives it (a Space arms on the down and fires on the up)
    input.down(a.key);
    input.up(a.key);
  } else if (a.text !== undefined) {
    // the text goes to the focused part, which is what the host's SDL_TEXT_INPUT does while a field edits
    if (!input.textInput(a.text)) fail(`${label}: no text field has focus for ${JSON.stringify(a.text)}`);
  } else if (a.pointer) {
    pointer.id = a.pointer;
    pointer.down = !!a.down;
  } else fail(`${label}: unknown action ${JSON.stringify(a)}`);
  flush();
}

/** A fresh page, with its signals at their defaults, its props as `--prop` fixed them, and the pointer off it. */
function openPage(): { root: El; input: Input; dispose: () => void } {
  const root = new El("root");
  // the page's own input: a page of the headless widgets (the Dialog, the Field) builds its tree from it — the ids, the
  // roles and the handlers of its parts — so a build-time frame needs one, empty of keys and pointer, as its signals
  // are fixed. A page that takes no input ignores the prop, as it ignores every other it is not handed.
  // ... and with `--tick` its frame hook: the page wires its track to `motion`, and the loop's `tick` is what the
  // generator then runs (the entry's, the scroll's, whatever the page put there).
  const motion: { tick?: (dt: number) => void } = {};
  const input = createInput();
  const dispose = render(
    () => Page!({ input, ...(opts.tick ? { motion } : {}), ...opts.props }),
    root,
  );
  flush();
  // what the page's tick will ask the host for: the box an element's own style states (a fixed length). A laid-out box
  // is the layout's, and the build has none; an element whose size is grown or a percentage is the frame's, and the
  // page that asks for one has to say so (`--scroll` is the same kind of input, for the offset).
  build.reset();
  for (const el of walk(root)) {
    if (!el.props.id || !el.props.style) continue;
    const layout = (resolveStyle(el.props.style, undefined, []) as { layout?: Record<string, any> }).layout;
    const w = fixed(layout?.sizing?.width);
    const h = fixed(layout?.sizing?.height);
    build.box(el.props.id, w, h);
  }
  for (const [id, px] of Object.entries(opts.scroll)) build.scroll(id, px);
  for (let i = 0; i < opts.tick; i++) {
    motion.tick?.(1 / 60);
    flush();
  }
  pointer.id = undefined;
  pointer.down = false;
  return { root, input, dispose };
}

/** A style's length in px when the style states it exactly, else 0 (a grown or a percentage length is the layout's). */
const fixed = (axis: Record<string, any> | undefined): number =>
  axis?.type === "FIXED" ? Number(axis.min ?? 0) : 0;

/** A page after replaying a state's actions: the tree that state declares, and the pointer as its actions left it. */
function renderState(actions: readonly Action[], label: string): { root: El; input: Input; dispose: () => void } {
  const page = openPage();
  for (const a of actions) apply(a, page.root, label, page.input);
  return page;
}

// ---------- names: a style object is an export of a styles module, or a literal of this file

const exported = new Map<object, string>();
for (const file of opts.styles) {
  const styles = await import(resolve(file));
  for (const [name, v] of Object.entries(styles))
    if (v && typeof v === "object" && !Array.isArray(v)) exported.set(v, name);
}

function* walk(n: El): Generator<El> {
  yield n;
  for (const c of n.children) if (c instanceof El) yield* walk(c);
}

/** The themes the page's styles declare: a repaint of the same tree, one function each. */
function themesOf(roots: readonly El[]): (string | undefined)[] {
  const themes = new Set<string>();
  for (const root of roots)
    for (const el of walk(root))
      for (const theme of Object.keys((el.props.style?.themes as object | undefined) ?? {})) themes.add(theme);
  return [undefined, ...[...themes].sort()];
}

// the two printers: header() prints a shape (with its states and themes) as C; it is called once per style the page
// does not export, with the themes the frame needs, so every declaration the file refers to exists
const literals: string[] = [];
const local = new Map<object, string>();
const printed = new Set<string>();
let themes: (string | undefined)[] = [];
const printLiteral = (name: string, style: Record<string, any>, themed = true) => {
  if (printed.has(name)) return;
  printed.add(name);
  const shape = { ...style, themes: { ...(style.themes ?? {}) } };
  for (const theme of themes) if (themed && theme) shape.themes[theme] ??= {};
  for (const line of header({ [name]: shape }).split("\n"))
    if (line.startsWith("static const ")) literals.push(line);
};

/** The C expression naming a style's declaration: its export's name in styles.h, or a printed literal. An element with
 *  no declaration is `{}`, not `{ 0 }`: GCC makes `{ 0 }` of a struct a missing-braces error under -Werror, and the
 *  firmware builds with it. */
function decl(style: Record<string, any> | undefined, el: El, theme: string | undefined, text: boolean): string {
  if (!style) return text ? defaultText() : "{}";
  const states = heldStates(style, el);
  const suffix = states.length ? `_${states.at(-1)!.slice(1)}` : "";
  const themeSuffix = theme ? `_${theme}` : "";
  // what the states hold at build time is one declaration of header()'s; it is the last state's only when the earlier
  // ones add nothing the last one does not (pack.ts lays them over each other, header() prints one per state)
  if (states.length > 1) {
    const merged = canon(resolveStyle(style, theme, states));
    const one = canon(resolveStyle(style, theme, [states.at(-1)!]));
    if (JSON.stringify(merged) !== JSON.stringify(one))
      fail(
        `cannot express ${states.join(" + ")} of a style as one declaration: ` +
          `header() prints one state per declaration and these set different fields`,
      );
  }
  const resolved = resolveStyle(style, theme, states) as Record<string, any>;
  const box = Object.keys(resolved).filter((k) => k !== "text").length > 0;
  if (text && !resolved.text) return defaultText();
  if (!text && !box) return "{}";

  // the value channel at build time: the numbers the page wrote for this element (`--tick`) are baked into a declaration
  // of their own, since a static page has no channel to write them through. A text's colour is its own (`ui_text`'s
  // fields 51-54), so a text is never baked here.
  if (!text && el.props.id) {
    const wrote = build.values(el.props.id);
    // a write past the packed floats is a renderer table or a text's colour, which a declaration has no field for: only
    // a write a declaration can hold makes it a declaration of its own
    if (wrote && [...wrote.keys()].some((field) => field < STYLE_FIELDS)) return bakedName(resolved, wrote);
  }

  const name = exported.get(style);
  if (name) {
    usedExports = true;
    return `${name}${suffix}${text ? "_text" : ""}${themeSuffix}`;
  }
  let localName = local.get(style);
  if (!localName) {
    localName = `style_${local.size}`;
    local.set(style, localName);
    printLiteral(localName, style);
  }
  return `${localName}${suffix}${text ? "_text" : ""}${themeSuffix}`;
}

/** renderer.ts's text with no style: white, 14px, as header() prints such a shape. */
function defaultText(): string {
  printLiteral("white_14", { text: { textColor: { r: 255, g: 255, b: 255, a: 255 }, fontSize: 14 } });
  return "white_14_text";
}

// ---------- the value channel, baked

// The packed fields a page writes (`solid/src/pack.ts`, `ui.c`'s ui_open reads them in this order). A field past 44 is a
// renderer table (a shadow's blur, a group's alpha, scale, translate or rotate, a gradient's alpha) or a text's colour: a
// static C page keeps none of those (header() drops the effects too), so they are dropped.
const SIZING_TYPES = ["FIT", "GROW", "PERCENT", "FIXED"] as const;
const ATTACH_TO = ["NONE", "PARENT", "ELEMENT_WITH_ID", "ROOT"] as const;
const ATTACH_POINT = [
  "LEFT_TOP",
  "LEFT_CENTER",
  "LEFT_BOTTOM",
  "CENTER_TOP",
  "CENTER_CENTER",
  "CENTER_BOTTOM",
  "RIGHT_TOP",
  "RIGHT_CENTER",
  "RIGHT_BOTTOM",
] as const;
const CAPTURE = ["CAPTURE", "PASSTHROUGH"] as const;
const CLIP_TO = ["NONE", "ATTACHED_PARENT"] as const;
const ALIGN_X = ["LEFT", "CENTER", "RIGHT"] as const;
const ALIGN_Y = ["TOP", "CENTER", "BOTTOM"] as const;

/** A style's packed floats as the declaration `ui.c`'s ui_open builds from them: the same fields, in the same order. */
function fromPacked(f: Float32Array): Record<string, any> {
  const sizing = (at: number) => {
    const type = SIZING_TYPES[f[at]!] ?? fail(`a sizing type of ${f[at]}`);
    return type === "PERCENT"
      ? { type, percent: f[at + 1] }
      : { type, min: f[at + 1], max: f[at + 2] };
  };
  const colour = (at: number) => ({ r: f[at], g: f[at + 1], b: f[at + 2], a: f[at + 3] });
  const out: Record<string, any> = {
    layout: {
      sizing: { width: sizing(0), height: sizing(3) },
      padding: { left: f[6], right: f[7], top: f[8], bottom: f[9] },
      childGap: f[10],
      childAlignment: { x: ALIGN_X[f[11]!] ?? fail(`an align of ${f[11]}`), y: ALIGN_Y[f[12]!] },
      layoutDirection: f[13] ? "TOP_TO_BOTTOM" : "LEFT_TO_RIGHT",
    },
    backgroundColor: colour(14),
    cornerRadius: { topLeft: f[18], topRight: f[19], bottomRight: f[20], bottomLeft: f[21] },
    border: { width: { left: f[22], right: f[23], top: f[24], bottom: f[25] }, color: colour(26) },
    clip: { horizontal: f[30] ? 1 : 0, vertical: f[31] ? 1 : 0 },
  };
  if (f[32])
    out.floating = {
      attachTo: ATTACH_TO[f[33]!] ?? fail(`an attachTo of ${f[33]}`),
      parentId: ((((f[34]! | 0) << 16) >>> 0) | ((f[35]! | 0) & 0xffff)) >>> 0,
      attachPoints: {
        element: ATTACH_POINT[f[36]!] ?? fail(`an attach point of ${f[36]}`),
        parent: ATTACH_POINT[f[37]!] ?? fail(`an attach point of ${f[37]}`),
      },
      offset: { x: f[38], y: f[39] },
      expand: { width: f[40], height: f[41] },
      zIndex: f[42],
      pointerCaptureMode: CAPTURE[f[43]!] ?? fail(`a capture of ${f[43]}`),
      clipTo: CLIP_TO[f[44]!] ?? fail(`a clip of ${f[44]}`),
    };
  return out;
}

/**
 * The declaration a resolved shape becomes with a page's value-channel writes applied. `ui.c` copies the style's 45
 * floats, overwrites the fields the page wrote and declares from the copy, so this is that copy: `packBox` of the
 * shape, then the writes, then the declaration (`fromPacked`). What the packed floats do not hold — an image, an
 * aspect ratio — stays the style's.
 */
function baked(shape: Record<string, any>, f: ReadonlyMap<number, number>): Record<string, any> {
  const floats = packBox(shape);
  for (const [field, v] of f) if (field < STYLE_FIELDS) floats[field] = v;
  // the packed floats hold every box field, so they are the declaration's; what they do not hold (an image, an aspect
  // ratio) is the style's, and a float the style has is the packed `f[32]` flag's
  const { layout: _, floating: __, ...rest } = shape;
  return { ...rest, ...fromPacked(floats) };
}

/** The name of the declaration `baked` prints for one shape and one set of writes, printed once per set. */
const bakedNames = new Map<string, string>();
function bakedName(shape: Record<string, any>, f: ReadonlyMap<number, number>): string {
  const out = baked(shape, f);
  const key = JSON.stringify(canon(out));
  let name = bakedNames.get(key);
  if (!name) {
    name = `values_${bakedNames.size}`;
    bakedNames.set(key, name);
    // the shape is already resolved for one theme, so it is one declaration: no per-theme variants to print
    printLiteral(name, out, false);
  }
  return name;
}

/** The states that hold for this element at build time, in pack.ts's order, and only those its style has. */
function heldStates(style: Record<string, any>, el: El): State[] {
  const held: State[] = [];
  if (pointer.id && pointer.id === el.props.id) held.push(pointer.down ? ":active" : ":hover");
  if (el.props.focused) held.push(":focus");
  return STATES.filter((s) => held.includes(s) && style[s]);
}

const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
        )
      : v;

// the text of a `text` element, as C's bytes: printable ASCII as is, the rest octal (C's three-digit octal escape
// cannot swallow the next byte as \x can)
const cstr = (s: string): string =>
  [...Buffer.from(s, "utf8")]
    .map((b) =>
      b === 0x22
        ? '\\"'
        : b === 0x5c
          ? "\\\\"
          : b === 0x0a
            ? "\\n"
            : b === 0x09
              ? "\\t"
              : b >= 0x20 && b < 0x7f
                ? String.fromCharCode(b)
                : `\\${b.toString(8).padStart(3, "0")}`,
    )
    .join("");

// ---------- the frame

let usedExports = false;
/** The texts in tree order, as the `--text` hook's indices: one table, checked on every frame. */
const texts: string[] = [];
function frameLines(root: El, theme: string | undefined, name: string): string[] {
  const lines: string[] = [];
  let index = 0; // per frame; the tree is the same for every theme and state, so the indices agree
  const emit = (el: El, depth: number) => {
    const pad = "    ".repeat(depth);
    if (el.tag === "text") {
      const text = el.children
        .filter((c) => c instanceof Txt)
        .map((c) => c.text)
        .join("");
      if (!opts.text) {
        lines.push(`${pad}CLAY_TEXT(CLAY_STRING("${cstr(text)}"), ${decl(el.props.style, el, theme, true)});`);
        return;
      }
      if (texts[index] === undefined) texts[index] = text;
      else if (texts[index] !== text) fail(`text ${index} is "${text}" in ${name}, "${texts[index]}" in the first frame`);
      lines.push(`${pad}CLAY_TEXT(${opts.text}(${index++}), ${decl(el.props.style, el, theme, true)});`);
      return;
    }
    const d = decl(el.props.style, el, theme, false);
    // A clip element is also Clay's scroll container, and its offset is the host's: the declaration header() prints has
    // the two axes and never a childOffset (a file-scope constant cannot ask Clay). The element is declared through
    // `clip_scroll`, which reads the offset where Clay has it open — the same call solid/native/ui.c's ui_open makes —
    // so the frame draws whatever offset the host put in the container.
    const wrapped = hasClip(el, theme) ? `clip_scroll(${d})` : d;
    const open = el.props.id ? `CLAY(CLAY_ID("${cstr(el.props.id)}"), ${wrapped})` : `CLAY_AUTO_ID(${wrapped})`;
    lines.push(`${pad}${open} {`);
    for (const c of el.children) if (c instanceof El) emit(c, depth + 1);
    lines.push(`${pad}}`);
  };
  for (const c of root.children) if (c instanceof El) emit(c, 1);
  return lines;
}

/** Does this element's declaration clip (Clay's scroll container), so its offset is the host's? */
function hasClip(el: El, theme: string | undefined): boolean {
  if (!el.props.style) return false;
  const shape = resolveStyle(el.props.style, theme, heldStates(el.props.style, el)) as Record<string, any>;
  return !!(shape.clip?.horizontal || shape.clip?.vertical);
}

// The one thing a declaration cannot say: a clip element's offset. Clay_GetScrollOffset() is only meaningful once the
// element is open, which is inside CLAY(...)'s own line, so the declaration goes through this function.
const CLIP_SCROLL = `// A clip element is Clay's scroll container, and its offset is the host's: header() prints the two axes and never a
// childOffset (a file-scope constant cannot call Clay). Read where the element is open, exactly as solid/native/ui.c's
// ui_open does, so the frame draws the offset the host put in the container (Clay_GetScrollContainerData).
static Clay_ElementDeclaration clip_scroll(Clay_ElementDeclaration d)
{
    d.clip.childOffset = Clay_GetScrollOffset();
    return d;
}
`;

/** Does any element of this tree clip? Then the file needs `clip_scroll`. */
const anyClip = (root: El): boolean => [...walk(root)].some((el) => hasClip(el, undefined));

function frameFunction(name: string, root: El, theme: string | undefined): string {
  return `void ${name}(void)\n{\n${frameLines(root, theme, name).join("\n")}\n}\n`;
}

// ---------- the state machine (`--events`)

/** Clay's id, `Clay__HashString`'s FNV-1a and its `+ 1` ("reserve zero as null"). ASCII ids only here, which is what
 *  the page's own `CLAY_ID("...")` strings are. */
function clayId(s: string): number {
  let hash = 0;
  for (const byte of Buffer.from(s, "utf8")) {
    hash = (hash + byte) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return (hash + 1) >>> 0;
}

const PRESS = "CLAY_EVENT_PRESS";
const RELEASE = "CLAY_EVENT_RELEASE";

interface Entry {
  /** The key in `--states`. */
  readonly key: string;
  readonly actions: readonly Action[];
  readonly root: El;
  readonly overlay: { readonly id?: string; readonly down: boolean };
  readonly dispose: () => void;
}

interface GenState {
  /** The `--states` key that names this frame, or the name the generator gave it (`<base> + hover <id>`). */
  readonly name: string;
  /** The signal state it is an overlay of: its actions are the ones replayed to reach it. */
  readonly base: Entry;
  readonly overlay: { readonly id?: string; readonly down: boolean };
  readonly root: El;
  readonly text: string;
  readonly dispose: () => void;
}

const eventFrames: string[] = [];
const eventsC = () => {
  const name = opts.eventsName;
  const entries: Entry[] = [];
  for (const [key, actions] of Object.entries(script)) {
    const label = `state "${key}"`;
    const page = renderState(actions, label);
    entries.push({ key, actions, root: page.root, overlay: { id: pointer.id, down: pointer.down }, dispose: page.dispose });
  }
  if (!entries.length) fail(`--states ${opts.states} names no state`);
  // a state's actions replay the page's signals; a pointer action is an overlay (what the frame draws), not a signal
  const bases = entries.filter((e) => !e.actions.some((a) => a.pointer !== undefined));
  if (!bases.length)
    fail(`--states ${opts.states} has no state without a pointer action: the table has nothing to start from`);

  themes = themesOf(entries.map((e) => e.root));
  if (themes.length > 2)
    fail(`--events carries the base theme and one variant (the host's \`light\`), not ${themes.length - 1} themes`);

  // the elements a host can dispatch to: an id and a handler, in tree order
  const handlers: string[] = [];
  for (const entry of entries) {
    for (const el of walk(entry.root)) {
      if (el.tag === "text") continue;
      if (!(el.props.onClick || el.props.onPress)) continue;
      if (!el.props.id)
        fail(`an element with an ${el.props.onClick ? "onClick" : "onPress"} has no id: the table cannot address it`);
      if (!handlers.includes(el.props.id)) handlers.push(el.props.id);
    }
  }

  // the entry's frame text is a state's identity: the same commands, whatever signals made them
  const entryText = new Map<Entry, string>();
  for (const entry of entries) {
    pointer.id = entry.overlay.id;
    pointer.down = entry.overlay.down;
    entryText.set(entry, frameLines(entry.root, undefined, `state "${entry.key}"`).join("\n"));
  }
  const nameOf = new Map<string, string>();
  for (const entry of entries) {
    const text = entryText.get(entry)!;
    if (!nameOf.has(text)) nameOf.set(text, entry.key);
  }

  const states: GenState[] = [];
  const byText = new Map<string, number>();
  const add = (
    base: Entry,
    overlay: { id?: string; down: boolean },
    suggested: string,
    actions: readonly Action[],
  ): number => {
    const page = renderState(actions, `state "${base.key}"`);
    pointer.id = overlay.id;
    pointer.down = overlay.down;
    const text = frameLines(page.root, undefined, suggested).join("\n");
    const existing = byText.get(text);
    if (existing !== undefined) {
      page.dispose();
      return existing;
    }
    const name = nameOf.get(text) ?? suggested;
    states.push({ name, base, overlay, root: page.root, text, dispose: page.dispose });
    byText.set(text, states.length - 1);
    return states.length - 1;
  };
  // the state space: each signal state, and its pointer overlay on each element a host can press (up: :hover, down:
  // :active). A signal state's own overlay with the pointer off it is the state `--states` names.
  for (const base of bases) {
    add(base, { down: false }, base.key, base.actions);
    for (const id of handlers) {
      add(base, { id, down: false }, `${base.key} + hover ${id}`, base.actions);
      add(base, { id, down: true }, `${base.key} + press ${id}`, base.actions);
    }
  }

  const index = (state: GenState) => states.indexOf(state);
  const transitions: { from: number; id: string; event: string; to: number }[] = [];
  for (const state of states) {
    for (const id of handlers) {
      const present = find(state.root, id);
      // a press: the button down over the element (its onPress runs), so the frame is that element's :active. A press
      // on an id this state does not declare leaves the state alone.
      if (present) {
        const page = renderState(state.base.actions, `state "${state.base.key}"`);
        pointer.id = id;
        pointer.down = true;
        find(page.root, id)?.props.onPress?.(0, 0);
        flush();
        const text = frameLines(page.root, undefined, `${state.name} + press ${id}`).join("\n");
        page.dispose();
        const to = byText.get(text);
        if (to === undefined)
          fail(
            `state "${state.name}": a press on "${id}" leads to a frame no state in ${opts.states} names ` +
              `(a signal it changes is not one of the state machine's)`,
          );
        transitions.push({ from: index(state), id, event: PRESS, to });
      } else {
        transitions.push({ from: index(state), id, event: PRESS, to: index(state) });
      }
      // a release: a click when the press was on this element, and the pointer is still over it, so the frame is the
      // state its onClick leads to, with :hover. A release elsewhere (or over an element the press was not on) leaves
      // the state alone, and the entry says so.
      if (state.overlay.id === id && state.overlay.down && present) {
        const page = renderState(state.base.actions, `state "${state.base.key}"`);
        pointer.id = id;
        pointer.down = false;
        find(page.root, id)?.props.onClick?.(0, 0);
        flush();
        const text = frameLines(page.root, undefined, `${state.name} + release ${id}`).join("\n");
        page.dispose();
        const to = byText.get(text);
        if (to === undefined)
          fail(
            `state "${state.name}": a release on "${id}" leads to a frame no state in ${opts.states} names ` +
              `(its onClick changes a signal the state machine does not list)`,
          );
        transitions.push({ from: index(state), id, event: RELEASE, to });
      } else {
        transitions.push({ from: index(state), id, event: RELEASE, to: index(state) });
      }
    }
  }

  // one frame function a state and theme, then the switch a host draws through
  const fn = (i: number, theme: string | undefined) => `${name}_frame_${i}${theme ? `_${theme}` : ""}`;
  for (let i = 0; i < states.length; i++)
    for (const theme of themes) {
      pointer.id = states[i]!.overlay.id;
      pointer.down = states[i]!.overlay.down;
      eventFrames.push(frameFunction(fn(i, theme), states[i]!.root, theme));
    }
  const cases = states.map(
    (_, i) =>
      `    case ${i}: if (light) ${fn(i, themes.at(-1))}(); else ${fn(i, undefined)}(); break;`,
  );

  const typeName = `${name[0]!.toUpperCase()}${name.slice(1)}Transition`;
  const table = transitions
    .map((t) => `    { ${t.from}, ${clayId(t.id)}u, ${t.event}, ${t.to} }, // "${t.id}"`)
    .join("\n");
  const lookup = transitions.length
    ? [
        `typedef struct { int from; uint32_t id; int event; int to; } ${typeName};`,
        `static const ${typeName} ${name}_transitions[] = {`,
        table,
        `};`,
        `int ${name}_next(int state, uint32_t id, int event)`,
        `{`,
        `    const int n = (int)(sizeof ${name}_transitions / sizeof ${name}_transitions[0]);`,
        `    for (int i = 0; i < n; i++)`,
        `        if (${name}_transitions[i].from == state && ${name}_transitions[i].id == id &&`,
        `            ${name}_transitions[i].event == event)`,
        `            return ${name}_transitions[i].to;`,
        `    return state;`,
        `}`,
      ]
    : [
        `// no element with a handler: every event leaves the state where it was`,
        `int ${name}_next(int state, uint32_t id, int event)`,
        `{`,
        `    (void)id, (void)event;`,
        `    return state;`,
        `}`,
      ];
  const lines = [
    `// Generated by generator/page-to-c.ts from ${opts.page} — do not edit.`,
    `// The page as a state machine: ${states.length} states, one frame a state and theme, and the transition table a host`,
    `// dispatches with. Event kinds are generator/events.h's. A state is the frame the page declares: its signals plus`,
    `// the pointer's overlay (:hover/:active over an element with an onClick/onPress).`,
    `// The states, by index, as --states ${opts.states} named them (or as the generator derived them):`,
    ...states.map((s, i) => `//   ${i}: "${cstr(s.name)}"`),
    opts.styles.length
      ? `// styles: ${opts.styles.join(", ")}, generated as styles.h by generator/clay-header.ts; referred to by their names there`
      : "// styles: none exported by the page; printed below as literals, in tree order",
    '#include "events.h"',
    usedExports ? '#include "styles.h"' : '#include "clay.h"',
    "",
    ...(literals.length
      ? ["// styles the page does not export, printed by cssints/clay's header()", ...literals.sort(), ""]
      : []),
    ...(states.some((s) => anyClip(s.root)) ? [CLIP_SCROLL] : []),
    ...eventFrames,
    `void ${name}_frame(int state, int light)\n{\n    switch (state) {\n${cases.join("\n")}\n` +
      `    default: ${fn(0, undefined)}(); break;\n    }\n}\n`,
    `// The state's name (the --states key, or how the generator derived it), for a host's log and a test's message.`,
    `static const char *const ${name}_state_names[${states.length}] = {`,
    ...states.map((s) => `    "${cstr(s.name)}",`),
    `};`,
    `int ${name}_state_count(void) { return ${states.length}; }`,
    `const char *${name}_state_name(int state)`,
    `{`,
    `    return state >= 0 && state < ${states.length} ? ${name}_state_names[state] : "";`,
    `}`,
    ``,
    `// The elements a click can reach, by Clay's id (${handlers.map((h) => `"${cstr(h)}"`).join(", ")}), in tree order.`,
    `static const uint32_t ${name}_handler_ids[${Math.max(1, handlers.length)}] = {${
      handlers.length ? ` ${handlers.map((h) => `${clayId(h)}u`).join(", ")} ` : " 0 "
    }};`,
    `int ${name}_handler_count(void) { return ${handlers.length}; }`,
    `uint32_t ${name}_handler_id(int index)`,
    `{`,
    `    return index >= 0 && index < ${handlers.length} ? ${name}_handler_ids[index] : 0;`,
    `}`,
    ``,
    `// A transition per state, element and event kind; the table is total over the states it names, so a lookup that`,
    `// misses is a release elsewhere or an event no handler took, and the state stays.`,
    ...lookup,
  ];
  for (const state of states) state.dispose();
  for (const entry of entries) entry.dispose();
  mkdirSync(dirname(resolve(opts.events!)), { recursive: true });
  writeFileSync(opts.events!, lines.join("\n") + "\n");
  console.log(
    `page-to-c: ${opts.page} -> ${opts.events}: ${states.length} states, ${transitions.length} transitions, ` +
      `${handlers.length} handler(s)`,
  );
};

// ---------- the file

if (opts.out) {
  const page = openPage();
  for (const key of opts.state) {
    const actions = script[key];
    if (!actions) fail(`no state "${key}" in ${opts.states}`);
    for (const a of actions) apply(a, page.root, `state "${key}"`, page.input);
  }
  themes = themesOf([page.root]);

  const frames: string[] = [];
  for (const theme of themes) frames.push(frameFunction(theme ? `${opts.name}_${theme}` : opts.name!, page.root, theme));

  const notes: string[] = [];
  if (Object.keys(opts.props).length)
    notes.push(`props: ${Object.entries(opts.props).map(([k, v]) => `${k}=${String(v)}`).join(", ")}`);
  if (opts.state.length) notes.push(`state: ${opts.state.join(", ")}`);
  if (opts.tick) notes.push(`tick: ${opts.tick} frame(s) at 1/60 of the page's own hook`);
  if (Object.keys(opts.scroll).length)
    notes.push(`scroll: ${Object.entries(opts.scroll).map(([k, v]) => `${k}=${v}px`).join(", ")}`);
  if (pointer.id) notes.push(`pointer over ${pointer.id}, ${pointer.down ? "down" : "up"}`);
  if (!notes.length) notes.push("state: the page's defaults");
  const cfile =
    [
      `// Generated by generator/page-to-c.ts from ${opts.page} — do not edit.`,
      `// ${notes.join("; ")}`,
      opts.styles.length
        ? `// styles: ${opts.styles.join(", ")}, generated as styles.h by generator/clay-header.ts; referred to by their names there`
        : "// styles: none exported by the page; printed below as literals, in tree order",
      "// The tree is the solid/src/renderer.ts tree the desktop draws, in tree order; each theme is the same tree again.",
      ...(opts.tick
        ? [
            "// The page's frame hook ran at build time, so this frame is the one it declares: an element the page moved",
            "// through the value channel is printed as `values_<n>`, its style with the numbers it wrote.",
          ]
        : []),
      ...(opts.text
        ? [
            `// The strings are the target's: ${opts.text}(index) is called once per text element, in tree order. These are`,
            "// the strings this page had at build time, so a target can check its own table against them:",
            ...texts.map((t, i) => `//   ${i}: "${cstr(t)}"`),
          ]
        : []),
      usedExports ? '#include "styles.h"' : '#include "clay.h"',
      "",
      ...(opts.text
        ? [`// called by the frame functions below, one per text element`, `Clay_String ${opts.text}(int index);`, ""]
        : []),
      ...(literals.length
        ? ["// styles the page does not export, printed by cssints/clay's header()", ...literals.sort(), ""]
        : []),
      ...(anyClip(page.root) ? [CLIP_SCROLL] : []),
      ...frames,
    ].join("\n") + "\n";

  mkdirSync(dirname(resolve(opts.out)), { recursive: true });
  writeFileSync(opts.out, cfile);
  console.log(`page-to-c: ${opts.page} (${notes.join("; ")}) -> ${opts.out}: ${frames.length} frame function(s)`);
  page.dispose();
}

if (opts.events) eventsC();
process.exit(0);
