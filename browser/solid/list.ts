// The List page in the browser, on the desktop's own modules: src/renderer.ts (the Solid universal renderer), src/frame.ts
// (one frame: pointer in, events, flush, the tree declared to Clay) and app/List.tsx, unmodified — with its own
// createInput() (one Tab stop: the viewport) and the page's own scroll machine (src/vscroll.ts). Clay runs in ui.wasm
// (browser/ui.c) through browser/solid/ffi-browser.ts; the commands are drawn by browser/draw.js. The loop, the pointer,
// the keys and window.__page are browser/solid/shell.ts's, as on the Sensors and Widgets pages.
//
// The page owns the viewport's offset — `ui.autoScroll(false)`, and the track writes it every frame — so the wheel has to
// reach the page's `motion.onWheel`: the shell drains ui.wheel into it before each frame, and the page then asks
// `ui.over` whether the pointer was on the viewport or on its visible thumb. A DOM wheel event's delta is in pixels and
// the machine counts notches (10px each, SDL's ±1), so one event is one notch and the sign is turned round, as the Sky
// page's own wheel does: SDL's wheel y is positive away from the user, a browser's deltaY positive scrolling down. The
// keys (Tab, the arrows, PageUp/Down, Home/End) are keys.ts's names into that same Input, and a key that moves the
// selection makes the page seek the offset that shows the row (its reveal).
import "./globals.ts";

import { List, size } from "../../solid/app/List.tsx";
import type { Motion } from "../../solid/src/entry.ts";
import { createInput } from "../../solid/src/input.ts";
import { mountPage } from "./shell.ts";

const input = createInput();

/**
 * The host's motion hook as the page sees it: the page hands its hooks to `props.motion` and the shell calls the object
 * it made, so the page's own assignments have to land there — and the wheel is filtered on the way, the host's pixels
 * to the machine's notches with SDL's sign (one event is one notch, as browser/solid/sky.ts maps its own wheel).
 */
function hooked(host: Motion): Motion {
  return {
    get onWheel() {
      return host.onWheel;
    },
    set onWheel(fn) {
      host.onWheel = fn && ((dx, dy) => fn(-Math.sign(dx), -Math.sign(dy)));
    },
    get onPointer() {
      return host.onPointer;
    },
    set onPointer(fn) {
      host.onPointer = fn;
    },
    get tick() {
      return host.tick;
    },
    set tick(fn) {
      host.tick = fn;
    },
  };
}

await mountPage({
  width: size.width,
  height: size.height,
  input,
  tree: ({ motion }) => () => List({ input, motion: hooked(motion) }),
});
