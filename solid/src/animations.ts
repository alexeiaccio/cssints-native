// The app's motion, in one place: the springs the pages hand their tracks and the numbers a page starts an entry from.
// They live here — plain module, no JSX, no host — so the figures that document the motion (`solid/specs/from-frames.ts`,
// `from-motion.ts`) import the same constants the pages run on: a duration changed in a page is a figure that changed in
// the same commit, not a stale number in a JSON file.
//
// A page imports them under the names it reads (`import { GROW, SLIDE, ... } from "../src/animations.ts"`); the Dialog's
// `ENTRY`/`EXIT` are `DIALOG_ENTRY`/`DIALOG_EXIT` here because the Sky page owns a card entry of its own.
import { effect, spatial } from "./motion.ts";

// ---- the Dialog page (app/Dialog.tsx) -----------------------------------------------------------------------------

/** The overlay's offset: a light bounce, the overlay grows out of its trigger, it does not fly in. */
export const SLIDE = spatial(0.22, 0.1);
/** A blur has no negative side and must not ring: clamped and critically damped. */
export const BLUR = effect(0.22);
/** The exit: no bounce, a node on its way out may not overshoot where it came from. */
export const OUT_SLIDE = spatial(0.2, 0);
/** ... and its blur and the dim: a luminance field goes out quietly, clamped. */
export const OUT = effect(0.2);
/**
 * The group (the panel and the menu as one subtree, `FIELDS.ALPHA`/`SCALE`): fade and grow, a light bounce on the way in.
 * The group is the entry's one spatial track, so it may carry a little velocity; the exit must not overshoot.
 */
export const GROW = spatial(0.22, 0.1);
/** ... and the way out, without a bounce. */
export const SHRINK = spatial(0.2, 0);
/** The panel and the menu start 4% small. The scale is a percentage of the element's box, not a fraction: a track's
 *  settle rule is 0.5 of its own unit, so 0.96..1 would settle on its first sample — 96..100 settles at 99.5, a 0.5%
 *  snap nobody sees. */
export const ENTRY_SCALE = 96;
/** The group starts at 88% opacity, not 0: a panel at half opacity over the page's own text double-exposes, and the dim
 *  behind is doing the darkening — a nearly opaque arrival reads as a fade without the ghost of the page showing. */
export const ENTRY_FADE = 225;
/** The menu's tilt, in degrees: it settles out of a small counter-clockwise lean as it slides out of its trigger (and
 *  leans back on the way out), the one rotation in the value channel (`FIELDS.ROTATE`, about the menu's box centre). It is
 *  a scene transform as the scale is: `ui.bounds` does not move. 2° over the menu's 150px is 5px of top edge, which reads
 *  as a settle rather than as a spin; larger reads as a wobble in the frames. */
export const MENU_TILT = -2;
/** Where each arrival starts, in px from the settled offset y: the menu 10px lower (under its trigger), the panel 14px
 *  higher; both shadows start at 0. */
export const DIALOG_ENTRY = { menu: 10, panel: -14 };
/** ... and where each exit goes: the menu 10px lower, the panel 14px lower. */
export const DIALOG_EXIT = { menu: 10, panel: 14 };
/** The presence's exit: as long as the tracks above take to settle exactly (the 32px effect falls under the 0.5px/s
 *  settle rule at its twenty-first frame, 0.333s), so the last frame an exiting node is on screen is the literal. */
export const EXIT_SECONDS = 0.35;

// ---- the Sky page (app/Sky.tsx) ------------------------------------------------------------------------------------

/** A card's and a tab's hover: a luminance field, clamped and critically damped. */
export const HOVER = effect(0.12);
/** The tab's 2px underline fading in or out. */
export const UNDERLINE = effect(0.12);
/** The tab label's colour, from the muted token to the accent and back. */
export const LABEL = effect(0.15);
/** A card starts 50ms after the one before it, 12px low, over 0.3s: seconds and px, as the page's tracks read them. */
export const CARD_ENTRY = { delay: 0.05, y: 12, time: 0.3 };
/** The card's 12px slide, and its fade: two tracks on the same 0.3s. */
export const CARD_ENTRY_Y = spatial(CARD_ENTRY.time);
export const CARD_ENTRY_A = effect(CARD_ENTRY.time);
