// The Solid host on the terminal: solid/main.ts's loop shape, over Clay in cells instead of ThorVG in pixels. Two of the
// desktop's pages run here, each **unmodified**; what is the terminal's is the host underneath them, and the lengths the
// C page re-cuts for a cell grid (terminal/page.c's and terminal/sky.c's own, through the value channel, not by
// rewriting a page):
//
//   the Sensors page          the root's padding and gap 64/40/56 px and an 8px gap -> 2 cells of padding and no gap;
//                             the Units pill's height 38 px (2.4 rows) -> 3 cells, so a border, a line of text and a
//                             border are 3 rows; the pill's focus ring is page.c's accent border while it has focus
//
//   the Sky feed              the bar's height 64 px -> 1 cell row and its 16px/20px padding and gap -> 1 cell; the status
//                             line 32 px -> 1 row; a card's 12px padding and 8px gap -> 1 cell of side padding, 0 above and
//                             below; a tab's 6px/10px padding -> 0 and a cell after its label (its label is the row). The
//                             feed's own 12px padding and 8px gap are left as the page's: the page's scroll adds the same
//                             lengths, and in cells the 12px inset is the first card's one-cell gutter and the 8px gap is
//                             the empty row the C page draws as a separator. The avatar is an image: the host skips it,
//                             because a cell has no glyph for it and its 40x40 box would be three rows of nothing the C
//                             page does not draw
//
// Run with Bun:
//
//   bun terminal/solid.ts                  live: termbox2's alternate screen, the page's frame each 16ms, q/Ctrl+C/Escape
//                                          quits; a click toggles the Units pill (the page's own onClick), Tab moves the
//                                          focus off the pill, Space/Enter press it, `t` flips the theme
//   bun terminal/solid.ts --page sky       live: the Sky page — the feed, its thread, its profile and its notifications
//                                          (and the settings screen), as the desktop has them. Tab reaches the tablist
//                                          then the feed, Left/Right switch the feed, Up/Down, PageUp/PageDown, Home/End
//                                          scroll it, `j`/`k` are the C page's Down/Up, the wheel is a notch, a click on a
//                                          tab switches the feed, one on a card opens its thread (the page's own onClick, in
//                                          its loading state, then the app's recorded thread: `load`'s promise below),
//                                          one on the card's author row opens the profile; `n` opens the notifications (the
//                                          C shell's key) and Enter on a row opens its post's thread; Escape (or Enter on
//                                          Back) returns; `t` flips the theme. The feed's data is the app's: `data.ts`'s
//                                          `homeScreen` over apps/csssky's recordings — its first page on the page's first
//                                          frame, the next when the scroll reaches the feed's end, the status line saying
//                                          the loading, end and error states
//   bun terminal/solid.ts --page notify    the same page started on its notifications screen (the C host's
//                                          `--page notifications`, the page `n` leaves the feed on)
//   bun terminal/solid.ts --page figure --spec solid/specs/bars.json
//                                          the Figure page: the desktop's spec as cells. The layout already speaks
//                                          cells (solid/src/figure/kinds.ts), so the host re-cuts nothing; a spec that
//                                          `check` refuses fails with its sentences before a frame, as solid/main.ts does
//   ... --spec solid/specs/bars.json --text|--markdown
//                                          the same layout as characters instead of cells (solid/src/figure/text.ts,
//                                          the module solid/figure.ts prints): --compact, --width N
//   bun terminal/solid.ts --dump [file]    one frame headless, as plain text (cells_dump: '.' is a fill); no file: stdout
//   bun terminal/solid.ts --ansi [file]    the same frame as ANSI truecolour (SGR runs merged)
//   bun terminal/solid.ts --console [file] the same frame as a browser console.log call (cells_console: one %c run a
//                                          colour pair, every cell of every row); a JSON array of the call's arguments
//   --console-frames [file]                ... appended one line a frame during the run, as the console page writes: the
//                                          rows that changed since the frame before, or [] when none did
//   --keys Tab,ArrowDown                   headless: the frame, then each key with a frame after it, as main.c. A `-`
//                                          is a frame with no input: what a screen needs between its opening and a
//                                          scroll key, because the page measures its content from the last layout
//   --keys WheelDown                       the page's wheel, as a notch down (WheelUp: a notch up)
//   --click X,Y                            headless: the frame, a press over that cell with a frame, a release with a frame
//   --theme light                          the light theme (also THEME=light)
//   --system-theme                         the page's colours from the terminal's own (also THEME=system): OSC 11, OSC 10
//                                          and OSC 4;0..15 through @cssints/tui/system's parser and solver; `s` re-asks
//   --cols N --rows N                      the grid (80x20 by default: the C pages' size in test.sh)
//   --bench N                              headless: N frames, printing the ms a frame and the cells as ANSI
//   --mutate scroll|tab|open|back          a deliberately broken host, for terminal/test.sh's mutation lines: `scroll`
//                                          drops the page's offset before Clay (the feed stays at row 0), `tab` never
//                                          flushes the frame a tab switch lands on (the bar's active tab stays), `open`
//                                          drops a card's own onClick (a click and Enter leave the feed), `back` never
//                                          hands the page an Escape (a thread or a profile stays up). `verbs` and `rows`
//                                          are the page's own (`Sky.tsx`'s prop, `Notify.tsx`): one wrong verb on every
//                                          notification row, and the rows no Tab stops. `end` is the page's too: it never
//                                          asks the next feed page (the feed stays at page 1)
//   --mutate cursor                        the source's (data.ts): every page is page 1, so the second request repeats
//                                          the first and the page's dedupe finds nothing new
//   --offline                              nothing is answered: the feed's and a thread's error states (data.ts fails
//                                          both calls)
//   --mutate channel|wait                  the system theme's two: `channel` reads the answer's foreground as its
//                                          background (a light terminal's frame goes dark), `wait` asks with no timeout (a
//                                          terminal that never answers hangs the host)
//
// The thread, the profile and the notifications are the page's **screens**, not pages of their own: `Sky.tsx` mounts the
// thread as a root float over the feed and `Profile.tsx`'s `createProfile` and `Notify.tsx`'s `createNotify` are called
// by `Sky` and their elements declared in `Sky`'s tree, so `--page notify` is that page with the notifications screen
// open (`Sky`'s `screen` prop), not a page of its own (the C `demo --page notifications` is a stack entry point its own
// host has). They are driven as the page drives them: a card's click (or, as the C feed's Enter, the host pressing the
// first card's onClick while the feed is focused) opens the thread, a click on the card's author row opens the profile,
// `n` the notifications, and Escape is the page's back — a notification's row opens its post's thread, and that thread's
// back returns to the list. The thread's `load` is handed a promise the host settles with the app's **recorded** thread
// (apps/csssky/test/fixtures/thread.json through the page's own screenOf, which is the fixture solid/thread.test.ts hands
// it — `data.ts`'s `threadScreen`) a frame after the screen mounts: the loading row gets that frame, the app's rows the
// next. The profile needs
// nothing: `profile.ts` reads the app's recordings itself, on the first opening.

// What it cannot do is a cell's limit, and said in native/README.md: text is one row (a body wraps at words, but a line
// is a cell and a long word is broken nowhere), an image is a skipped box, a group's opacity and translate have no
// cells, and termbox2 reports no motion, so a hover is only where the last press was.
import "../solid/plugin.ts";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ClayShape } from "cssints/clay";

import type { Motion } from "../solid/src/entry.ts";
import type { State, Variant } from "../solid/src/pack.ts";
import type { Report } from "../../packages/tui/src/system.ts";

// The page's own module (`src/entry.ts`, `pageEntry`) writes its entry motion through `solid/src/ffi.ts`, which on this
// target is libterm: the alias is here, before the page is imported. The motion's fields (a subtree's opacity and
// translate) have no cell meaning and the binding drops them, so the page's first mount is the frame its literals make.
const binding = new URL("./term.ts", import.meta.url).pathname;
plugin({
  name: "cssints-terminal-ffi",
  setup(build) {
    build.onLoad({ filter: /\/solid\/src\/ffi\.ts$/ }, () => ({
      contents: `export * from ${JSON.stringify(binding)};`,
      loader: "ts",
    }));
  },
});

const arg = (name: string, n = 1) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv.slice(i + 1, i + 1 + n);
};
// a flag whose value is optional: `--dump` (stdout) or `--dump out.txt`
const file = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next !== undefined && !next.startsWith("--") ? next : "-";
};
const dump = file("--dump");
const ansi = file("--ansi");
// the console sink: `--console` writes the last frame once, `--console-frames` appends one JSON line a frame (the diff
// against the frame before it, "[]" when nothing changed) — the same sink a browser page logs
const consoleOut = file("--console");
const consoleFrames = file("--console-frames");
const keys = arg("--keys")?.[0]?.split(",");
const click = arg("--click")?.[0]?.split(",").map(Number);
const cols = Number(arg("--cols")?.[0] ?? 80);
const rows = Number(arg("--rows")?.[0] ?? 20);
const bench = Number(arg("--bench")?.[0] ?? 0);
// headless: frames with no input after the keys (and the click), so a page's own motion (the Sky feed's spring and
// fling, a tab's fade) has settled before the dump: main.ts's `--settle`
const settle = Number(arg("--settle")?.[0] ?? 0);
// headless: print the Sky feed's own scroll offset (the clip's, written by vscroll.ts) with the frame, so a test can
// compare the displacement the page moved its rows by
const showOffset = arg("--offset") !== undefined;
// the page: the desktop's names and the terminal's aliases (`main.c`: sensors, sky, notify — the last the Sky page on its
// notifications screen, as `main.c`'s `--page notifications` starts its stack there), and the Figure page with a spec
const page = arg("--page")?.[0] ?? "sensors";
const skyPage = page === "sky" || page === "notify";
const figurePage = page === "figure";
const sensorsPage = page === "sensors";
// the figure's spec: read and checked before the grid, so an invalid one exits with its sentences and no cells
const specPath = arg("--spec")?.[0];
let figureSpec: import("../solid/src/figure/spec.ts").Spec | undefined;
if (figurePage) {
  if (!specPath) {
    console.error("terminal: --page figure needs --spec <file.json> (solid/specs/bars.json)");
    process.exit(2);
  }
  const { parse } = await import("../solid/src/figure/spec.ts");
  const { spec, problems } = parse(readFileSync(specPath, "utf8"), { dir: dirname(specPath) });
  if (!spec) {
    for (const problem of problems) console.error(`figure: ${problem}`);
    process.exit(1);
  }
  figureSpec = spec;
}
// the text half: `--text`/`--markdown` print the layout as characters (solid/src/figure/text.ts) before the grid opens,
// so a figure reaches a README from the host a script already runs, and the two paths are one module. `--compact` and
// `--width` are the CLI's flags.
if (figurePage && (process.argv.includes("--text") || process.argv.includes("--markdown"))) {
  const { markdown, render } = await import("../solid/src/figure/text.ts");
  const width = Number(arg("--width")?.[0] ?? 80);
  const compact = process.argv.includes("--compact");
  const options = { width, compact };
  console.log(process.argv.includes("--markdown") ? markdown(figureSpec!, options) : render(figureSpec!, options));
  process.exit(0);
}
// a deliberately broken host for the test's mutation lines: `scroll` drops the page's clip offset, `tab` never flushes
// the frame a tab switch lands on, so the tree (the bar's active tab) stays as it was
const mutate = arg("--mutate")?.[0] ?? "";
// headless: every frame of the run beside PREFIX, PREFIX.N.txt (the dump) and PREFIX.N.ansi: a test that checks the base
// frame, a key and the frame after it needs all three, and one Bun start is most of a run's cost
const framesOut = file("--frames-out");
// headless: frames at rest before the input. The Sky page's window measures its cards on the first frame (a frame of
// the whole feed, as the desktop's `--warm` is for), and its card entry is 0.3s: a frame at rest is the settled one
const warm = Number(arg("--warm")?.[0] ?? (skyPage ? 60 : 0));
// live: draw N frames with no input, then quit (a smoke check, as main.c's; 1 is a screen)
const maxFrames = Number(arg("--frames")?.[0] ?? Infinity);
const headless = dump !== undefined || ansi !== undefined || consoleOut !== undefined || consoleFrames !== undefined || bench > 0 || framesOut !== undefined;
// the theme's two static literals, and the third: the terminal's own colours (`--system-theme`/THEME=system), solved
let theme: string | undefined = (arg("--theme")?.[0] ?? process.env.THEME) === "light" ? "light" : undefined;
const systemFlag =
  arg("--theme") === undefined && (arg("--system-theme") !== undefined || process.env.THEME === "system");

const { term } = await import("./term.ts");
const { flush } = await import("solid-js");
const { createInput } = await import("../solid/src/input.ts");
const { El, Txt, render } = await import("../solid/src/renderer.ts");
const { FIELDS, hasStates, packText, variant } = await import("../solid/src/pack.ts");
if (page !== "sensors" && page !== "figure" && !skyPage) {
  console.error(`terminal: unknown page "${page}" (sensors, figure, sky, notify)`);
  process.exit(2);
}
const { Sensors } = sensorsPage ? await import("../solid/app/Sensors.tsx") : { Sensors: undefined };
const { Figure } = figurePage ? await import("../solid/app/Figure.tsx") : { Figure: undefined };
const { Sky, s: skyStyles, screenOf } =
  skyPage ? await import("../solid/app/Sky.tsx") : { Sky: undefined, s: undefined, screenOf: undefined };
const styles = sensorsPage ? await import("../examples/sensors/styles.ts") : undefined;

// The terminal's AppView: apps/csssky/src/api.ts's calls, answered from its recorded fixtures (./data.ts: the feed's
// pages and a post's thread; nothing for `listNotifications`, which no fixtures recorded). Imported for the sky page only,
// so the Sensors host never reads the recordings. `--offline` makes both calls fail (the page's error state) and
// `--mutate cursor` answers page 1 for page 2 (the page's dedupe's own test); both are terminal/test.sh's.
const data = skyPage
  ? (await import("./data.ts")).source({
      offline: arg("--offline") !== undefined,
      cursor: mutate === "cursor",
    })
  : undefined;

// The system theme is the tui package's, not a second copy of it: `scan` takes OSC 10/11/4 and `CSI ? 997 n` out of a
// chunk of input, and `createSystemTheme` (./theme.ts) solves the page's tokens from what it found. The package prints a
// deprecation notice from its index (this host is the target it points at); the flag is that file's own, set first.
(globalThis as Record<symbol, boolean>)[Symbol.for("cssints.tui.deprecated")] = true;
const { QUERY, scan } = await import("../../packages/tui/src/system.ts");
const { forget, repaint, solve } = await import("./theme.ts");

// A cell is 8x16 (terminal/cells.h): the terminal's own unit, and the re-cut below is in it.
const CELL_W = 8;
const CELL_H = 16;
const WHITE_14 = packText({ textColor: { r: 255, g: 255, b: 255, a: 255 }, fontSize: 14 });
const NO_STYLE = new Float32Array(45);

// The system theme's cost and its answer. 120 ms is the whole of a silent terminal's charge, paid once at startup (and
// once per `s`): a terminal that answers does so in single-digit ms and a 15 ms quiet gap ends the read, so the frame's
// first draw is the only thing the ask delays, never a frame of the loop.
const ASK_MS = 120;
const ASK_BYTES = 4096;
let paint: Awaited<ReturnType<typeof solve>>;

/** Asks the terminal for its colours (`QUERY`: OSC 11, OSC 10, the 16 OSC 4 entries, `CSI ? 996 n`) and folds the answer
 *  into the page's palette with the tui's solver. A terminal that does not answer (a pipe, `TERM=dumb`, no `/dev/tty`)
 *  keeps the theme the flag gave, and says so on stderr. */
function askSystem(): void {
  if (!systemFlag) return;
  if (!skyPage) {
    console.error("terminal: the system theme is the Sky page's (its tokens are the ones with roles); the dark theme");
    return;
  }
  const out = new Uint8Array(ASK_BYTES);
  const started = performance.now();
  // a mutation for terminal/test.sh: `wait` hands the ask no timeout, so a terminal that never answers hangs the host
  const dumb = process.env.TERM === "dumb";
  const len = dumb ? 0 : term.ask(QUERY, out, mutate === "wait" ? -1 : ASK_MS);
  const ms = performance.now() - started;
  // the reply is bytes of ASCII: one char a byte, as the parser takes it
  const { replies } = scan(Buffer.from(out.subarray(0, len)).toString("latin1"));
  const report: Report = { ansi: [] };
  if (replies.fg) report.fg = replies.fg;
  if (replies.bg) report.bg = replies.bg;
  if (replies.scheme) report.scheme = replies.scheme;
  const ansi: (string | undefined)[] = [];
  for (const [i, hex] of replies.ansi) ansi[i] = hex;
  report.ansi = ansi;
  // a mutation for terminal/test.sh: the answer read as the wrong channel, so a light terminal's page is the
  // foreground's (dark) and the frame draws where the answer did not
  if (mutate === "channel") [report.fg, report.bg] = [report.bg, report.fg];
  const solved = solve(skyStyles!.t as never, report);
  if (!solved) {
    console.error(
      dumb
        ? "terminal: TERM=dumb, no colours asked; the dark theme"
        : `terminal: no colours from the terminal in ${ms.toFixed(1)} ms (${len} bytes); the dark theme`,
    );
    return;
  }
  paint = solved;
  forget();
  theme = "system";
  console.error(
    `terminal: ${report.fg ?? "?"} on ${report.bg} (${solved.appearance}), ${replies.ansi.size} of the 16 palette ` +
      `entries; asked in ${ms.toFixed(1)} ms`,
  );
}

/** A style under the theme that is on: pack.ts's `variant`, or the terminal's palette painted over it in the system theme. */
const skin = (shape: ClayShape, states: State[] = []): Variant =>
  theme === "system" && paint ? repaint(shape, states, paint) : variant(shape, theme, states);

const encoder = new TextEncoder();
const ids = new Map<string, Uint8Array>();
const idBytes = (id: string) => ids.get(id) ?? (ids.set(id, encoder.encode(id)), ids.get(id)!);

/**
 * The thread's data: the app's recorded `getPostThread` answer (apps/csssky/test/fixtures/thread.json), shaped by the
 * page's own `screenOf` — through `terminal/data.ts`, the terminal's AppView over the app's recordings (the same object
 * the feed's pages come from). It is read for the sky page only, and never fetched: the terminal has no AppView, and
 * thread.c shows the same fixture for whichever post opened it (the app's test stub's answer).
 */
const SCREEN = (uri: string) => data!.threadScreen(uri);
/** The resolver of the `load` promise the page is waiting on, if any: `land` is the host settling it, and `landWait`
 *  the frames still to draw before it does (the screen's node mounts one frame after the ask, so the loading row's own
 *  frame is the one after that). */
let landThread: (() => void) | undefined;
let landWait = 0;

const root = new El("root");
const input = createInput();
// `t` is the page's shortcut, and the host's: as solid/main.ts, while no text field has focus. `s` asks the terminal
// for its colours again (the system theme's own key)
input.fallback = (name) =>
  name === "t"
    ? ((theme = theme ? undefined : "light"), true)
    : systemFlag && name === "s"
      ? (askSystem(), true)
      : false;
// the page's frame hook. The Sky page puts its wheel, its pointer and its tick on it; Sensors uses no motion of its own,
// and `pageEntry` (which this target drops into the binding) puts the first mount on the tick.
const motion: Motion = {};
// the theme is asked for before the tree's first frame: the page's `theme` getter reads the host's variable every frame
if (systemFlag) askSystem();
const dispose = skyPage
  ? render(
      () =>
        Sky!({
          input,
          motion,
          theme: () => theme,
          // the settings screen's theme radio writes the host's own `theme`: its frame's getter is what every style's
          // variant is picked by, so the palette follows the page
          setTheme: (next) => (theme = next),
          // the feed's data: the app's `homeScreen` over the recordings — its first page on the page's first frame, the
          // next when the feed's scroll reaches its end (apps/csssky's own sentinel), the status line's loading, end and
          // error states between them
          pages: (feed, cursor) => data!.homeScreen(feed, cursor),
          // the thread's loader: no network in the host. A card's click opens the loading state, and the host settles
          // this promise a frame after the screen mounts with the app's recorded thread (data.ts's `threadScreen`): the
          // loading row is a frame the run really draws, and the rows land on the one after it. `--offline` throws, so
          // the screen is its error state.
          load: (uri) =>
            new Promise((resolve) => {
              // a throw (`--offline`) rejects the page's promise, which is the screen's error state
              const answer = SCREEN(uri);
              landThread = () => resolve(answer);
              landWait = 1;
            }),
          // `--page notify`: the page the feed's `n` leaves it on (the C host's `--page notifications`)
          screen: page === "notify" ? "notifications" : undefined,
          // `--mutate verbs|rows`: the page's own broken runs (the other three are the host's)
          mutate,
        }),
      root,
    )
  : figurePage
    ? render(() => Figure!({ spec: figureSpec!, motion }), root)
    : render(() => Sensors!({ motion }), root);

// The page's one control, as terminal/page.c's focus is two ints: 0 the Units pill, 1 nothing (the C page's list, which
// Sensors.tsx does not have). Tab moves off the pill and there is nowhere to go, so the ring goes with it.
let focus = 0;
let units: El | undefined;

let clickable: El[] = [];
let pressed = new Set<El>();
let wasDown = false;
// a mutation (`--mutate tab`): the tree is not flushed after the key that switches the feed
let frozen = false;

const over = (el: El) => (el.props.id ? term.over(idBytes(el.props.id)) : false);

const encoded = new WeakMap<El, { str: string; bytes: Uint8Array }>();
/** The text of a `text` element as UTF-8, encoded again only when it changed. */
function bytesOf(el: El): Uint8Array {
  let str = "";
  for (const c of el.children) if (c instanceof Txt) str += c.text;
  let cached = encoded.get(el);
  if (!cached || cached.str !== str) encoded.set(el, (cached = { str, bytes: encoder.encode(str) }));
  return cached.bytes;
}

/** One element of the page's tree, declared to Clay in order: the same walk as solid/src/frame.ts, without the effects a
 *  cell cannot show (an image, a shadow, a backdrop, a gradient). */
function emit(el: El, down: boolean) {
  const style = el.props.style;
  if (el.tag === "text") {
    const tid = el.props.id ? idBytes(el.props.id) : undefined;
    if (skyPage && el.props.id) recut(el.props.id);
    const bytes = bytesOf(el);
    // a text with nothing in it is no command at all: a post with no words (its media line is its card) still declares
    // its body, and Bun's FFI refuses a zero-length pointer
    if (bytes.length === 0) return;
    term.text(tid, bytes, (style && skin(style).text) || WHITE_14);
    return;
  }
  const id = el.props.id ? idBytes(el.props.id) : undefined;
  let states: (":hover" | ":focus" | ":active")[] = [];
  if (id && style && hasStates(style)) states = term.over(id) ? [down ? ":active" : ":hover"] : [];
  // the page's focus is a prop (the tablist's and the feed's): a cell draws the `:focus` border as the box characters
  // of the element's own box (the Sky page's ring), where the C pages hand-cut one
  if (el.props.focused) states.push(":focus");
  if (el.props.id === "Units") units = el;
  if (id && (el.props.onClick || el.props.onPress)) clickable.push(el);
  const v = style ? skin(style, states) : undefined;
  // an image is a box with no glyph: the Sky cards' avatars are pictures, and a cell page has none, so the host skips
  // the element rather than spending its 40x40 box (three rows of nothing) on the grid
  if (v?.image) return;
  // the page's cell re-cut, for the elements a frame declares (the value channel is read when the element opens)
  if (skyPage && el.props.id) {
    recut(el.props.id);
    // a card with a border — the selected feed card, the thread's focused root — keeps its lines off the border's row:
    // Clay's border is drawn after the children, so a top border on a card with no vertical padding would overwrite the
    // card's name with box characters (the C cards pad a cell above and below for the same reason)
    const b = v?.box;
    if (b && !!(b[22]! > 0 || b[23]! > 0 || b[24]! > 0 || b[25]! > 0) && CARD.test(el.props.id)) {
      put(el.props.id, FIELDS.PADDING + 2, CELL_H);
      put(el.props.id, FIELDS.PADDING + 3, CELL_H);
    }
  }
  term.openElement(id, v?.box ?? NO_STYLE);
  for (const c of el.children) if (c instanceof El) emit(c, down);
  term.closeElement();
}

/** A cell length write: one field of the style of an element, for this frame only. */
const put = (id: string, field: number, v: number) => term.value(idBytes(id), field, v);
/** A FIXED axis (Clay's 3) on its min and max: a height that is exactly h pixels, so a row of text, a border and a row
 *  of text are three rows. */
const fixedHeight = (id: string, h: number) =>
  (put(id, FIELDS.HEIGHT, 3), put(id, FIELDS.HEIGHT + 1, h), put(id, FIELDS.HEIGHT + 2, h));

/** The terminal's re-cut of the page's lengths, and the ring the page's focus would draw: terminal/page.c's own numbers,
 *  through the value channel, so the page's styles.ts stays the desktop's. */
function cellStyle() {
  const page = idBytes("Root");
  const pill = idBytes("Units");
  term.value(page, FIELDS.PADDING + 0, 2 * CELL_W);
  term.value(page, FIELDS.PADDING + 1, 2 * CELL_W);
  term.value(page, FIELDS.PADDING + 2, 2 * CELL_H);
  term.value(page, FIELDS.PADDING + 3, 2 * CELL_H);
  term.value(page, FIELDS.GAP, 0);
  // 3: CLAY__SIZING_TYPE_FIXED, then the min and the max (solid/src/pack.ts's axis)
  term.value(pill, FIELDS.HEIGHT + 0, 3);
  term.value(pill, FIELDS.HEIGHT + 1, 3 * CELL_H);
  term.value(pill, FIELDS.HEIGHT + 2, 3 * CELL_H);
  // the ring is page.c's `magnitude_text` border, resolved in the theme that is on
  if (focus === 0) {
    const accent = skin(styles!.magnitude).text!;
    for (let i = 0; i < 4; i++) term.value(pill, FIELDS.BORDER + i, accent[i]!);
  }
}

/** A card's re-cut, the feed's and a screen's alike: one cell of side padding, no sub-cell vertical padding or gap, so
 *  its lines are rows (terminal/sky.c's card_style, thread.c's, profile.c's and notify.c's). */
const CARD = /^sky-(?:thread-|profile-|notify-)?card-\d+$/;
const cardCut = (id: string) => (
  put(id, FIELDS.PADDING, CELL_W),
  put(id, FIELDS.PADDING + 1, CELL_W),
  put(id, FIELDS.PADDING + 2, 0),
  put(id, FIELDS.PADDING + 3, 0),
  put(id, FIELDS.GAP, 0)
);

/**
 * One element's re-cut, written through the value channel by the walk **just before that element is opened**, so a frame
 * writes a value only for the elements it declares (the value table is 256 a frame): the Sky page's re-cut, terminal/
 * sky.c's, thread.c's and profile.c's numbers. The bar one row, its padding and gap one cell, a tab's padding zero (its
 * label is the row); the status line one row and one cell in; a card one cell of side padding. The clips' own 12px
 * padding and 8px gap are **not** re-cut: the page's scroll arithmetic adds the same lengths (its PAD/GAP), so a host
 * that zeroed them would make the page's content end larger than Clay's and the clip would stop the scroll short of the
 * page's own end — and in cells the 12px inset lands the first card on row 1, the 8px gap is the empty row between cards
 * that the C page draws as its separator. The C pages cut the same lengths by hand; the page's pixels are only touched
 * here.
 *
 * The thread, the profile and the notifications are the page's **screens**, all the same shape (a root float at the page's
 * 64px — the bar — and 696px — the window less the bar — over the content area, a 44px head with the Back control, a clip
 * of cards): in
 * cells the float sits one row down (the host's bar is one row) and takes the rows under it, the head and the 28px Back
 * are one row each (a 2px border on a one-row control is the row's own cells, box characters), and a card is the feed's.
 */
function recut(id: string): void {
  if (id === "sky-bar") {
    fixedHeight(id, CELL_H);
    put(id, FIELDS.PADDING, CELL_W);
    put(id, FIELDS.PADDING + 1, CELL_W);
    put(id, FIELDS.GAP, CELL_W);
    return;
  }
  // the tablist's 2px gap is a sub-cell, so each tab carries a cell of right padding (its own label apart from the next)
  // A tab's 2px underline (its own bottom border) is the whole of a one-row tab's row, and drawing it overwrites the
  // label. A cell's active tab is its label's colour, and the bar's focus is the C bar's active tab: the accent fill and
  // an on-accent label, which is the one focus look a one-row control can carry without eating its glyphs.
  if (id.startsWith("sky-tabs-tab-")) {
    put(id, FIELDS.PADDING, 0);
    put(id, FIELDS.PADDING + 1, CELL_W); // one cell between one tab's label and the next
    put(id, FIELDS.PADDING + 2, 0);
    put(id, FIELDS.PADDING + 3, 0);
    // the border widths are the four before the border colour (pack.ts's packBox: 22..25, then 26..29)
    for (let f = FIELDS.BORDER - 4; f < FIELDS.BORDER; f++) put(id, f, 0);
    const accent = skyStyles ? skin(skyStyles.tabTextOn).text : undefined;
    if (accent && id === input.focus.focused()) {
      for (let k = 0; k < 3; k++) put(id, FIELDS.BACKGROUND + k, accent[k]!);
      put(id, FIELDS.BACKGROUND_ALPHA, 255);
    }
    return;
  }
  // ... and the focused tab's label, which the page ids: its colour is the text's own four floats, not its box's
  const labelOf = `sky-tabs-tab-${id.slice("sky-tabs-label-".length)}`;
  if (id.startsWith("sky-tabs-label-") && labelOf === input.focus.focused()) {
    for (let k = 0; k < 4; k++) put(id, FIELDS.TEXT_COLOR + k, 255);
    return;
  }
  if (id === "sky-status") {
    fixedHeight(id, CELL_H);
    put(id, FIELDS.PADDING, CELL_W);
    put(id, FIELDS.PADDING + 1, CELL_W);
    return;
  }
  if (id.startsWith("sky-card-") || id.startsWith("sky-thread-card-") || id.startsWith("sky-profile-card-") ||
      id.startsWith("sky-notify-card-"))
    return void cardCut(id);
  if (id === "sky-thread" || id === "sky-profile" || id === "sky-notify") {
    put(id, FIELDS.OFFSET_Y, CELL_H);
    return void fixedHeight(id, (gridRows() - 1) * CELL_H);
  }
  if (id === "sky-thread-head" || id === "sky-profile-head" || id === "sky-notify-head") return void fixedHeight(id, CELL_H);
  // the Back control: its 1px border is drawn after the text (Clay adds a border's command on the way out of the
  // element, after its children) and would be its own row's cells, eating the word; a cell's Back is the panel fill and
  // the word. The C pages have no control here (escape is their bar's text); this one is the page's own button.
  if (id === "sky-back" || id === "sky-profile-back" || id === "sky-notify-back") {
    fixedHeight(id, CELL_H);
    for (let f = FIELDS.BORDER - 4; f < FIELDS.BORDER; f++) put(id, f, 0);
    return;
  }
  // the profile's header: the avatar is a drawn 56px disc (no image, no glyph) and its 3.5 rows are two; the tabs are the
  // bar's re-cut (no padding, a cell after the label), and their border widths are zero — the active tab's 2px underline
  // and a focused tab's 2px ring are a one-row tab's whole row, and Profile.tsx gives its labels no id for the host to
  // write an on-accent colour through, so the active tab is its own accent label (the style's literal) and the focus has
  // no cell of its own. The bar's tabs can do more because Sky.tsx ids their labels.
  if (id === "sky-profile-avatar") return void fixedHeight(id, 2 * CELL_H);
  if (id.startsWith("sky-profile-tabs-tab-")) {
    put(id, FIELDS.PADDING, 0);
    put(id, FIELDS.PADDING + 1, CELL_W);
    put(id, FIELDS.PADDING + 2, 0);
    put(id, FIELDS.PADDING + 3, 0);
    for (let f = FIELDS.BORDER - 4; f < FIELDS.BORDER; f++) put(id, f, 0);
  }
}

/** The grid's rows: termbox2's own in the live mode, the flag's headless (and after a resize). */
const gridRows = () => term.size()[1];

/** One frame: the pointer and its edges, the page's motion, the re-cut, the tree, Clay, the cells. Returns the command
 *  count. */
function frame(px: number, py: number, down: boolean, dt = 1 / 60): number {
  term.begin(px, py, down, dt);
  if (down && !wasDown) {
    const hit = clickable.filter(over);
    pressed = new Set(hit);
    for (const el of hit) el.props.onPress?.(px, py);
    // a press gives the pill the focus when it lands on it, and takes it away anywhere else (the Sensors page's own
    // focus; the Sky page's is the headless manager's, through `input`; the Figure page has no control)
    if (sensorsPage) focus = hit.some((el) => el.props.id === "Units") ? 0 : 1;
  } else if (!down && wasDown) {
    const hit = clickable.filter((el) => pressed.has(el) && over(el));
    pressed.clear();
    // a mutation (`--mutate open`): the press's release never runs the control's own onClick, so a card's click leaves
    // the feed as it was
    if (mutate !== "open") for (const el of hit) el.props.onClick?.(px, py);
  }
  wasDown = down;
  // the page's own pointer (the Sky feed's drag, the List's): after the events, before the tick, as src/frame.ts
  motion.onPointer?.(px, py, down);
  motion.tick?.(dt);
  // a mutation for terminal/test.sh: the page's offset never reaches Clay's clip, so the feed stays at row 0
  if (mutate === "scroll" && skyPage) term.scrollTo("sky-feed", 0);
  if (sensorsPage) cellStyle();
  // ... and the tab switch that never re-renders: the tree is not flushed after the key, so the bar's active tab stays
  if (!frozen) flush();
  clickable = [];
  for (const c of root.children) if (c instanceof El) emit(c, down);
  return term.end(dt);
}

/** One key as termbox2's name (the desktop's, with Space as the parts take it). */
function press(name: string) {
  if (figurePage) return;
  if (skyPage) {
    // the page's own keys: the wheel is one notch of its machine (as `--keys WheelDown`), `j`/`k` are the C page's
    // Down/Up, and everything else is the name the page's parts and focus manager already take
    if (name === "WheelDown" || name === "WheelUp") return void motion.onWheel?.(0, name === "WheelDown" ? -1 : 1);
    const key = name === "Space" ? " " : name === "j" ? "ArrowDown" : name === "k" ? "ArrowUp" : name;
    if (mutate === "tab" && /^(ArrowLeft|ArrowRight|[1-3])$/.test(key)) frozen = true;
    // a mutation (`--mutate back`): the page never sees an Escape, so a thread or a profile stays up
    if (mutate === "back" && key === "Escape") return;
    if (input.down(key)) return void input.up(key);
    // the page's cards are not Tab stops, so Enter has no card of its own: the C page's Enter opens the focused post's
    // thread, and the host presses the first card's own onClick while the feed is the focused stop (as it presses the
    // Sensors pill's). Anywhere else the page's own parts have already taken the key.
    if ((key === "Enter" || key === " ") && input.focus.focused() === "sky-feed") pressCard();
    return;
  }
  const key = name === "Space" ? " " : name;
  if (input.down(key)) return void input.up(key);
  if (key === "Tab" || key === "Shift+Tab") focus = focus === 0 ? 1 : 0;
  else if (key === "ArrowDown" || key === "ArrowUp") focus = 1;
  // the C page's Space/Enter on the focused pill: the page wires no keyboard, so the host presses its own onClick
  else if ((key === " " || key === "Enter") && focus === 0) units?.props.onClick?.();
  input.up(key);
}

/** The feed's first declared card's own onClick (the C feed's Enter: the focused post's thread). Nothing under
 *  `--mutate open`, and nothing when the window declared no card (an empty feed). */
function pressCard() {
  if (mutate === "open") return;
  let first: El | undefined;
  let index = Infinity;
  for (const el of clickable) {
    const id = el.props.id;
    if (!id || !/^sky-card-\d+$/.test(id)) continue;
    const n = Number(id.slice("sky-card-".length));
    if (n < index) (index = n), (first = el);
  }
  first?.props.onClick?.(-1, -1);
}

/**
 * Settles the thread's `load` after the frame that asked for it (the page's ask is a promise, and its `.then` is a
 * microtask): the screen's node mounts a frame after the ask and the loading row is that frame's, so `landWait` holds
 * the answer back one frame, and the next frame flushes the app's recorded rows. No-op while no thread is being
 * loaded, so a frame loop can call it every frame.
 */
async function land() {
  if (!landThread) return;
  if (landWait > 0) {
    landWait--;
    return;
  }
  const resolve = landThread;
  landThread = undefined;
  resolve();
  // the page's `.then` is a microtask and Solid's tree update follows it: one turn of the event loop is the smallest
  // thing that lets both run before the next frame
  await new Promise((r) => setTimeout(r, 0));
}

// the host's quit: `q` and Ctrl+C everywhere; Escape is the Sensors host's too, but on the Sky page it is the page's
// back (a thread's back, as the C feed's esc), so the page gets it
const quit = (name: string) => name === "q" || name === "Ctrl+C" || (!skyPage && name === "Escape");

if (headless) {
  if (term.open(cols, rows) !== 0) {
    console.error("terminal: Clay or the grid did not start");
    process.exit(2);
  }
  // every frame of the run, beside the commands: PREFIX.N.txt is the dump and PREFIX.N.ansi the truecolour, N from 0
  let frameNo = 0;
  // the console sink's own line a frame: one JSON array, "[]" when no cell changed (the diff's whole point). A mutation
  // for terminal/console.mjs: `--mutate console` diffs against the new frame, so every frame writes whole
  const consoleKeep = () => {
    if (consoleFrames !== undefined) term.console(consoleFrames, mutate === "console" ? 2 : 1);
  };
  const keep = () => {
    consoleKeep();
    if (framesOut === undefined || framesOut === "-") return;
    term.dump(`${framesOut}.${frameNo}.txt`);
    term.ansi(`${framesOut}.${frameNo}.ansi`);
  };
  // the page at rest: the Sky window's measuring frame and its card entry are over before the run's first frame. Each one
  // yields to the microtask queue after drawing, so a page whose data the page asked for (the Sky feed's first page) has
  // answered by the frame after the ask — the frame's own state, as the live loop's `await land()` gives it
  for (let i = 0; i < warm; i++) {
    frame(-1, -1, false);
    await land();
  }
  frame(-1, -1, false);
  keep();
  frameNo++;
  // the pointer first, then the keys: a screen the page opens on a click (the profile, from a card's author row) is up
  // before the keys that drive it arrive
  if (click) {
    const [x, y] = [click[0]!, click[1]!];
    for (const down of [false, true, false]) {
      frame(x, y, down);
      keep();
      frameNo++;
    }
    await land();
  }
  for (const key of keys ?? []) {
    // a frame with no input: a screen measures its content from the last frame's layout, so its first scroll key needs one
    if (key !== "-") press(key);
    frame(-1, -1, false);
    keep();
    frameNo++;
    // a key that opened a thread: the loader's answer lands after the frame that asked (the loading state's own frame)
    await land();
  }
  // the motion at rest: after the keys and the click, a page with a track needs frames after the input, not one
  for (let i = 0; i < settle; i++) {
    frame(-1, -1, false);
    consoleKeep();
    await land();
  }
  if (bench) {
    // the first frames are the JIT's: ten at rest, untimed, then the measured run
    for (let i = 0; i < 10; i++) frame(-1, -1, false);
    const t = performance.now();
    let commands = 0;
    for (let i = 0; i < bench; i++) commands = frame(-1, -1, false);
    const frameMs = (performance.now() - t) / bench;
    console.log(
      `terminal, ${bench} frames: ${frameMs.toFixed(3)} ms a frame (${cols * rows} cells, ${commands} commands: begin, ` +
        `declare + Solid's flush, Clay's layout, the commands -> cells)`,
    );
    const path = `${process.env.TMPDIR ?? "/tmp"}/cssints-terminal-bench.ansi`;
    const t2 = performance.now();
    for (let i = 0; i < bench; i++) term.ansi(path);
    const ansiMs = (performance.now() - t2) / bench;
    const bytes = await Bun.file(path).text();
    console.log(
      `terminal, the same frame as ANSI: ${ansiMs.toFixed(3)} ms (cells -> SGR runs, ${bytes.length} bytes, file write ` +
        `included)`,
    );
    if (consoleOut !== undefined) {
      const t3 = performance.now();
      for (let i = 0; i < bench; i++) term.console(path, 0);
      const consoleMs = (performance.now() - t3) / bench;
      const json = await Bun.file(path).text();
      console.log(
        `terminal, the same frame as a console.log call: ${consoleMs.toFixed(3)} ms (cells -> %c runs, ${json.length} ` +
          `bytes, file write included)`,
      );
    }
  }
  if (dump !== undefined) term.dump(dump);
  if (ansi !== undefined) term.ansi(ansi);
  if (consoleOut !== undefined) term.console(consoleOut, 0);
  if (showOffset && skyPage) {
    const o = term.scrollOffset("sky-feed");
    console.log(`offset ${o} px (${(o / CELL_H).toFixed(2)} rows)`);
    // the screens' own clips: their offset is the page's scroll machine's, as the feed's
    for (const [id, name] of [
      ["sky-thread-view", "thread"],
      ["sky-profile-view", "profile"],
      ["sky-notify-view", "notify"],
    ] as const) {
      if (term.bounds(idBytes(id)) === undefined) continue;
      const s = term.scrollOffset(id);
      console.log(`${name} offset ${s} px (${(s / CELL_H).toFixed(2)} rows)`);
    }
  }
  const status = term.errors() ? 1 : 0;
  dispose();
  term.close();
  process.exit(status);
}

// live: termbox2's own size, a frame each poll (16ms), the terminal's keys and its mouse in cells
const rv = term.open(0, 0);
if (rv !== 0) {
  console.error("termbox2: needs a terminal (use --dump or --ansi)");
  process.exit(2);
}
const keyBuf = new Uint8Array(64);
const pointer = new Float32Array(3);
const decoder = new TextDecoder();
let px = -1;
let py = -1;
let down = false;
let last = performance.now();
let frames = 0;
for (;;) {
  const status = term.poll(keyBuf, pointer);
  if (status === 3) break;
  if (status === 2) term.resize();
  else if (status === 1) {
    if (pointer[0]! >= 0) {
      px = pointer[0]!;
      py = pointer[1]!;
      down = pointer[2] !== 0;
    }
    const name = decoder.decode(keyBuf).split("\0")[0]!;
    if (name && quit(name)) break;
    if (name) press(name);
  }
  const now = performance.now();
  frame(px, py, down, Math.min((now - last) / 1000, 0.05));
  term.present();
  await land();
  last = now;
  if (++frames >= maxFrames) break;
}
if (maxFrames !== Infinity) console.log(`terminal: ${frames} frames, ${term.size().join("x")}`);
dispose();
term.close();
process.exit(term.errors() ? 1 : 0);
