// The Dialog page in the browser, on the desktop's own modules: src/renderer.ts (the Solid universal renderer),
// src/frame.ts (one frame: pointer in, events, flush, the tree declared to Clay) and app/Dialog.tsx, unmodified. Clay
// runs in ui.wasm (browser/ui.c) through browser/solid/ffi-browser.ts; the commands and the effects beside them (the
// panel's shadow, the panel's and the menu's group, the menu's backdrop) are drawn by browser/draw.js, the same file the
// no-JS page draws with.
//
// The page is the second one that takes keys (Widgets is the first), and the first with the two root floats: the modal's
// backdrop (a whole-window rectangle that dims the page and captures the pointer) and the panel centred on it, both
// `css.float({ root: true })` — Clay lays them out as floats, so the layout needs nothing of this target. The menu's
// float hangs off its trigger (`parent: "zoom-trigger"`), which is Clay's own way.
//
// The entry and the exit are the value channel's: each frame the page writes its floats' offset y, the panel's shadow
// blur, the backdrop's dim alpha and the group's alpha and scale by the element's id (`ui.value`), and the browser
// surface carries all of them (browser/ui.c's 45 floats and tables, draw.js's group) — so the panel drops in and fades
// as one scene, as on the desktop. `?glass=0` renders the menu without `css.backdrop` (the page's `glass` prop), which is
// the A/B the check reads the blur against; `?bench=0` is the page's own twenty-frame auto bench, left out when a
// check's frames have to start at the first one.
import { Dialog, size } from "../../solid/app/Dialog.tsx";
import { createInput } from "../../solid/src/input.ts";
import { mountPage } from "./shell.ts";

const query = new URLSearchParams(location.search);
const glass = query.get("glass") !== "0";
const input = createInput();
await mountPage({
  width: size.width,
  height: size.height,
  input,
  tree: ({ motion }) => () => Dialog({ input, glass, motion }),
});
