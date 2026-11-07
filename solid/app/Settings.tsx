// The Sky page's third screen: **Settings**, opened from the gear at the right end of the bar (the app's own Settings nav
// item; Roboto has no gear glyph and Clay has no icons, so the glyph is three boxes).
// It is built like the thread screen — a root float over the content area (the window less the bar's 64, at zIndex 3 so it
// stacks over a thread that is up), a 44px header with the back control and the word "Settings", its own clip element on
// the page's own scroll machine (a third instance), the page's card entry as one group (12px low and 0 opacity on
// `spatial(0.3)`/`effect(0.3)`, reversed on the way out, with `presence(0.3)` keeping the node mounted), and Escape and
// the back control returning to whatever was up: the feed, or the thread the screen was opened from (the bar is above
// both, so the gear is always reachable and the history is one step).
//
// Three controls, each one real — it changes the page and its frames:
//
// - **Theme**, a radio group (Dark / Light) that sets the page's theme signal. The page draws every style's variant by the
//   *frame's* theme, so the pick is written back to the host (`options.pickTheme`: main.ts's own `theme` variable, which
//   its frame's `theme` getter reads) — the whole palette, both screens, the bar and the cards follow, and so do the
//   fades' ends, which read the same signal. `THEME=light` is the starting pick, and the host's `t` key still flips it.
// - **Reduced motion**, a switch (the headless `createSwitch`) that calls `setReducedMotion`: afterwards the cards' and
//   the thread's entries and the fades land at once (`motion.ts`'s flag, which every track reads), and the screen itself
//   has no entry to wait for.
// - **Text size**, a radio group (Regular / Large). The page's styles are literals, so the feed card's five text styles
//   have a Large variant each, built here from the page's own tokens and font (`Sky.styles.ts`): the cards are taller and
//   the feed's content and its thumb with them — the page re-measures, which is what `tick`'s answer says (Sky drops its
//   height cache on that frame). The thread's cards keep the Regular size.
//
// The values last as long as the page runs (signals and the motion flag): nothing is persisted and no storage is read or
// written, so a fresh page starts from the host's theme, from the platform's motion flag and at Regular. Not here: the
// app's full appearance set (the accent hue, the corners, the fonts — `apps/csssky/src/settings.ts`), which this page's
// tokens carry no handles for.
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal } from "solid-js";

import { createButton, createRadioGroup, createSwitch, type ButtonPart } from "../../headless/src/index.ts";
import { a11y } from "../a11y.ts";
import { ui } from "../src/ffi.ts";
import type { Bind, FocusPart, Input } from "../src/input.ts";
import { effect, presence, reduced, setReducedMotion, spatial, track } from "../src/motion.ts";
import { FIELDS } from "../src/pack.ts";
import type { El } from "../src/renderer.ts";
import { scroll, type Scroll } from "../src/vscroll.ts";
import { font, t } from "./Sky.styles.ts";

/** The page's styles, as `Sky.tsx` exports them (`s`): the header and the clip the thread's screen draws, and the card's
 *  text at Regular, which the Large variants below answer. A type-only import, so nothing of `Sky.tsx` is loaded for it. */
type Styles = typeof import("./Sky.tsx").s;

const SCREEN = "sky-settings";
const HEAD = "sky-settings-head";
const VIEW = "sky-settings-view";
const BAR = "sky-settings-thumb";
/** The screen's height: the window less the bar (64), as the thread's. */
const H = 696;
/** The clip's padding, as the thread's: what the last row's box is measured against. */
const PAD = 12;
/** The entry: the page's card entry's own — 12px low, at 0 opacity, 0.3s. */
const ENTRY = { y: 12, time: 0.3 };
/** The rows, as the clip declares them (the last one measures the content's end). */
const ROWS = ["sky-settings-row-0", "sky-settings-row-1", "sky-settings-row-2"];
const THEMES = ["Dark", "Light"];
const THEME_VALUES = ["dark", "light"];
const SIZES = ["Regular", "Large"];
const SIZE_VALUES = ["regular", "large"];
/** Both radios of a group, for `setDisabled`: the screen's controls are stops only while it is up. */
const ALL = [0, 1];
// The page's own ids the screen's stops stand in front of: the feed's clip (Sky's own VIEW) and the thread's back
// control. The thread's clip is `s.THREAD_VIEW`, which Sky exports.
const FEED = "sky-feed";
const THREAD_BACK = "sky-back";

// The look. The page's own screen is the thread's — the same 44px header, the back control and the clip element, which
// Sky exports as `s.head`, `s.back`, `s.backText`, `s.threadTitle` and `s.threadView` — over this screen's float one z
// above the thread's, and the thread's thumb on this screen's clip.
const screen = css.cn(
  css.width("stretch"),
  css.height(H),
  css.flexDirection("column"),
  css.bg(t.color.page),
  css.float({
    root: true,
    attach: { element: "left top", parent: "left top" },
    offset: { y: 64 },
    zIndex: 3,
    capture: true,
  }),
);
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
    capture: false,
  }),
);
// A row: the panel card the thread's tombstones are, one per control, its label above the control's own box.
const row = css.cn(
  css.width("stretch"),
  css.p(12),
  css.gap(8),
  css.flexDirection("column"),
  css.bg(t.color.panel),
  css.borderRadius(12),
);
const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(15));
// the two choices of a radio group, side by side: the Widgets page's radio row in the sky palette
const choices = css.cn(css.gap(4), css.alignItems("center"));
const choice = css.cn(
  css.p(4, 8),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.hoverDeep)),
  css.focus(css.border(2, t.color.ring)),
);
const radio = css.cn(
  css.width(18),
  css.height(18),
  css.borderRadius(9),
  css.border(2, t.color.muted),
  css.justifyContent("center"),
  css.alignItems("center"),
);
const radioOn = css.cn(radio, css.borderColor(t.color.accent));
const dot = css.cn(css.width(8), css.height(8), css.borderRadius(4), css.bg(t.color.accent));
const choiceText = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(14));
// the switch is the Widgets page's track and thumb: a 44x24 track that turns the accent and hands the thumb the other end.
// The row itself is the control, so the pointer and the ring are the row's and its label is the switch's name.
const switchRow = css.cn(
  css.width("stretch"),
  css.gap(12),
  css.alignItems("center"),
  css.p(4, 8),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.hoverDeep)),
  css.focus(css.border(2, t.color.ring)),
);
const switchTrack = css.cn(
  css.width(44),
  css.height(24),
  css.p(2),
  css.borderRadius(12),
  css.alignItems("center"),
  css.justifyContent("flex-start"),
  css.bg(t.color.panelDeep),
);
const switchOn = css.cn(switchTrack, css.bg(t.color.accent), css.justifyContent("flex-end"));
const knob = css.cn(css.width(20), css.height(20), css.borderRadius(10), css.bg(t.color.ink));
// the gear in the bar: a 40px box that ends at the bar's content edge, a hover and a press that lighten it as the tabs' do,
// the ring drawn inside it; its glyph is three bars of `gearBar`, the app's settings affordance
const gear = css.cn(
  css.width(40),
  css.height(28),
  css.gap(3),
  css.flexDirection("column"),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.hoverDeep)),
  css.focus(css.border(2, t.color.ring)),
);
const gearBar = css.cn(css.width(16), css.height(2), css.borderRadius(1), css.bg(t.color.muted));

// The feed card's text at Large: the Regular ones are the page's (`s.name` …) and each has a literal of its own here, two
// steps up in size and in line height, from the same tokens. Two variants of a style, not a size system: a token cannot
// carry one, because Clay's text carries `fontSize` and `lineHeight` as numbers in the style itself. The two Regular
// variants are byte-identical (the size switch back is the feed's own frame), which is what `settings.test.ts` checks.
const large = {
  name: css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(18), css.lineHeight(24)),
  meta: css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(13), css.lineHeight(18)),
  body: css.cn(
    font.Roboto,
    css.color(t.color.ink),
    css.fontSize(16),
    css.lineHeight(22),
    css.whiteSpace("normal"),
  ),
  media: css.cn(
    font.Roboto,
    css.color(t.color.muted),
    css.fontSize(15),
    css.lineHeight(20),
    css.whiteSpace("normal"),
  ),
  counts: css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(15), css.lineHeight(20)),
};

export interface SettingsOptions {
  readonly input: Input;
  readonly styles: Styles;
  /** The page's theme this frame: the host's (`main.ts`'s `t`, `THEME=light`) or the pick the radio made. */
  readonly theme: () => string | undefined;
  /** The pick, written back to the host, whose frame picks every style's variant by it. */
  readonly pickTheme: (theme: string | undefined) => void;
  /** The screen under the float: a thread, whose two stops are disabled while this one is up. */
  readonly under: () => boolean;
}

export interface SkySettings {
  /** The screen's node is in the tree this frame (the presence's): `Sky`'s `Show` follows it. */
  shown(): boolean;
  /** The screen is up — the open state, not the exit's. */
  open(): boolean;
  /** Closes it (the back control, Escape, a tab, and the gear again): the exit's tracks, then the node leaves. */
  close(): void;
  /** The page's theme, as the radio and the page's fades read it. */
  theme(): string | undefined;
  /** The feed card's text at the size picked: two variants of each, so a switch re-lays the cards out. */
  readonly tx: Record<"name" | "meta" | "body" | "media" | "counts", () => css.ClayStyle>;
  /** The gear in the bar: its part, its box props, its box, and the one bar its glyph is drawn of (three of them). */
  readonly gear: {
    readonly bind: Bind;
    readonly part: ButtonPart;
    readonly style: css.ClayStyle;
    readonly bar: css.ClayStyle;
    /** The gear's press: it remembers the focus the screen's opening gives back, then takes the focus itself. */
    readonly press: () => void;
  };
  /** One frame: the entry, the exit, the scroll — and whether the text size changed (the feed re-measures then). */
  tick(dt: number): boolean;
  wheel(dx: number, dy: number): void;
  pointer(x: number, y: number, down: boolean, touch?: boolean): void;
  view(): El;
}

/** The settings screen of one page: its signals, its parts and its frame. */
export function skySettings(options: SettingsOptions): SkySettings {
  const { input, styles: st } = options;

  // ---- the values: a signal each, for as long as the page runs (nothing is stored) -----------------------------------
  const [open, setOpen] = createSignal(false);
  // whether the screen's node is in the tree this frame: the presence's answer, set by the tick before the flush
  const [shown, setShown] = createSignal(false);
  const [big, setBig] = createSignal(false);
  /** The size the radio last asked for: a signal's write lands at the flush, and the tick (which re-measures the feed)
   *  runs before it — this is the value the frame's own work reads. */
  let bigNow = false;
  const [viewFocused, setViewFocused] = createSignal(false);
  /** The card's text this frame: the page's Regular styles, or the Large ones above. */
  const tx = {
    name: () => (big() ? large.name : st.name),
    meta: () => (big() ? large.meta : st.meta),
    body: () => (big() ? large.body : st.body),
    media: () => (big() ? large.media : st.media),
    counts: () => (big() ? large.counts : st.counts),
  };

  // ---- the parts: the gear, the back control, the two radio groups, the switch and the clip -------------------------
  const gearButton = createButton({ id: "sky-gear", onClick: () => (open() ? close() : openScreen()) });
  const gearBind = input.add(gearButton.part);
  /** What had the focus when the gear was pressed: the press focuses the gear (as a tab's does), so this is the only
   *  moment the focus the screen's opening pushes can be read — a click that opens the screen gives it back on the way out. */
  let before: string | null = null;
  const gearPress = () => {
    before = input.focus.focused();
    input.focus.focus(gearButton.part.id);
  };
  const backButton = createButton({ id: "sky-settings-back", onClick: () => close() });
  // the back control is Enter, Space and Escape, as the thread's: this screen's one step back
  const backPart: FocusPart & { readonly disabled: boolean } = {
    id: backButton.part.id,
    disabled: false,
    get focused() {
      return backButton.part.focused;
    },
    focus: () => backButton.part.focus(),
    blur: () => backButton.part.blur(),
    press: () => backButton.part.press(),
    keyDown: (key) => (key === "Escape" ? (close(), true) : backButton.part.keyDown(key)),
    keyUp: (key) => backButton.part.keyUp(key),
  };
  const backBind = input.add(backPart);
  // the theme: a controlled group — the page's theme is the truth, so the host's `t` and the radio agree
  const themes = createRadioGroup({
    id: "sky-settings-theme",
    values: THEME_VALUES,
    get value() {
      return options.theme() === "light" ? "light" : "dark";
    },
    onValueChange: (v) => options.pickTheme(v === "light" ? "light" : undefined),
    focus: input.focus,
  });
  const themeBinds = themes.radios.map((r) => input.bind(r));
  const reduce = createSwitch({
    id: "sky-settings-motion",
    // the platform's flag is where the switch starts (`--reduced-motion`, main.ts), and it is the flag the page reads
    defaultValue: reduced(),
    onValueChange: (on) => setReducedMotion(on),
  });
  const motionBind = input.add(reduce.part);
  const sizes = createRadioGroup({
    id: "sky-settings-size",
    values: SIZE_VALUES,
    get value() {
      return big() ? "large" : "regular";
    },
    onValueChange: (v) => {
      // Solid 2 reads the committed value until the next flush, and the page's tick runs before it: the size the feed
      // re-measures on is the one the radio just asked for, not the one the last flush committed
      bigNow = v === "large";
      setBig(bigNow);
    },
    focus: input.focus,
  });
  const sizeBinds = sizes.radios.map((r) => input.bind(r));
  // the clip is the screen's second stop, after the back control: its keys scroll it, Escape is the page's back
  const viewPart: FocusPart & { readonly disabled: boolean } = {
    id: VIEW,
    disabled: false,
    get focused() {
      return viewFocused();
    },
    focus: () => setViewFocused(true),
    blur: () => setViewFocused(false),
    keyDown: (key) => {
      if (key === "Escape") return close(), true;
      const view = ui.bounds(Buffer.from(VIEW))?.[3] ?? 0;
      const step =
        key === "ArrowDown" ? 40 : key === "ArrowUp" ? -40 : key === "PageDown" ? view : key === "PageUp" ? -view : 0;
      if (!step && key !== "Home" && key !== "End") return false;
      machine.seek(key === "Home" ? 0 : key === "End" ? max() : machine.target() + step);
      return true;
    },
    keyUp: () => false,
  };
  const viewBind = input.add(viewPart);

  // ---- the stop list: the screen's parts while it is up, the screens under it out of the Tab order -------------------
  // The gear and the bar's tabs stay the page's (the bar is above the float). A thread under the screen is still open, so
  // its stops come back when this screen closes, disabled only by `under()`.
  let stopsOn: boolean | null = null;
  const stops = (on: boolean) => {
    if (on === stopsOn) return;
    stopsOn = on;
    for (const id of [backPart.id, viewPart.id, reduce.part.id]) input.focus.register(id, { disabled: !on });
    themes.setDisabled(on ? [] : ALL);
    sizes.setDisabled(on ? [] : ALL);
    input.focus.register(FEED, { disabled: on || options.under() });
    if (options.under()) {
      input.focus.register(THREAD_BACK, { disabled: on });
      input.focus.register(st.THREAD_VIEW, { disabled: on });
    }
    if (on) input.focus.focus(backPart.id);
    // the focus the screen took leaves with it, and what had it before the gear's press comes back (a thread's back
    // control, the feed's clip): the screen under it is the screen it was, its ring and all
    else input.focus.blur(), input.focus.pop();
  };

  // ---- the screen's own frame: presence, the entry's tracks, the scroll ----------------------------------------------
  const fx = {
    present: presence(false, ENTRY.time),
    mounted: false,
    open: false,
    y: track(0, spatial(ENTRY.time)),
    a: track(255, effect(ENTRY.time)),
  };
  const screenId = Buffer.from(SCREEN);
  const viewId = Buffer.from(VIEW);
  const barId = Buffer.from(BAR);
  const lastRowId = Buffer.from(ROWS[ROWS.length - 1]!);
  /** The rows' real content from the last layout (the last row's bottom, its offset added back, and the clip's 12px). */
  let content = 0;
  const max = () => Math.max(0, content - (ui.bounds(viewId)?.[3] ?? 0));
  const machine: Scroll = scroll(VIEW, max, BAR);
  /** The page's own frame clock, continuous across the screen's openings (the tracks' own instant). */
  let clock = 0;
  let bigWas = false;
  // Escape with nothing of the screen focused (a press on its background) is the screen's too: the page's last resort is
  // wrapped while it is up, and the bar's tabs keep their keys through it (`t`, the host's own).
  let hostFallback: Input["fallback"];
  const openScreen = () => {
    if (open()) return;
    hostFallback = input.fallback;
    input.fallback = (name) => (name === "Escape" ? (close(), true) : (hostFallback?.(name) ?? false));
    // what had the focus before the screen does, for the pop on the way out: the gear's press remembered it, and an
    // opening from the keyboard (the gear focused) has the gear, which is nothing to give back
    const now = input.focus.focused();
    const was = now === gearButton.part.id ? before : now;
    if (was !== null && was !== gearButton.part.id) input.focus.push(was);
    setOpen(true);
  };
  const close = () => {
    if (!open()) return;
    input.fallback = hostFallback;
    setOpen(false);
  };

  /** One frame: the text size's change, the presence and the group's tracks, the stops, and the screen's scroll. */
  const tick = (dt: number): boolean => {
    const changed = bigNow !== bigWas;
    if (changed) bigWas = bigNow;
    clock += dt;
    const wasMounted = fx.mounted;
    const { mounted, closing } = fx.present.update(open(), dt);
    if (mounted !== fx.mounted) setShown(mounted);
    fx.mounted = mounted;
    if (mounted) {
      // a fresh arrival starts at the entry, a screen that comes back mid-exit retargets from what it presents, and a
      // settled screen writes nothing: its frame is the style's literals (the page's card entry, on the whole screen)
      if (!wasMounted) {
        fx.y = track(ENTRY.y, spatial(ENTRY.time), clock);
        fx.a = track(0, effect(ENTRY.time), clock);
        fx.y.retarget(clock, 0);
        fx.a.retarget(clock, 255);
      } else if (open() !== fx.open) {
        fx.y.retarget(clock, open() ? 0 : ENTRY.y);
        fx.a.retarget(clock, open() ? 255 : 0);
      }
      const y = fx.y.at(clock),
        a = fx.a.at(clock);
      if (!y.done) ui.value(screenId, FIELDS.TRANSLATE_Y, y.x);
      if (!a.done) ui.value(screenId, FIELDS.ALPHA, a.x);
      // a closing screen passes the press through, so the screen under it is the pointer's again the moment it closes
      if (closing) ui.value(screenId, FIELDS.CAPTURE, 1);
      // the content's end from the last frame's layout
      const view = ui.bounds(viewId);
      const last = ui.bounds(lastRowId);
      if (view && last) content = Math.max(0, last[1] + last[3] - view[1] - ui.scrollOffset(VIEW) + PAD);
      machine.tick(dt);
    }
    fx.open = open();
    stops(open());
    return changed;
  };

  // the wheel and the pointer are the screen's while it is up, and only over its own clip (the bar above it is nobody's)
  const wheel = (dx: number, dy: number) => {
    if (open() && (ui.over(viewId) || ui.over(barId))) machine.wheel(dx, dy);
  };
  const pointer = (x: number, y: number, down: boolean, touch = false) => {
    if (open()) machine.pointer(x, y, down, touch);
  };

  // the parts are the page's, disabled: the screen is closed until the gear says otherwise
  stops(false);

  return {
    shown,
    open,
    close,
    theme: options.theme,
    tx,
    gear: { bind: gearBind, part: gearButton.part, style: gear, bar: gearBar, press: gearPress },
    tick,
    wheel,
    pointer,
    view: () =>
      (
        <box id={SCREEN} role="region" label="Settings" style={screen}>
          <box id={HEAD} style={st.head}>
            <box {...backBind} {...a11y(backButton.part)} label="Back" style={st.back}>
              <text style={st.backText}>Back</text>
            </box>
            <text style={st.threadTitle}>Settings</text>
          </box>
          <box {...viewBind} onPress={() => (viewBind.onPress(), machine.press())} style={st.threadView}>
            <box id={ROWS[0]} style={row}>
              <text id="sky-settings-theme-label" style={label}>
                Theme
              </text>
              <box {...a11y(themes.group)} labelledBy="sky-settings-theme-label" style={choices}>
                {themes.radios.map((r, i) => (
                  <box {...themeBinds[i]!} {...a11y(r)} style={choice}>
                    <box style={r.checked ? radioOn : radio}>{r.checked ? <box style={dot} /> : null}</box>
                    <text style={choiceText}>{THEMES[i]}</text>
                  </box>
                ))}
              </box>
            </box>
            <box id={ROWS[1]} style={row}>
              <box {...motionBind} {...a11y(reduce.part)} style={switchRow}>
                <box style={reduce.checked() ? switchOn : switchTrack}>
                  <box style={knob} />
                </box>
                <text style={label}>Reduced motion</text>
              </box>
            </box>
            <box id={ROWS[2]} style={row}>
              <text id="sky-settings-size-label" style={label}>
                Text size
              </text>
              <box {...a11y(sizes.group)} labelledBy="sky-settings-size-label" style={choices}>
                {sizes.radios.map((r, i) => (
                  <box {...sizeBinds[i]!} {...a11y(r)} style={choice}>
                    <box style={r.checked ? radioOn : radio}>{r.checked ? <box style={dot} /> : null}</box>
                    <text style={choiceText}>{SIZES[i]}</text>
                  </box>
                ))}
              </box>
            </box>
          </box>
          <box id={BAR} style={thumb} onPress={() => machine.thumb()} />
        </box>
      ) as unknown as El,
  };
}
