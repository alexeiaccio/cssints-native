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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { header } from "cssints/clay";

const STATES = [":hover", ":focus", ":active"] as const;
type State = (typeof STATES)[number];

const fail = (what: string): never => {
  console.error(`page-to-c: ${what}`);
  process.exit(1);
};

// ---------- arguments

interface Options {
  page: string;
  out: string;
  name: string;
  styles: string[];
  states?: string;
  state: string[];
  /** The function the target supplies the strings with, by index: `--text`. */
  text?: string;
}
const opts: Partial<Options> & { styles: string[]; state: string[] } = { name: "app_frame", styles: [], state: [] };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => argv[++i] ?? fail(`missing value for ${a}`);
    if (a === "--out") opts.out = value();
    else if (a === "--name") opts.name = value();
    else if (a === "--styles") opts.styles.push(value());
    else if (a === "--states") opts.states = value();
    else if (a === "--state") opts.state.push(value());
    else if (a === "--text") opts.text = value();
    else if (a.startsWith("--")) fail(`unknown option ${a}`);
    else if (!opts.page) opts.page = a;
    else fail(`unexpected argument ${a}`);
  }
  if (!opts.page) fail("usage: bun generator/page-to-c.ts <page.tsx> --out <page.c> [--styles <styles.ts>]...");
  if (!opts.out) fail("--out is required");
  if (opts.state.length && !opts.states) fail("--state needs a --states file: a state is a script of events, not a signal");
  if (opts.text && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(opts.text)) fail(`--text ${opts.text} is not a C identifier`);
}

// ---------- the page, rendered

// JSX and cssints compile in Bun only through the app's loader, and it must be registered before the page is imported
await import("../solid/plugin.ts");
const { El, Txt, render } = await import("../solid/src/renderer.ts");
const { resolve: resolveStyle } = await import("../solid/src/pack.ts");
const { flush } = await import("solid-js");

const mod = await import(resolve(opts.page!));
const Page = Object.values(mod).find((v) => typeof v === "function") as
  | ((props: Record<string, unknown>) => unknown)
  | undefined;
if (!Page) fail(`${opts.page} exports no component`);

const root = new El("root");
const dispose = render(() => Page({}), root);
flush();

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
}
const pointer: { id?: string; down: boolean } = { down: false };
const state = opts.state;
if (state.length) {
  const script = JSON.parse(readFileSync(resolve(opts.states!), "utf8")) as Record<string, Action[]>;
  for (const key of state) {
    const actions = script[key];
    if (!actions) fail(`no state "${key}" in ${opts.states}`);
    for (const a of actions) {
      if (a.click) {
        const el = find(root, a.click);
        if (!el?.props.onClick) fail(`state "${key}": no element with id "${a.click}" and an onClick`);
        el.props.onClick(0, 0);
        flush();
      } else if (a.press) {
        const el = find(root, a.press);
        if (!el?.props.onPress) fail(`state "${key}": no element with id "${a.press}" and an onPress`);
        el.props.onPress(0, 0);
        flush();
      } else if (a.pointer) {
        pointer.id = a.pointer;
        pointer.down = !!a.down;
      } else fail(`state "${key}": unknown action ${JSON.stringify(a)}`);
    }
  }
}

// ---------- names: a style object is an export of a styles module, or a literal of this file

const exported = new Map<object, string>();
for (const file of opts.styles) {
  const styles = await import(resolve(file));
  for (const [name, v] of Object.entries(styles))
    if (v && typeof v === "object" && !Array.isArray(v)) exported.set(v, name);
}

// the themes the page's styles declare: a repaint of the same tree, one function each
const themes = new Set<string>();
for (const el of walk(root))
  for (const theme of Object.keys((el.props.style?.themes as object | undefined) ?? {})) themes.add(theme);
const themeNames = [undefined, ...[...themes].sort()];

// the two printers: header() prints a shape (with its states and themes) as C; it is called once per style the page
// does not export, with the themes the frame needs, so every declaration the file refers to exists
const literals: string[] = [];
const local = new Map<object, string>();
const printed = new Set<string>();
const printLiteral = (name: string, style: Record<string, any>) => {
  if (printed.has(name)) return;
  printed.add(name);
  const shape = { ...style, themes: { ...(style.themes ?? {}) } };
  for (const theme of themes) shape.themes[theme] ??= {};
  for (const line of header({ [name]: shape }).split("\n"))
    if (line.startsWith("static const ")) literals.push(line);
};

function* walk(n: El): Generator<El> {
  yield n;
  for (const c of n.children) if (c instanceof El) yield* walk(c);
}

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
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
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
const frames: string[] = [];
/** The texts in tree order, as the `--text` hook's indices: one table, checked on every frame. */
const texts: string[] = [];
function emitFrame(name: string, theme: string | undefined): void {
  const lines: string[] = [];
  let index = 0; // per frame; the tree is the same for every theme and state, so the indices agree
  const emit = (el: El, depth: number) => {
    const pad = "    ".repeat(depth);
    if (el.tag === "text") {
      const text = el.children.filter((c) => c instanceof Txt).map((c) => c.text).join("");
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
    const open = el.props.id ? `CLAY(CLAY_ID("${cstr(el.props.id)}"), ${d})` : `CLAY_AUTO_ID(${d})`;
    lines.push(`${pad}${open} {`);
    for (const c of el.children) if (c instanceof El) emit(c, depth + 1);
    lines.push(`${pad}}`);
  };
  for (const c of root.children) if (c instanceof El) emit(c, 1);
  frames.push(`void ${name}(void)\n{\n${lines.join("\n")}\n}\n`);
}
for (const theme of themeNames) emitFrame(theme ? `${opts.name}_${theme}` : opts.name!, theme);

// ---------- the file

const notes: string[] = [];
if (state.length) notes.push(`state: ${state.join(", ")}`);
if (pointer.id) notes.push(`pointer over ${pointer.id}, ${pointer.down ? "down" : "up"}`);
if (!notes.length) notes.push("state: the page's defaults");
const cfile = [
  `// Generated by generator/page-to-c.ts from ${opts.page} — do not edit.`,
  `// ${notes.join("; ")}`,
  opts.styles.length
    ? `// styles: ${opts.styles.join(", ")}, generated as styles.h by generator/clay-header.ts; referred to by their names there`
    : "// styles: none exported by the page; printed below as literals, in tree order",
  "// The tree is the solid/src/renderer.ts tree the desktop draws, in tree order; each theme is the same tree again.",
  ...(opts.text
    ? [
        `// The strings are the target's: ${opts.text}(index) is called once per text element, in tree order. These are`,
        "// the strings this page had at build time, so a target can check its own table against them:",
        ...texts.map((t, i) => `//   ${i}: "${cstr(t)}"`),
      ]
    : []),
  usedExports ? '#include "styles.h"' : '#include "clay.h"',
  "",
  ...(opts.text ? [`// called by the frame functions below, one per text element`, `Clay_String ${opts.text}(int index);`, ""] : []),
  ...(literals.length ? ["// styles the page does not export, printed by cssints/clay's header()", ...literals.sort(), ""] : []),
  ...frames,
].join("\n") + "\n";

mkdirSync(dirname(resolve(opts.out!)), { recursive: true });
writeFileSync(opts.out!, cfile);
dispose();
console.log(`page-to-c: ${opts.page} (${notes.join("; ")}) -> ${opts.out}: ${frames.length} frame function(s)`);
process.exit(0);
