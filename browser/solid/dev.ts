// The Dev page in the browser, on the desktop's own modules: src/renderer.ts, src/frame.ts and app/Dev.tsx
// **unmodified** — the Widgets page in its 360px column and the 300px panel that prints the page's a11y tree, the box
// under the pointer, the live values and the frame's phases (660x760). Clay runs in ui.wasm (browser/ui.c) through
// browser/solid/ffi-browser.ts; the commands and the effects beside them are drawn by browser/draw.js.
//
// The page is the shell's third-with-keys (Widgets, Dialog, this), and the two things the panel reads from the host are
// the two the shell now carries: the frame's phases (`stats`, `createFrame`'s own array) and the counters
// (`ui.draws`/`ui.presents`, the drawer's draw and the shell's paint). The pointer is the same one `onPointer` gets:
// the shell feeds the point to `ui_begin` before the tree is declared, so `ui.over` — the panel's `deepest` and the
// page's `:hover` — is the box under the mouse, and the panel's pin follows a press on the page's own 360px.
//
// The panel prints when the page changes (a pointer move, a key, a draw): that is the whole point of the page, and the
// frame's hash is what a page at rest keeps still — the check's 30 idle frames draw nothing.
//
// `?bench=0` leaves out the shell's twenty-frame auto bench, so a check's frames start at the first one.
import { Dev, size, stats } from "../../solid/app/Dev.tsx";
import { createInput } from "../../solid/src/input.ts";
import { mountPage } from "./shell.ts";

const input = createInput();
await mountPage({
  width: size.width,
  height: size.height,
  input,
  stats,
  tree: ({ motion, drag }) => () => Dev({ input, motion, drag }),
});
