// The Dialog page: a settings screen with the two overlays of `headless/`. A modal dialog on a dim backdrop (both
// Clay root floats: the backdrop swallows the pointer, the dialog is centred on the page) and a menu button whose
// panel floats under its trigger. The styles live in this file, as on the Widgets page.
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal, Show } from "solid-js";

import {
  createButton,
  createDialogModal,
  createMenu,
} from "../../headless/src/index.ts";
import { a11y } from "../a11y.ts";
import {
  BLUR,
  DIALOG_ENTRY as ENTRY,
  DIALOG_EXIT as EXIT,
  ENTRY_FADE,
  ENTRY_SCALE,
  EXIT_SECONDS,
  GROW,
  MENU_TILT,
  OUT,
  OUT_SLIDE,
  SLIDE,
  SHRINK,
} from "../src/animations.ts";
import { ui } from "../src/ffi.ts";
import type { Input } from "../src/input.ts";
import { channel, presence, track } from "../src/motion.ts";
import { FIELDS } from "../src/pack.ts";

const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    title: { $value: "rgb(230 60 60)" },
    muted: { $value: "rgb(150 155 170)" },
    ink: { $value: "rgb(235 235 240)" },
    off: { $value: "rgb(60 64 78)" },
    accent: { $value: "rgb(240 140 50)" },
    surface: { $value: "rgb(36 40 52)" },
    hover: { $value: "rgb(48 53 68)" },
    active: { $value: "rgb(64 70 90)" },
    ring: { $value: "rgb(90 170 255)" },
    shadow: { $value: "rgb(8 10 14)" },
    // the menu's glass: a fill the blurred page shows through (css.backdrop)
    glass: { $value: "rgb(23 27 32 / 0.72)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    title: "rgb(200 30 40)",
    muted: "rgb(95 100 115)",
    ink: "rgb(25 27 34)",
    off: "rgb(190 194 206)",
    accent: "rgb(190 90 10)",
    surface: "rgb(255 255 255)",
    hover: "rgb(232 235 241)",
    active: "rgb(216 221 231)",
    ring: "rgb(20 100 220)",
    shadow: "rgb(60 64 78)",
    glass: "rgb(255 255 255 / 0.78)",
  },
});
const font = css.fonts("Roboto");

const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(28, 40, 24, 40),
  css.gap(10),
  css.flexDirection("column"),
  css.bg(t.color.page),
);
const title = css.cn(font.Roboto, css.color(t.color.title), css.fontSize(32));
const label = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(16));
const note = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(14));
const mark = css.cn(font.Roboto, css.color(t.color.accent), css.fontSize(18));

// the rows of the page and the dialog's buttons: the pill of the Widgets page
const button = css.cn(
  css.width("stretch"),
  css.height(40),
  css.justifyContent("center"),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(20),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const row = css.cn(
  css.width("stretch"),
  css.p(8, 12),
  css.gap(10),
  css.alignItems("center"),
  css.bg(t.color.surface),
  css.borderRadius(10),
  css.border(1, t.color.muted),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const pill = css.cn(
  css.p(2, 10),
  css.bg(t.color.off),
  css.borderRadius(10),
  css.justifyContent("center"),
  css.alignItems("center"),
);
const pillText = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(14));

// the backdrop: a root float over the whole page, dimming it and taking the pointer. ThorVG composites its alpha.
const backdrop = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.bg("rgb(0 0 0 / 0.55)"),
  css.float({ root: true, attach: { element: "left top", parent: "left top" }, zIndex: 1, capture: true }),
);
// the dialog: a root float centred on the page, above the backdrop
const panelBlur = 32;
const panel = css.cn(
  css.width(280),
  css.p(18),
  css.gap(10),
  css.flexDirection("column"),
  css.bg(t.color.surface),
  css.borderRadius(12),
  css.border(1, t.color.muted),
  css.shadow({ y: 12, blur: panelBlur, color: "rgb(0 0 0 / 0.45)" }),
  css.float({
    root: true,
    attach: { element: "center center", parent: "center center" },
    zIndex: 2,
    capture: true,
  }),
);
const dialogTitle = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(20));
const actions = css.cn(css.width("stretch"), css.gap(10));

// the menu: a float attached to its trigger's left-bottom corner, one row per item. It overlaps the trigger by 20px so
// there is a border and a text stroke under the glass, and its fill is translucent for the blur to show through.
const menuDrop = -20; // its float's offset y: it overlaps the trigger's bottom edge by 20px
const menuBlur = 14; // its shadow's blur
const menu = css.cn(
  css.width(150),
  css.p(6),
  css.gap(2),
  css.flexDirection("column"),
  css.bg(t.color.glass),
  css.borderRadius(10),
  css.border(1, t.color.muted),
  // a smaller shadow than the dialog's: it hangs off a row, not over the whole page; under the glass, on the page
  css.shadow({ y: 6, blur: menuBlur, color: "rgb(0 0 0 / 0.45)" }),
  css.float({
    parent: "zoom-trigger",
    attach: { element: "left top", parent: "left bottom" },
    offset: { y: menuDrop },
    zIndex: 10,
  }),
);
// the glass: the page under the menu, blurred (the desktop's renderer reads it from its own frame); the same style
// without it is what the test renders to see what the blur does
const menuPanel = css.cn(menu, css.backdrop({ blur: 10 }));
const item = css.cn(
  css.width("stretch"),
  css.p(5, 8),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(6),
  css.hover(css.bg(t.color.hover)),
  css.active(css.bg(t.color.active)),
  css.focus(css.border(2, t.color.ring)),
);
const dot = css.cn(css.width(8), css.height(8), css.borderRadius(4), css.bg(t.color.accent));

export const s = {
  t,
  font,
  root,
  title,
  label,
  note,
  mark,
  button,
  row,
  pill,
  pillText,
  backdrop,
  panel,
  dialogTitle,
  actions,
  menu,
  menuPanel,
  item,
  dot,
};

/** The window of the page. */
export const size = { width: 360, height: 480 };

// The two overlays arrive and leave with motion (src/motion.ts) through the value channel: each frame the page overrides
// numbers of the packed style by the element's id (`ui.value`) — its float's offset y, its shadow's blur (field 45, the
// one value outside the 45 floats) and, for the backdrop, the alpha of its dim (field 17) — so a settled frame is the
// frame the literal makes, pixel for pixel. A node that leaves stays mounted while its exit runs (`presence`), and while
// it fades it passes the press through, so the page under it is reachable the moment it closes. The springs and the
// entry's numbers are `src/animations.ts`'s, where the figures import them too: SLIDE is the offset's light bounce, BLUR
// the blur's clamped effect, OUT_SLIDE and OUT the exit's, GROW/SHRINK the group's, and ENTRY_FADE, ENTRY_SCALE,
// MENU_TILT, ENTRY and EXIT the numbers a fresh arrival starts at — the panel and the menu 4% small, the group at 88%
// opacity, the menu leaning 2° out of its trigger.
// the backdrop's dim: `rgb(0 0 0 / 0.55)`, whose alpha cssints packs as 140 (0..255)
const DIM = Math.round(0.55 * 255);
// the page's own clock, and its writes into the value channel: one call per element a frame
const write = channel((id, field, value) => ui.value(id, field, value));

/**
 * One overlay's numbers: the settled offset y of its float (the style's literal), the deltas it comes in and goes out
 * by, the settled blur of its shadow, and — the backdrop's only — the alpha of its dim. The presence decides whether it
 * is in the tree, the tracks what it looks like, and both are the page's because a track's clock is. An overlay with no
 * dim is a group: its whole subtree fades (`fade`, 0..255), scales (`scale`, percent) and tilts (`tilt`, degrees, 0 for
 * an overlay that does not lean) about its box.
 */
function overlay(id: string, rest: number, entry: number, exit: number, blur = -1, dim = -1, lean = 0) {
  return {
    id: Buffer.from(id),
    rest,
    entry,
    exit,
    blur,
    dim,
    lean,
    group: dim < 0, // the panel and the menu: the backdrop dims through its own fill instead
    present: presence(false, EXIT_SECONDS),
    mounted: false, // the frame before, for the edges
    open: false, // ... and whether it was open, so a target that moved is the one that is retargeted
    clock: 0,
    y: track(rest, SLIDE),
    shade: track(0, BLUR),
    alpha: track(dim < 0 ? 0 : dim, OUT),
    fade: track(0, OUT),
    scale: track(ENTRY_SCALE, GROW),
    tilt: track(0, GROW),
  };
}
type Overlay = ReturnType<typeof overlay>;

/**
 * One frame of an overlay: the presence decides whether it is mounted (and whether it is closing), the tracks follow
 * `open`, and the numbers go into the value channel. A fresh arrival starts at the entry values — the reset the style's
 * own literal cannot do — and a target that moves (the node closing, or coming back mid-exit) is retargeted from what is
 * presented, so nothing jumps and nothing starts over. The clock runs only while the node is mounted, so it is the time
 * of the last presented frame: the frame an overlay appears on shows its entry exactly, as the frame it settles on shows
 * the literal.
 */
function step(o: Overlay, open: boolean, dt: number) {
  const before = o.mounted;
  const { mounted, closing } = o.present.update(open, dt);
  o.mounted = mounted;
  if (!mounted) return;
  const y = open ? o.rest : o.rest + o.exit;
  const blur = open ? o.blur : 0;
  const dim = open ? o.dim : 0;
  if (!before) {
    o.y = track(o.rest + o.entry, SLIDE, o.clock);
    o.shade = track(0, BLUR, o.clock);
    if (o.dim >= 0) o.alpha = track(0, OUT, o.clock); // the dim itself fades in: the page darkens under the panel
    o.y.retarget(o.clock, y, SLIDE);
    if (o.blur >= 0) o.shade.retarget(o.clock, blur, BLUR);
    if (o.dim >= 0) o.alpha.retarget(o.clock, dim, OUT);
    // a group arrives nearly opaque and 4% small, on the same frame as the offset it starts from; an overlay that leans
    // arrives (and leaves) at its lean
    if (o.group) {
      o.fade = track(ENTRY_FADE, OUT, o.clock);
      o.scale = track(ENTRY_SCALE, GROW, o.clock);
      o.fade.retarget(o.clock, 255, OUT);
      o.scale.retarget(o.clock, 100, GROW);
      if (o.lean) {
        o.tilt = track(o.lean, GROW, o.clock);
        o.tilt.retarget(o.clock, 0, GROW);
      }
    }
  } else {
    o.clock += dt; // a shown frame is one dt after the one before it
    // the target moved: on its way out, or back in mid-exit — from the presented (x, v), never from the entry
    if (open !== o.open) {
      o.y.retarget(o.clock, y, open ? SLIDE : OUT_SLIDE);
      if (o.blur >= 0) o.shade.retarget(o.clock, blur, open ? BLUR : OUT);
      if (o.dim >= 0) o.alpha.retarget(o.clock, dim, OUT);
      if (o.group) {
        o.fade.retarget(o.clock, open ? 255 : 0, OUT);
        o.scale.retarget(o.clock, open ? 100 : ENTRY_SCALE, open ? GROW : SHRINK);
        if (o.lean) o.tilt.retarget(o.clock, open ? 0 : o.lean, open ? GROW : SHRINK);
      }
    }
  }
  o.open = open;
  const fields: [number, Track | number][] = [[FIELDS.OFFSET_Y, o.y]];
  if (o.blur >= 0) fields.push([FIELDS.SHADOW_BLUR, o.shade]);
  if (o.dim >= 0) fields.push([FIELDS.BACKGROUND_ALPHA, o.alpha]);
  // the group: the page's own track is percent, the renderer wants 1 = none, and the tilt is degrees as it is
  if (o.group) fields.push([FIELDS.ALPHA, o.fade], [FIELDS.SCALE, o.scale.at(o.clock).x / 100]);
  if (o.lean) fields.push([FIELDS.ROTATE, o.tilt]);
  // a closing overlay takes no press: the pointer reaches the page under it while it fades
  if (closing) fields.push([FIELDS.CAPTURE, 1]);
  write(o.id, o.clock, ...fields);
}

const ZOOMS = ["100%", "125%", "150%", "200%"];

/**
 * The settings screen. The dialog's Open button is the page's own button: while the dialog is open the backdrop takes
 * every press and `input.modal` every key, so the page behind is unreachable. OK writes 55% onto the page, Cancel and
 * Escape close without writing. The menu reports the zoom it last picked next to its trigger; its panel is glass over
 * the page, unless `glass` is false (what the pixel test renders to compare the blur against the same page without it).
 * `motion` is the host's frame hook (`solid/main.ts` wires it): the menu and the dialog animate through it.
 */
export function Dialog(props: { input: Input; glass?: boolean; motion?: { tick?: (dt: number) => void } }) {
  const { input } = props;
  const [volume, setVolume] = createSignal(40);
  const [changed, setChanged] = createSignal(false);
  const [zoom, setZoom] = createSignal(0);
  // what is in the tree: the overlays' presence, one signal each, set by the tick (before flush, so in this frame)
  const [menuShown, setMenuShown] = createSignal(false);
  const [dialogShown, setDialogShown] = createSignal(false);

  const dialog = createDialogModal({ id: "settings", focus: input.focus, labelledby: "settings-title" });
  const cancel = createButton({ id: "cancel", onClick: () => dialog.close() });
  const ok = createButton({
    id: "ok",
    onClick: () => {
      setVolume(55);
      setChanged(true);
      dialog.close();
    },
  });
  const bind = {
    open: input.add(dialog.trigger),
    cancel: input.bind(dialog.add(cancel.part)),
    ok: input.bind(dialog.add(ok.part)),
  };

  const menu = createMenu({
    id: "zoom",
    items: ZOOMS,
    focus: input.focus,
    onItemClick: (index) => setZoom(index),
  });
  const menuBind = {
    trigger: input.add(menu.trigger),
    items: ZOOMS.map((_label, index) => input.bind(menu.item(index))),
  };

  // the modal trap: tab cycles the dialog's controls, Escape closes it; other keys go to the focused control. It is the
  // open state that decides, so it is released on the frame that closes — not when the panel's exit is over and the node
  // leaves the tree: a Tab right after Escape reaches the page's own controls while the panel is still fading.
  input.modal = (name, repeat) => dialog.open() && dialog.keyDown(name, repeat);

  // the three overlays: the menu slides out of its trigger, the dialog drops in over a dim that goes out with it
  const menuOverlay = overlay(menu.menu.id, menuDrop, ENTRY.menu, EXIT.menu, menuBlur, -1, MENU_TILT);
  const panelOverlay = overlay(dialog.dialog.id, 0, ENTRY.panel, EXIT.panel, panelBlur);
  const dimOverlay = overlay(dialog.backdrop.id, 0, 0, 0, -1, DIM);
  if (props.motion)
    props.motion.tick = (dt) => {
      step(menuOverlay, menu.open(), dt);
      step(panelOverlay, dialog.open(), dt);
      step(dimOverlay, dialog.open(), dt);
      setMenuShown(menuOverlay.mounted);
      setDialogShown(panelOverlay.mounted);
    };
  // what the tree shows: the presence's answer when the host ticks the page, the open state itself when it does not (the
  // accessibility test builds the page without a frame hook, and a page with no motion has nothing to wait for)
  const menuIn = () => (props.motion ? menuShown() : menu.open());
  const dialogIn = () => (props.motion ? dialogShown() : dialog.open());

  return (
    <box id="Root" style={s.root}>
      <text style={s.title}>Settings</text>
      <text style={s.note}>A modal dialog on a dimmed page, and a menu that floats under its trigger.</text>
      <box {...bind.open} {...a11y(dialog.trigger)} style={s.button}>
        <text style={s.label}>Open settings</text>
      </box>
      <text style={s.label}>{`Volume: ${volume()}%${changed() ? " (just set)" : ""}`}</text>
      <box {...menuBind.trigger} {...a11y(menu.trigger)} label={`Zoom: ${ZOOMS[zoom()]}`} style={s.row}>
        <text style={s.label}>Zoom</text>
        <box style={s.pill}>
          <text style={s.pillText}>{ZOOMS[zoom()]}</text>
        </box>
        <text style={s.mark}>{menu.open() ? "-" : "+"}</text>
      </box>
      <Show when={menuIn()}>
        <box {...a11y(menu.menu)} label="Zoom" style={props.glass === false ? s.menu : s.menuPanel}>
          {ZOOMS.map((name, index) => (
            <box {...menuBind.items[index]!} {...a11y(menu.item(index))} style={s.item}>
              <text style={s.label}>{name}</text>
              <Show when={index === zoom()}>
                <box style={s.dot} />
              </Show>
            </box>
          ))}
        </box>
      </Show>
      <Show when={dialogIn()}>
        <box id={dialog.backdrop.id} style={s.backdrop} onPress={() => {}} />
        <box {...a11y(dialog.dialog)} style={s.panel} onPress={() => {}}>
          <text id="settings-title" style={s.dialogTitle}>Set the volume</text>
          <text style={s.note}>OK sets it to 55%. Cancel or Escape leaves it at {volume()}%.</text>
          <box style={s.actions}>
            <box {...bind.cancel} {...a11y(cancel.part)} style={s.button}>
              <text style={s.label}>Cancel</text>
            </box>
            <box {...bind.ok} {...a11y(ok.part)} style={s.button}>
              <text style={s.label}>OK</text>
            </box>
          </box>
        </box>
      </Show>
    </box>
  );
}
