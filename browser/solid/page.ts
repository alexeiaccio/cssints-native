// The Sensors page in the browser, on the desktop's own modules: src/renderer.ts (the Solid universal renderer),
// src/frame.ts (one frame: pointer in, events, flush, the tree declared to Clay) and app/Sensors.tsx, unmodified. Clay
// runs in ui.wasm (browser/ui.c) through browser/solid/ffi-browser.ts; the commands it lays out are drawn by
// browser/draw.js, the same file the no-JS page draws with. The loop, the pointer and the object the check drives are
// browser/solid/shell.ts's; the Widgets page (widgets.ts) is the same shell with a page that takes keys.
//
// Sensors takes no input: it is a pointer-only page, and its `t` theme key is the window host's (main.ts's fallback), not
// the page's. The keys are the other page's.
import { Sensors } from "../../solid/app/Sensors.tsx";
import { H, W } from "../draw.js";
import { mountPage } from "./shell.ts";

await mountPage({ width: W, height: H, tree: ({ motion }) => () => Sensors({ motion }) });
